"use client";

import { useState } from "react";
import type { ShipmentOutputGeneration } from "@/lib/wms/picking-wave/types";
import { wmsColors, wmsPrimaryButton } from "@/lib/wms/ui-tokens";

export default function ShipmentOutputSetSection({ generation, generationLabel }: { generation?: ShipmentOutputGeneration; generationLabel?: string }) {
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!generation?.shipmentFileName) {
    return <p style={{ margin: 0, fontSize: "11px", color: wmsColors.muted }}>쉽먼트파일 생성 후 같은 발주 묶음의 출력세트를 만들 수 있습니다.</p>;
  }
  const activeGeneration = generation;

  async function generate() {
    setGenerating(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/wms/fulfillment-center-labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchaseOrderNumbers: activeGeneration.purchaseOrderNumbers }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Shipment 출력세트를 생성하지 못했습니다.");
      }
      const disposition = response.headers.get("Content-Disposition") || "";
      const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1];
      const fileName = encoded ? decodeURIComponent(encoded) : "물류센터_라벨.xlsx";
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setMessage(`묶음 발주 ${activeGeneration.purchaseOrderNumbers.length}건 기준 물류센터 라벨을 생성했습니다. 언제든 다시 생성할 수 있습니다.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Shipment 출력세트 생성 중 오류가 발생했습니다.");
    } finally {
      setGenerating(false);
    }
  }

  return <div>
    <div style={{ marginBottom: "8px", padding: "9px", borderRadius: "8px", background: wmsColors.surfaceBeige, fontSize: "12px", fontWeight: 800 }}>
      현재 출력세트: {generationLabel || "현재 묶음"} · 발주 {generation.purchaseOrderNumbers.length}건 · 물류센터 라벨 포함
    </div>
    {error && <p style={{ margin: "0 0 8px", color: "#c0392b", fontSize: "11px" }}>{error}</p>}
    {message && <p style={{ margin: "0 0 8px", color: wmsColors.greenDark, fontSize: "11px" }}>{message}</p>}
    <button type="button" onClick={generate} disabled={generating} style={{ ...wmsPrimaryButton, width: "100%", opacity: generating ? 0.6 : 1 }}>
      {generating ? "출력세트 생성 중..." : "Shipment 출력세트 생성"}
    </button>
  </div>;
}
