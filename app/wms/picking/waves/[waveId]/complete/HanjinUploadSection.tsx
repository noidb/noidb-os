"use client";

import { useEffect, useState } from "react";
import type { BasketAssignment } from "@/lib/wms/picking-wave/types";
import { wmsColors, wmsPrimaryButton } from "@/lib/wms/ui-tokens";
import type { ShipmentOutputPreview } from "@/lib/wms/shipment-output-context";

interface Props {
  baskets: BasketAssignment[];
  /** 생성이 성공적으로 끝난 뒤 호출된다 — 다음 단계 잠금 해제 등 상위 화면이 진행 상태를 알아야
   *  할 때만 쓴다(2026-08-19 5차 실사용 테스트 신규, 선택 항목이라 기존 사용처는 그대로 동작). */
  onGenerated?: () => void;
}

/**
 * 발주서/물류센터 조합으로 한진택배 업로드파일(고정형 서식 + 새 행)을 생성하는 카드.
 * 생성 전 대상 목록을 미리 보여주고, 생성 후에는 실제로 추가된 것/이미 있어서 건너뛴 것/
 * 목적지 정보가 없어 건너뛴 것을 그대로 알려준다 — 누락된 값을 임의로 채우지 않는다
 * (2026-08-19 신규). 외부 한진/Supplier Hub에는 자동 업로드하지 않는다.
 */
export default function HanjinUploadSection({ baskets, onGenerated }: Props) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<ShipmentOutputPreview | null>(null);
  const purchaseOrderNumbers = [...new Set(baskets.map(basket => basket.purchaseOrderNumber).filter(Boolean))];

  useEffect(() => {
    if (!purchaseOrderNumbers.length) return;
    setPreview(null);
    fetch("/api/wms/hanjin-upload/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ purchaseOrderNumbers }) })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "완전성 검사 실패"); return data.preview as ShipmentOutputPreview; })
      .then(setPreview)
      .catch(cause => setError(cause instanceof Error ? cause.message : "송장 완전성 검사에 실패했습니다."));
  }, [purchaseOrderNumbers.join("|")]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    setResultMessage(null);
    try {
      const response = await fetch("/api/wms/hanjin-upload/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchaseOrderNumbers }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        let message = data.error || "한진택배 업로드파일 생성에 실패했습니다.";
        if (data.skippedMissingDestination?.length > 0) {
          message += ` (목적지 정보 없음: ${data.skippedMissingDestination.map((s: { purchaseOrderNumber: string; fulfillmentCenter: string; reason?: string }) => `${s.purchaseOrderNumber}(${s.fulfillmentCenter})${s.reason ? `: ${s.reason}` : ""}`).join(" | ")})`;
        }
        setError(message);
        return;
      }

      const added = decodeURIComponent(response.headers.get("X-Added-Po-Numbers") || "");
      const addedSet = new Set(added.split(",").filter(Boolean));
      if (addedSet.size !== purchaseOrderNumbers.length || purchaseOrderNumbers.some(po => !addedSet.has(po))) throw new Error("생성 결과의 발주번호 집합이 요청과 일치하지 않아 다운로드를 차단했습니다.");
      const skippedPresent = decodeURIComponent(response.headers.get("X-Skipped-Already-Present") || "");
      const skippedMissing = decodeURIComponent(response.headers.get("X-Skipped-Missing-Destination") || "");

      const disposition = response.headers.get("Content-Disposition") || "";
      const fileNameMatch = disposition.match(/filename\*=UTF-8''(.+)$/);
      const fileName = fileNameMatch ? decodeURIComponent(fileNameMatch[1]) : "한진택배_업로드.xlsx";

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      let message = `신규 추가: ${added || "없음"}`;
      if (skippedPresent) message += ` · 이미 있어서 건너뜀: ${skippedPresent}`;
      if (skippedMissing) message += ` · 목적지 정보 없어 건너뜀: ${skippedMissing}`;
      setResultMessage(message);
      onGenerated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "한진택배 업로드파일 생성 중 오류가 발생했습니다.");
    } finally {
      setGenerating(false);
    }
  }

  if (purchaseOrderNumbers.length === 0) return null;

  return (
    <div>
      <p style={{ fontSize: "11px", color: wmsColors.muted, margin: "0 0 10px" }}>
        아래 발주서/물류센터 조합으로 생성됩니다. 원본 한진 서식은 수정하지 않고 새 행만 추가한
        사본을 만듭니다. 외부 시스템에는 자동 업로드하지 않습니다 — 파일만 다운로드됩니다.
      </p>

      <div style={{ marginBottom: "10px" }}>
        {baskets.map(basket => (
          <div key={basket.purchaseOrderNumber} style={{ fontSize: "12px", display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #f2eee8" }}>
            <span>발주서 {basket.purchaseOrderNumber}</span>
            <span style={{ color: wmsColors.muted }}>{basket.fulfillmentCenter}</span>
          </div>
        ))}
      </div>

      {preview && <div style={{ fontSize: "11px", lineHeight: 1.6, padding: "10px", marginBottom: "10px", background: preview.canGenerate ? "#f0f7f3" : "#fff4f1", borderRadius: "8px" }}>
        <strong>생성 전 완전성 검사</strong><br />
        Shipment {preview.requestedPurchaseOrderCount} · 원본 매칭 {preview.matchedPurchaseOrderCount} · 미매칭 {preview.missingPurchaseOrderNumbers.length} · 충돌 {preview.conflictPurchaseOrderNumbers.length}<br />
        센터 {preview.fulfillmentCenterCount} · 합배송 그룹/예상 송장 {preview.shippingGroupCount}행 · SKU {preview.sourceRecordCount} · 수량 {preview.totalOrderedQuantity}<br />
        주소 누락 {preview.missingAddressPurchaseOrders.length} · 전화 누락 {preview.missingPhonePurchaseOrders.length} · 우편번호 미등록 {preview.missingPostalCodeCenters.length}곳 · 바코드 누락 {preview.missingBarcodeRows.length}
        {preview.blockingReasons.length > 0 && <div style={{ color: "#b33f35", marginTop: "5px" }}>{preview.blockingReasons.join(" · ")}</div>}
        {preview.destinationResolutions.filter(item => item.status === "needs_review").map(item => (
          <div key={`${item.fulfillmentCenterName}:${item.sourceAddress}`} style={{ color: "#b33f35", marginTop: "5px" }}>
            확인 필요 · {item.fulfillmentCenterName} · {item.reason}
          </div>
        ))}
      </div>}

      {error && <p style={{ fontSize: "11px", color: "#c0392b", marginBottom: "8px" }}>{error}</p>}
      {resultMessage && <p style={{ fontSize: "11px", color: wmsColors.greenDark, marginBottom: "8px" }}>{resultMessage}</p>}

      <button onClick={handleGenerate} disabled={generating || !preview?.canGenerate} style={{ ...wmsPrimaryButton, width: "100%", opacity: generating || !preview?.canGenerate ? 0.6 : 1 }}>
        {generating ? "생성 중..." : preview ? "송장출력용 업로드파일 생성" : "완전성 검사 중..."}
      </button>
    </div>
  );
}
