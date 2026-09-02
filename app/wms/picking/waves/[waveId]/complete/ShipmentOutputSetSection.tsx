"use client";

import { useMemo, useState } from "react";
import type { PickingWaveItem, ShipmentOutputGeneration } from "@/lib/wms/picking-wave/types";
import type { ProductCatalogItem } from "@/lib/wms/product-catalog";
import {
  buildBarTenderWorkbook,
  buildFourUpLabelPdf,
  buildMergedManifestPdf,
  buildShipmentPrintZip,
  inspectShipmentPdf,
  matchShipmentPrintGroups,
  parseBarcodeWorkbook,
} from "@/lib/wms/shipment-print-client";
import { wmsColors, wmsPrimaryButton } from "@/lib/wms/ui-tokens";
import { closeReservedDownloadTarget, downloadBlobPreservingPage, reserveDownloadTarget } from "@/lib/wms/download-client";

interface EncodedSource { name: string; base64: string }
interface Props { waveId: string; items: PickingWaveItem[]; generation?: ShipmentOutputGeneration; generationLabel?: string }

function decodeFile(source: EncodedSource, type: string): File {
  const binary = atob(source.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], source.name, { type });
}
function sameSet(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every(value => right.has(value));
}

export default function ShipmentOutputSetSection({ waveId, items, generation, generationLabel }: Props) {
  const [generating, setGenerating] = useState<"all" | "barcode" | "label" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const outputDateToken = useMemo(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replaceAll("-", ""), []);

  if (!generation?.shipmentFileName) {
    return <p style={{ margin: 0, fontSize: "11px", color: wmsColors.muted }}>쉽먼트파일 생성 후 같은 발주 묶음의 출력세트를 만들 수 있습니다.</p>;
  }
  const activeGeneration = generation;

  async function generateFullSet(downloadTarget: ReturnType<typeof reserveDownloadTarget>) {
    const expected = new Set(activeGeneration.purchaseOrderNumbers.map(String));
    const expectedDateTokens = [...new Set(items.flatMap(item => item.sources)
      .filter(source => expected.has(source.purchaseOrderNumber))
      .map(source => String(source.shippingGroupKey || "").split("\u0000")[0].replace(/\D/g, ""))
      .filter(value => /^20\d{6}$/.test(value)))];
    if (expectedDateTokens.length === 0) throw new Error("현재 묶음의 입고예정일을 확인할 수 없습니다.");
    const sourceResponse = await fetch("/api/wms/shipment-print/auto-source", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        waveId,
        dateTokens: expectedDateTokens,
        expectedPurchaseOrderNumbers: [...expected],
        expectedWorkbookName: activeGeneration.shipmentFileName,
      }),
    });
    const source = await sourceResponse.json();
    if (!sourceResponse.ok || source.error) throw new Error(source.error || "출력세트 원본을 불러오지 못했습니다.");

    const labelFiles = (source.labels as EncodedSource[]).map(value => decodeFile(value, "application/pdf"));
    const manifestFiles = (source.manifests as EncodedSource[]).map(value => decodeFile(value, "application/pdf"));
    const workbook = decodeFile(source.workbook as EncodedSource, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const [labels, manifests, barcodeRows] = await Promise.all([
      Promise.all(labelFiles.map(file => inspectShipmentPdf(file, "label"))),
      Promise.all(manifestFiles.map(file => inspectShipmentPdf(file, "manifest"))),
      parseBarcodeWorkbook(workbook),
    ]);
    let catalog: ProductCatalogItem[];
    try {
      catalog = await fetch("/api/wms/product-catalog", { cache: "no-store" }).then(async response => {
        const data = await response.json();
        if (!response.ok || data.error || !data.configured) throw new Error(data.error || "제품DB를 불러오지 못했습니다.");
        return data.items as ProductCatalogItem[];
      });
    } catch (catalogError) {
      if (window.location.hostname !== "localhost") throw catalogError;
      catalog = barcodeRows.map(row => ({
        skuId: row.skuId, modelSku: "", modelName: row.embeddedModelName, category: "", gender: "",
        productName: "", optionLabel: "", imageUrl: "", warehouseNumber: "", boxNumber: "",
        currentStock: "", currentStatus: "", costVatIncluded: "", vendorName: "", barcode: "",
        countryOfOrigin: row.embeddedCountryOfOrigin, productLink: "",
      }));
    }

    const generationRows = barcodeRows.filter(row => expected.has(row.purchaseOrderNumber));
    const workbookPoSet = new Set(generationRows.map(row => row.purchaseOrderNumber));
    if (!sameSet(expected, workbookPoSet)) throw new Error(`현재 묶음 발주 ${expected.size}건과 출력 원본 발주 ${workbookPoSet.size}건이 정확히 일치하지 않습니다.`);
    const relevantLabels = labels.filter(label => label.purchaseOrderNumbers.some(po => expected.has(po)));
    const shipmentNumbers = new Set(relevantLabels.map(label => label.shipmentNumber));
    const relevantManifests = manifests.filter(manifest => shipmentNumbers.has(manifest.shipmentNumber));
    const groups = matchShipmentPrintGroups(relevantLabels, relevantManifests, generationRows, catalog, items);
    const matchedPos = groups.flatMap(group => group.purchaseOrderNumbers);
    const matchedSet = new Set(matchedPos);
    if (!sameSet(expected, matchedSet) || matchedPos.length !== matchedSet.size) {
      const missing = [...expected].filter(po => !matchedSet.has(po));
      const extra = [...matchedSet].filter(po => !expected.has(po));
      throw new Error(`출력세트 발주 완전성 검증 실패 (누락 ${missing.length} · 예상 외 ${extra.length} · 중복 ${matchedPos.length - matchedSet.size})`);
    }

    const [labelsPdf, manifestsPdf, barcodeXlsx] = await Promise.all([
      buildFourUpLabelPdf(groups), buildMergedManifestPdf(groups), buildBarTenderWorkbook(groups),
    ]);
    const zip = await buildShipmentPrintZip([
      { name: "01_부착문서_4분할.pdf", bytes: labelsPdf },
      { name: "02_동봉내역서_통합.pdf", bytes: manifestsPdf },
      { name: `바코드출력_${outputDateToken}_최종.xlsx`, bytes: barcodeXlsx },
    ]);
    downloadBlobPreservingPage(zip, `Shipment_출력세트_${outputDateToken}_${activeGeneration.generationId}.zip`, downloadTarget);
  }

  async function generate(kind: "all" | "barcode" | "label") {
    const downloadTarget = reserveDownloadTarget();
    setGenerating(kind); setMessage(null); setError(null);
    try {
      if (kind === "all") await generateFullSet(downloadTarget);
      else {
        const endpoint = kind === "barcode" ? "/api/wms/generation-barcode-output" : "/api/wms/fulfillment-center-labels";
        const response = await fetch(endpoint, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ purchaseOrderNumbers: activeGeneration.purchaseOrderNumbers }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `${kind === "barcode" ? "바코드" : "물류센터 라벨"} 파일을 생성하지 못했습니다.`);
        }
        const disposition = response.headers.get("Content-Disposition") || "";
        const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1];
        const fileName = encoded ? decodeURIComponent(encoded) : kind === "barcode" ? "바코드출력_최종.xlsx" : "물류센터_라벨.xlsx";
        downloadBlobPreservingPage(await response.blob(), fileName, downloadTarget);
      }
      const label = kind === "all" ? "Shipment 출력세트" : kind === "barcode" ? "바코드" : "물류센터 라벨";
      setMessage(`묶음 발주 ${activeGeneration.purchaseOrderNumbers.length}건 기준 ${label} 파일을 생성했습니다. 언제든 다시 생성할 수 있습니다.`);
    } catch (cause) {
      closeReservedDownloadTarget(downloadTarget);
      setError(cause instanceof Error ? cause.message : "Shipment 출력세트 생성 중 오류가 발생했습니다.");
    } finally { setGenerating(null); }
  }

  return <div>
    <div style={{ marginBottom: "8px", padding: "9px", borderRadius: "8px", background: wmsColors.surfaceBeige, fontSize: "12px", fontWeight: 800 }}>
      현재 출력세트: {generationLabel || "현재 묶음"} · 발주 {generation.purchaseOrderNumbers.length}건 · 4분할 라벨 PDF + 통합 거래명세서 PDF + 바코드 XLSX
    </div>
    {error && <p style={{ margin: "0 0 8px", color: "#c0392b", fontSize: "11px", whiteSpace: "pre-wrap" }}>{error}</p>}
    {message && <p style={{ margin: "0 0 8px", color: wmsColors.greenDark, fontSize: "11px" }}>{message}</p>}
    <button type="button" onClick={() => void generate("all")} disabled={generating !== null} style={{ ...wmsPrimaryButton, width: "100%", minHeight: "52px", marginBottom: "8px", opacity: generating ? 0.6 : 1 }}>
      {generating === "all" ? "Shipment 출력세트 생성 중..." : "Shipment 출력세트 생성"}
    </button>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "8px" }}>
      <button type="button" onClick={() => void generate("barcode")} disabled={generating !== null} style={{ ...wmsPrimaryButton, width: "100%", minHeight: "48px", opacity: generating ? 0.6 : 1 }}>
        {generating === "barcode" ? "바코드 생성 중..." : "바코드 파일만 생성"}
      </button>
      <button type="button" onClick={() => void generate("label")} disabled={generating !== null} style={{ ...wmsPrimaryButton, width: "100%", minHeight: "48px", opacity: generating ? 0.6 : 1 }}>
        {generating === "label" ? "라벨 생성 중..." : "물류센터 라벨만 생성"}
      </button>
    </div>
  </div>;
}
