"use client";

import { useMemo, useState } from "react";
import type { PickingWaveItem, ShipmentOutputGeneration } from "@/lib/wms/picking-wave/types";
import { loadShipmentPrintGroups } from "@/lib/wms/load-shipment-print-groups";
import {
  buildBarTenderWorkbook,
  buildFourUpLabelPdf,
  buildMergedManifestPdf,
  buildShipmentPrintZip,
  buildTransactionStatementPdf,
} from "@/lib/wms/shipment-print-client";
import { wmsColors, wmsPrimaryButton } from "@/lib/wms/ui-tokens";
import { closeReservedDownloadTarget, downloadBlobPreservingPage, reserveDownloadTarget } from "@/lib/wms/download-client";

interface Props { waveId: string; items: PickingWaveItem[]; generation?: ShipmentOutputGeneration; generationLabel?: string; packingHref?: string; onGenerated?: (generationId: string, fileName: string) => Promise<void> | void }

export default function ShipmentOutputSetSection({ waveId, items, generation, generationLabel, packingHref, onGenerated }: Props) {
  const [generating, setGenerating] = useState<"all" | "barcode" | "label" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const outputDateToken = useMemo(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replaceAll("-", ""), []);

  if (!generation?.shipmentFileName) {
    return <p style={{ margin: 0, fontSize: "11px", color: wmsColors.muted }}>쉽먼트파일 생성 후 같은 발주 묶음의 출력세트를 만들 수 있습니다.</p>;
  }
  const activeGeneration = generation;

  const loadPrintGroups = () => loadShipmentPrintGroups(waveId, items, activeGeneration);

  async function generateFullSet(downloadTarget: ReturnType<typeof reserveDownloadTarget>) {
    const { groups } = await loadPrintGroups();
    const centerLabelResponse = await fetch("/api/wms/fulfillment-center-labels", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purchaseOrderNumbers: activeGeneration.purchaseOrderNumbers }),
    });
    if (!centerLabelResponse.ok) {
      const data = await centerLabelResponse.json().catch(() => ({}));
      throw new Error(data.error || "물류센터 라벨을 생성하지 못했습니다.");
    }
    const [labelsPdf, manifestsPdf, barcodeXlsx, transactionPdf, centerLabelXlsx] = await Promise.all([
      buildFourUpLabelPdf(groups), buildMergedManifestPdf(groups), buildBarTenderWorkbook(groups), buildTransactionStatementPdf(groups),
      centerLabelResponse.arrayBuffer().then(buffer => new Uint8Array(buffer)),
    ]);
    const outputFiles = [
      { name: "01_부착문서_4분할.pdf", bytes: labelsPdf },
      { name: "02_동봉내역서_통합.pdf", bytes: manifestsPdf },
      { name: `03_바코드출력_${outputDateToken}_최종.xlsx`, bytes: barcodeXlsx },
      { name: "04_물류센터_라벨.xlsx", bytes: centerLabelXlsx },
      { name: "05_거래명세서.pdf", bytes: transactionPdf },
    ];
    const fileList = new TextEncoder().encode(["Shipment 출력세트 생성 파일", ...outputFiles.map(file => file.name), "06_생성파일목록.txt"].join("\r\n"));
    const zip = await buildShipmentPrintZip([...outputFiles, { name: "06_생성파일목록.txt", bytes: fileList }]);
    const fileName = `Shipment_출력세트_${outputDateToken}_${activeGeneration.generationId}.zip`;
    downloadBlobPreservingPage(zip, fileName, downloadTarget);
    await onGenerated?.(activeGeneration.generationId, fileName);
  }

  async function generate(kind: "all" | "barcode" | "label") {
    const downloadTarget = reserveDownloadTarget();
    setGenerating(kind); setMessage(null); setError(null);
    try {
      if (kind === "all") await generateFullSet(downloadTarget);
      else {
        const printSource = kind === "barcode" ? await loadPrintGroups() : undefined;
        const manifestGroups = printSource?.groups.map(group => ({
          shipmentNumber: group.shipmentNumber,
          fulfillmentCenter: group.fulfillmentCenter,
          expectedDate: group.expectedDate,
          purchaseOrderNumbers: group.purchaseOrderNumbers,
          items: group.barcodeRows.map(row => ({
            purchaseOrderNumber: row.purchaseOrderNumber,
            skuId: row.skuId,
            barcode: row.barcode,
            quantity: row.quantity,
          })),
        }));
        const endpoint = kind === "barcode" ? "/api/wms/generation-barcode-output" : "/api/wms/fulfillment-center-labels";
        const response = await fetch(endpoint, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ purchaseOrderNumbers: activeGeneration.purchaseOrderNumbers, manifestGroups, expectedWorkbookName: printSource?.workbookName }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `${kind === "barcode" ? "바코드" : "물류센터 라벨"} 파일을 생성하지 못했습니다.`);
        }
        const disposition = response.headers.get("Content-Disposition") || "";
        const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1];
        const fileName = encoded ? decodeURIComponent(encoded) : kind === "barcode" ? "바코드출력_최종.xlsx" : "물류센터_라벨.xlsx";
        const driveSaved = response.headers.get("X-NOIDB-Drive-Saved") === "true";
        const driveWarning = decodeURIComponent(response.headers.get("X-NOIDB-Drive-Save-Warning") || "");
        downloadBlobPreservingPage(await response.blob(), fileName, downloadTarget);
        if (driveSaved) setMessage(`${kind === "barcode" ? "바코드" : "물류센터 라벨"} 파일 생성 및 Drive 자동저장을 완료했습니다.`);
        else if (driveWarning) setMessage(driveWarning);
      }
      const label = kind === "all" ? "Shipment 출력세트" : kind === "barcode" ? "바코드" : "물류센터 라벨";
      if (kind === "all") setMessage(`묶음 발주 ${activeGeneration.purchaseOrderNumbers.length}건 기준 ${label} 파일을 생성했습니다. 언제든 다시 생성할 수 있습니다.`);
    } catch (cause) {
      closeReservedDownloadTarget(downloadTarget);
      setError(cause instanceof Error ? cause.message : "Shipment 출력세트 생성 중 오류가 발생했습니다.");
    } finally { setGenerating(null); }
  }

  return <div>
    <div style={{ marginBottom: "8px", padding: "9px", borderRadius: "8px", background: wmsColors.surfaceBeige, fontSize: "12px", fontWeight: 800 }}>
      현재 출력세트: {generationLabel || "현재 묶음"} · 발주 {generation.purchaseOrderNumbers.length}건 · 부착문서 + 동봉내역서 + 바코드 + 물류센터 라벨 + 거래명세서
    </div>
    {error && <p style={{ margin: "0 0 8px", color: "#c0392b", fontSize: "11px", whiteSpace: "pre-wrap" }}>{error}</p>}
    {message && <p style={{ margin: "0 0 8px", color: wmsColors.greenDark, fontSize: "11px" }}>{message}</p>}
    {packingHref && <><a
      href={`${packingHref}?generation=${encodeURIComponent(activeGeneration.generationId)}`}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box",
        width: "100%", minHeight: "52px", marginBottom: "8px", borderRadius: "10px",
        border: `2px solid ${wmsColors.slateDark}`, background: "#fff", color: wmsColors.slateDark,
        fontSize: "15px", fontWeight: 900, textDecoration: "none",
      }}
    >
      상품 이미지로 확인
    </a>
    <p style={{ margin: "-2px 0 10px", color: wmsColors.muted, fontSize: "11px", lineHeight: 1.5 }}>
      현재 묶음의 동봉내역서 순서대로 이미지·SKU·바코드·수량을 확인하고 상품링크를 열 수 있습니다.
    </p></>}
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
