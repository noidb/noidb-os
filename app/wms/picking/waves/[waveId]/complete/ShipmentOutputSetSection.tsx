"use client";

import { useState } from "react";
import type { ShipmentOutputGeneration } from "@/lib/wms/picking-wave/types";
import { wmsColors, wmsPrimaryButton } from "@/lib/wms/ui-tokens";
import { closeReservedDownloadTarget, downloadBlobPreservingPage, reserveDownloadTarget } from "@/lib/wms/download-client";

export default function ShipmentOutputSetSection({ generation, generationLabel }: { generation?: ShipmentOutputGeneration; generationLabel?: string }) {
  const [generating, setGenerating] = useState<"barcode" | "label" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!generation?.shipmentFileName) {
    return <p style={{ margin: 0, fontSize: "11px", color: wmsColors.muted }}>쉽먼트파일 생성 후 같은 발주 묶음의 출력세트를 만들 수 있습니다.</p>;
  }
  const activeGeneration = generation;

  async function generate(kind: "barcode" | "label") {
    const downloadTarget = reserveDownloadTarget();
    setGenerating(kind);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(kind === "barcode" ? "/api/wms/generation-barcode-output" : "/api/wms/fulfillment-center-labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      setMessage(`묶음 발주 ${activeGeneration.purchaseOrderNumbers.length}건 기준 ${kind === "barcode" ? "바코드" : "물류센터 라벨"} 파일을 생성했습니다. 언제든 다시 생성할 수 있습니다.`);
    } catch (cause) {
      closeReservedDownloadTarget(downloadTarget);
      setError(cause instanceof Error ? cause.message : "Shipment 출력세트 생성 중 오류가 발생했습니다.");
    } finally {
      setGenerating(null);
    }
  }

  return <div>
    <div style={{ marginBottom: "8px", padding: "9px", borderRadius: "8px", background: wmsColors.surfaceBeige, fontSize: "12px", fontWeight: 800 }}>
      현재 출력세트: {generationLabel || "현재 묶음"} · 발주 {generation.purchaseOrderNumbers.length}건 · 물류센터 라벨 포함
    </div>
    {error && <p style={{ margin: "0 0 8px", color: "#c0392b", fontSize: "11px" }}>{error}</p>}
    {message && <p style={{ margin: "0 0 8px", color: wmsColors.greenDark, fontSize: "11px" }}>{message}</p>}
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
