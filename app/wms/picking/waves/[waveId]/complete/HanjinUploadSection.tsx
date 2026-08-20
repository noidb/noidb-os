"use client";

import { useState } from "react";
import type { BasketAssignment } from "@/lib/wms/picking-wave/types";
import { wmsColors, wmsPrimaryButton } from "@/lib/wms/ui-tokens";

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

  const requests = baskets.map(basket => ({ purchaseOrderNumber: basket.purchaseOrderNumber, fulfillmentCenter: basket.fulfillmentCenter }));

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    setResultMessage(null);
    try {
      const response = await fetch("/api/wms/hanjin-upload/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requests }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        let message = data.error || "한진택배 업로드파일 생성에 실패했습니다.";
        if (data.skippedMissingDestination?.length > 0) {
          message += ` (목적지 정보 없음: ${data.skippedMissingDestination.map((s: any) => `${s.purchaseOrderNumber}(${s.fulfillmentCenter})`).join(", ")})`;
        }
        setError(message);
        return;
      }

      const added = decodeURIComponent(response.headers.get("X-Added-Po-Numbers") || "");
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

  if (requests.length === 0) return null;

  return (
    <div>
      <p style={{ fontSize: "11px", color: wmsColors.muted, margin: "0 0 10px" }}>
        아래 발주서/물류센터 조합으로 생성됩니다. 원본 한진 서식은 수정하지 않고 새 행만 추가한
        사본을 만듭니다. 외부 시스템에는 자동 업로드하지 않습니다 — 파일만 다운로드됩니다.
      </p>

      <div style={{ marginBottom: "10px" }}>
        {requests.map(req => (
          <div key={req.purchaseOrderNumber} style={{ fontSize: "12px", display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #f2eee8" }}>
            <span>발주서 {req.purchaseOrderNumber}</span>
            <span style={{ color: wmsColors.muted }}>{req.fulfillmentCenter}</span>
          </div>
        ))}
      </div>

      {error && <p style={{ fontSize: "11px", color: "#c0392b", marginBottom: "8px" }}>{error}</p>}
      {resultMessage && <p style={{ fontSize: "11px", color: wmsColors.greenDark, marginBottom: "8px" }}>{resultMessage}</p>}

      <button onClick={handleGenerate} disabled={generating} style={{ ...wmsPrimaryButton, width: "100%", opacity: generating ? 0.6 : 1 }}>
        {generating ? "생성 중..." : "송장출력용 업로드파일 생성"}
      </button>
    </div>
  );
}
