"use client";

import { useEffect, useState } from "react";
import type { BasketAssignment, ShipmentOutputGeneration } from "@/lib/wms/picking-wave/types";
import { wmsColors, wmsPrimaryButton } from "@/lib/wms/ui-tokens";

interface Props {
  baskets: BasketAssignment[];
  generation?: ShipmentOutputGeneration;
  onGenerated?: (generationId: string, fileName: string) => Promise<void> | void;
}

/**
 * "쉽먼트파일 생성" 버튼 하나로 끝내는 자동화 화면(2026-08-24 9차). 예전 2단계(운송장번호 입력
 * 파일을 사용자가 직접 선택)와 3단계(그 파일로 쉽먼트 업로드파일 생성)를 하나로 합쳤다 — 파일
 * 선택 없이, 서버가 Google Drive/로컬 G드라이브에서 최신 "재출력 세부내역"과 "발주서업로드완성"
 * 확정수량 파일을 자동으로 찾아 현재 웨이브와 대조한다(lib/wms/hanjin-shipment-auto.ts 참고).
 * 하나라도 어긋나면 아무 파일도 만들지 않고 사유를 전부 보여준다 — 임의로 부분 생성하지 않는다.
 */
export default function HanjinAutoShipmentSection({ baskets, generation, onGenerated }: Props) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<string[] | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [expectedDatesByPo, setExpectedDatesByPo] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/wms/supplier-hub-orders", { cache: "no-store" })
      .then(response => response.json())
      .then(data =>
        setExpectedDatesByPo(
          Object.fromEntries(
            (data.orders || []).map((order: { purchaseOrderNumber: string; expectedDate?: string }) => [order.purchaseOrderNumber, order.expectedDate || ""])
          )
        )
      )
      .catch(() => setExpectedDatesByPo({}));
  }, []);

  const selectedPoNumbers = new Set(generation?.purchaseOrderNumbers || []);
  const requests = baskets.filter(basket => selectedPoNumbers.has(basket.purchaseOrderNumber)).map(basket => ({
    purchaseOrderNumber: basket.purchaseOrderNumber,
    fulfillmentCenter: basket.fulfillmentCenter,
    expectedDate: expectedDatesByPo[basket.purchaseOrderNumber] || "",
  }));

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    setReasons(null);
    setResultMessage(null);
    try {
      const response = await fetch("/api/wms/hanjin-upload/build-shipment-auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requests }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "쉽먼트파일 생성에 실패했습니다.");
        setReasons(Array.isArray(data.reasons) ? data.reasons : null);
        return;
      }

      const includedCount = response.headers.get("X-Included-Count");
      const trackingNumbers = decodeURIComponent(response.headers.get("X-Tracking-Numbers-Used") || "");
      const disposition = response.headers.get("Content-Disposition") || "";
      const fileNameMatch = disposition.match(/filename\*=UTF-8''(.+)$/);
      const fileName = fileNameMatch ? decodeURIComponent(fileNameMatch[1]) : "쉽먼트생성_업로드파일.xlsx";

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setResultMessage(`SKU ${includedCount}개 행, 운송장번호(${trackingNumbers})로 생성했습니다.`);
      if (generation) await onGenerated?.(generation.generationId, fileName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "쉽먼트파일 생성 중 오류가 발생했습니다.");
    } finally {
      setGenerating(false);
    }
  }

  if (!generation) return <p style={{ margin: 0, fontSize: "11px", color: wmsColors.muted }}>먼저 송장파일을 생성하면 그때 선택한 발주 집합이 Shipment 대상으로 연결됩니다.</p>;
  if (requests.length === 0) return null;

  return (
    <div>
      <div style={{ marginBottom: "8px", padding: "9px", borderRadius: "8px", background: wmsColors.surfaceBeige, fontSize: "12px", fontWeight: 800 }}>
        현재 Shipment 대상: 발주 {requests.length}건 · 예상 송장 {generation.expectedShippingGroupCount}건
      </div>
      <p style={{ fontSize: "11px", color: wmsColors.muted, margin: "0 0 10px" }}>
        한진택배 재출력 세부내역과 발주서업로드완성 확정수량 파일을 자동으로 찾아, 현재 웨이브의
        송장번호가 입력된 Supplier Hub 쉽먼트파일을 만듭니다. 파일을 직접 고를 필요가 없습니다.
      </p>

      {error && (
        <div style={{ fontSize: "12px", color: "#c0392b", marginBottom: "8px" }}>
          <p style={{ margin: "0 0 4px", fontWeight: 700 }}>{error}</p>
          {reasons && reasons.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: "18px" }}>
              {reasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {resultMessage && <p style={{ fontSize: "12px", color: wmsColors.greenDark, marginBottom: "8px" }}>{resultMessage}</p>}

      <button onClick={handleGenerate} disabled={generating} style={{ ...wmsPrimaryButton, width: "100%", opacity: generating ? 0.6 : 1 }}>
        {generating ? "생성 중..." : "쉽먼트파일 생성"}
      </button>
    </div>
  );
}
