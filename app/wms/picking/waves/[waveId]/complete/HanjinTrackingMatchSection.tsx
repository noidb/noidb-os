"use client";

import { useState } from "react";
import type { BasketAssignment } from "@/lib/wms/picking-wave/types";
import { readFileAsBase64 } from "@/lib/wms/file-base64";
import { wmsColors } from "@/lib/wms/ui-tokens";

interface Props {
  baskets: BasketAssignment[];
  /** 2단계 매칭이 끝나면 매칭 건수와 함께 업로드한 파일의 base64도 그대로 올려보낸다 — 3단계가
   *  이 실제 원본의 행 데이터로 쉽먼트 생성 업로드파일을 다시 만들 때 쓴다(2026-08-19 6차
   *  실사용 테스트 반영 — 1·3단계가 같은 파일을 만들던 문제를 고치기 위해 3단계가 2단계의
   *  실제 업로드 내용을 이어받도록 분리). */
  onMatchResult: (matchedCount: number, totalCount: number, fileBase64: string) => void;
}

interface MatchRow {
  purchaseOrderNumber: string;
  fulfillmentCenter: string;
  trackingNumber: string | null;
  matched: boolean;
}

/**
 * 발주확정 다음 단계 2단계 — 한진택배가 송장번호를 채워 돌려준 파일을 업로드해 현재 웨이브의
 * 발주서/물류센터와 매칭 미리보기를 보여준다. 매칭 실패 행은 임의로 연결하지 않고 그대로
 * "실패"로 표시한다 (2026-08-19 5차 실사용 테스트 신규).
 */
export default function HanjinTrackingMatchSection({ baskets, onMatchResult }: Props) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<MatchRow[] | null>(null);

  const targets = baskets.map(basket => ({ purchaseOrderNumber: basket.purchaseOrderNumber, fulfillmentCenter: basket.fulfillmentCenter }));

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setRows(null);
    setChecking(true);
    try {
      const base64 = await readFileAsBase64(file);
      const response = await fetch("/api/wms/hanjin-upload/match-tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64: base64, targets }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "송장번호 파일을 확인하지 못했습니다.");
        return;
      }
      setRows(data.results);
      onMatchResult(data.matchedCount, data.totalCount, base64);
    } catch (err) {
      setError(err instanceof Error ? err.message : "송장번호 파일을 확인하는 중 오류가 발생했습니다.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div>
      <p style={{ fontSize: "11px", color: wmsColors.muted, margin: "0 0 10px" }}>
        한진택배에서 받은 송장번호 입력 완료 파일을 선택하면, 현재 웨이브의 발주서/물류센터와 자동으로
        매칭해 보여줍니다. 매칭되지 않은 행은 임의로 연결하지 않습니다.
      </p>

      <label
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "48px",
          border: `1px dashed ${wmsColors.borderStrong}`,
          borderRadius: "10px",
          background: "#ffffff",
          color: wmsColors.ink,
          fontSize: "13px",
          fontWeight: 700,
          cursor: "pointer",
          marginBottom: "10px",
        }}
      >
        {fileName || "송장번호 입력 완료 파일 선택 (xlsx)"}
        <input type="file" accept=".xlsx" onChange={handleFileSelected} style={{ display: "none" }} />
      </label>

      {checking && <p style={{ fontSize: "12px", color: wmsColors.muted }}>매칭 확인 중...</p>}
      {error && <p style={{ fontSize: "12px", color: "#c0392b" }}>{error}</p>}

      {rows && (
        <div>
          <p style={{ fontSize: "12px", fontWeight: 700, margin: "0 0 8px", color: rows.every(r => r.matched) ? wmsColors.greenDark : wmsColors.warnText }}>
            매칭 성공 {rows.filter(r => r.matched).length}건 / 실패 {rows.filter(r => !r.matched).length}건
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {rows.map(row => (
              <div
                key={`${row.purchaseOrderNumber}-${row.fulfillmentCenter}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "11px",
                  padding: "6px 8px",
                  borderRadius: "6px",
                  background: row.matched ? wmsColors.greenSoft : wmsColors.warnSoft,
                }}
              >
                <span>
                  발주서 {row.purchaseOrderNumber} · {row.fulfillmentCenter}
                </span>
                <span style={{ fontWeight: 700, color: row.matched ? wmsColors.greenDark : wmsColors.warnText }}>
                  {row.matched ? `송장번호 ${row.trackingNumber}` : "매칭 실패"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
