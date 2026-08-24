"use client";

import { useState } from "react";
import type { BasketAssignment } from "@/lib/wms/picking-wave/types";
import { readFileAsBase64 } from "@/lib/wms/file-base64";
import { wmsColors, wmsGreenDarkButton } from "@/lib/wms/ui-tokens";

interface Props {
  waveId: string;
  baskets: BasketAssignment[];
  /** 2단계에서 업로드한 "송장번호 입력 완료" 원본의 base64 — 반드시 있어야 실행된다. */
  trackingFileBase64: string | null;
}

/**
 * 발주확정 다음 단계 3단계 — Supplier Hub 쉽먼트 생성 업로드파일을 만든다 (2026-08-19 6차
 * 실사용 테스트 신규). 1단계(한진택배 송장출력용 업로드파일)와는 완전히 다른 파일이다:
 * 2단계에서 업로드한 원본의 실제 행 데이터에서, 현재 웨이브의 발주서/물류센터와 일치하고
 * 송장번호가 실제로 채워진 행만 골라 새로 만든다 — 매칭 실패 행은 절대 포함하지 않는다.
 * 2단계 업로드 파일이 없으면(trackingFileBase64===null) 버튼 자체가 비활성화된다.
 */
export default function HanjinShipmentUploadSection({ waveId, baskets, trackingFileBase64 }: Props) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [confirmedFileName, setConfirmedFileName] = useState<string | null>(null);
  const [confirmedFileBase64, setConfirmedFileBase64] = useState<string | null>(null);

  const targets = baskets.map(basket => ({ purchaseOrderNumber: basket.purchaseOrderNumber, fulfillmentCenter: basket.fulfillmentCenter }));

  async function handleGenerate() {
    if (!trackingFileBase64 || !confirmedFileBase64) return;
    setGenerating(true);
    setError(null);
    setResultMessage(null);
    try {
      const response = await fetch("/api/wms/hanjin-upload/build-shipment-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64: trackingFileBase64, confirmedFileBase64, waveId, targets }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "쉽먼트 생성 업로드파일 생성에 실패했습니다.");
        return;
      }

      const includedCount = response.headers.get("X-Included-Count");
      const excludedCount = response.headers.get("X-Excluded-Unmatched-Count");
      const excludedZeroCount = response.headers.get("X-Excluded-Zero-Quantity-Count");
      const savedPathHeader = response.headers.get("X-Auto-Saved-Path");
      const savedPath = savedPathHeader ? decodeURIComponent(savedPathHeader) : "";
      const disposition = response.headers.get("Content-Disposition") || "";
      const fileNameMatch = disposition.match(/filename\*=UTF-8''(.+)$/);
      const fileName = fileNameMatch ? decodeURIComponent(fileNameMatch[1]) : `쉽먼트생성_업로드파일_${waveId}.xlsx`;

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setResultMessage(
        `송장번호가 확인된 ${includedCount}개 행으로 생성했습니다` +
          (Number(excludedCount) > 0 ? ` (송장번호 없어 제외한 행 ${excludedCount}개)` : "") +
          (Number(excludedZeroCount) > 0 ? ` (납품수량 0으로 삭제한 행 ${excludedZeroCount}개)` : "") +
          (savedPath ? ` · 자동저장: ${savedPath}` : "")
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "쉽먼트 생성 업로드파일 생성 중 오류가 발생했습니다.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div>
      <p style={{ fontSize: "11px", color: wmsColors.muted, margin: "0 0 10px" }}>
        2단계의 한진 재출력 세부내역과 확정수량 입력 완료 파일을 결합해 Supplier Hub 쉽먼트
        생성용 업로드파일을 만듭니다. 현재 웨이브의 발주번호가 하나라도 누락되거나 물류센터가
        다르면 파일을 만들지 않습니다. 외부 사이트에는 자동 업로드하지 않습니다.
      </p>

      <label style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "48px", border: `1px dashed ${wmsColors.borderStrong}`, borderRadius: "10px", background: "#ffffff", color: wmsColors.ink, fontSize: "13px", fontWeight: 700, cursor: "pointer", marginBottom: "10px" }}>
        {confirmedFileName || "확정수량 입력 완료 파일 선택 (xlsx)"}
        <input type="file" accept=".xlsx" onChange={async event => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; setConfirmedFileName(file.name); setConfirmedFileBase64(await readFileAsBase64(file)); setError(null); setResultMessage(null); }} style={{ display: "none" }} />
      </label>

      {(!trackingFileBase64 || !confirmedFileBase64) && (
        <p style={{ fontSize: "12px", color: wmsColors.warnText, background: wmsColors.warnSoft, borderRadius: "8px", padding: "8px 10px", margin: "0 0 10px" }}>
          2단계의 재출력 세부내역과 확정수량 입력 완료 파일이 모두 있어야 실행할 수 있습니다.
        </p>
      )}

      {error && <p style={{ fontSize: "12px", color: "#c0392b", marginBottom: "8px" }}>{error}</p>}
      {resultMessage && <p style={{ fontSize: "12px", color: wmsColors.greenDark, marginBottom: "8px" }}>{resultMessage}</p>}

      <button
        onClick={handleGenerate}
        disabled={generating || !trackingFileBase64 || !confirmedFileBase64}
        style={{ ...wmsGreenDarkButton, width: "100%", opacity: generating || !trackingFileBase64 || !confirmedFileBase64 ? 0.5 : 1 }}
      >
        {generating ? "생성 중..." : "쉽먼트 생성 업로드파일 생성"}
      </button>
    </div>
  );
}
