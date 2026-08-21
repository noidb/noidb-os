"use client";

import { useState } from "react";
import WorkCenterMenuButton from "./WorkCenterMenuButton";
import { RefreshIcon } from "../icons";
import { wmsColors, wmsGhostButton } from "@/lib/wms/ui-tokens";
import type { SupplyStatusPreview, MatchedRow } from "@/lib/wms/supply-status-update";

type ApplyResult = {
  applied: boolean;
  preview: SupplyStatusPreview;
  backupPath?: string;
  writtenCount: number;
  statusOnlyCount: number;
};

/**
 * 작업센터 "상품공급상태 업데이트" 버튼 (2026-08-20 신규). 클릭 시:
 * 1) /api/wms/supply-status/preview로 읽기 전용 안전 확인(대상 0건이면 여기서 끝, 쓰기 요청
 *    자체를 보내지 않는다) 2) 대상이 있으면 confirm 창으로 최종 확인 3) 승인 시 apply 호출
 * 4) 결과 요약 + 상세보기 표시. 서비스 계정 키·OAuth 토큰 등은 이 화면 어디에도 노출하지 않는다.
 */
export default function SupplyStatusUpdateButton() {
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const label = state === "loading" ? "업데이트 중..." : state === "success" ? "업데이트 완료" : state === "error" ? "업데이트 실패 · 다시 시도" : "상품공급상태 업데이트";

  async function handleClick() {
    if (state === "loading") return;
    setState("loading");
    setMessage(null);

    try {
      const previewRes = await fetch("/api/wms/supply-status/preview", { cache: "no-store" });
      const preview = await previewRes.json();
      if (!previewRes.ok) {
        setState("error");
        setMessage(preview.error || "상품공급상태 확인에 실패했습니다.");
        return;
      }

      if (preview.pendingCount === 0) {
        setState("idle");
        setMessage(`현재 "기존상품승인대기/신상승인대기" 상태인 상품이 없습니다. (파일: ${preview.fileName})`);
        return;
      }

      if (preview.eligibleCount === 0) {
        setState("idle");
        setMessage(
          `승인대기 ${preview.pendingCount}개를 확인했지만 실제로 반영할 수 있는 항목이 없습니다` +
            (preview.matchKeyColumnHeader
              ? ` (미매칭 ${preview.unmatchedCount}, 중복 ${preview.duplicateCount}, 충돌 ${preview.conflictCount}).`
              : ` (미매칭 ${preview.unmatchedCount}, 중복 ${preview.duplicateCount}, 충돌 ${preview.conflictCount}).`)
        );
        setResult({ applied: false, preview, writtenCount: 0, statusOnlyCount: 0 });
        return;
      }

      const confirmed = window.confirm(
        `최신 상품공급상태관리 파일(${preview.fileName})을 기준으로\n` +
          `승인 완료 ${preview.eligibleCount}개 상품의 SKU ID·바코드·발주가능상태·현재상태를 업데이트합니다.\n\n` +
          `(미매칭 ${preview.unmatchedCount}건, 중복 ${preview.duplicateCount}건, 충돌 ${preview.conflictCount}건은 건드리지 않습니다)`
      );
      if (!confirmed) {
        setState("idle");
        return;
      }

      const applyRes = await fetch("/api/wms/supply-status/apply", { method: "POST" });
      const applyData: ApplyResult = await applyRes.json();
      if (!applyRes.ok) {
        setState("error");
        setMessage((applyData as any).error || "상품공급상태 업데이트에 실패했습니다.");
        return;
      }

      setResult(applyData);
      setState("success");
      setMessage(null);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "상품공급상태 업데이트 중 오류가 발생했습니다.");
    }
  }

  return (
    <div>
      <WorkCenterMenuButton
        icon={<RefreshIcon size={26} color={wmsColors.greenDark} />}
        title={label}
        tint={wmsColors.greenSoft}
        borderTint={wmsColors.green}
        textColor={wmsColors.greenDark}
        onClick={handleClick}
        disabled={state === "loading"}
      />

      {message && (
        <p style={{ fontSize: "11px", color: state === "error" ? "#c0392b" : wmsColors.muted, margin: "6px 2px 0" }}>{message}</p>
      )}

      {result && (
        <div
          style={{
            marginTop: "8px",
            border: `1px solid ${wmsColors.border}`,
            borderRadius: "10px",
            padding: "10px 12px",
            background: wmsColors.surfaceBeige,
            fontSize: "12px",
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: "6px" }}>
            {result.applied ? "상품공급상태 업데이트 완료" : "상품공급상태 확인 결과"}
          </div>
          <ul style={{ margin: 0, paddingLeft: "16px", lineHeight: 1.7 }}>
            <li>확인한 승인대기 상품: {result.preview.pendingCount}개</li>
            <li>SKU ID 입력: {result.writtenCount - result.statusOnlyCount}개</li>
            <li>현재상태 변경: {result.writtenCount}개</li>
            <li>바코드·발주가능상태 갱신: {result.writtenCount}개</li>
            <li>이미 동일한 SKU ID: {result.statusOnlyCount}개</li>
            <li>미매칭: {result.preview.unmatchedCount}개</li>
            <li>충돌: {result.preview.conflictCount}개</li>
          </ul>

          <button onClick={() => setShowDetail(prev => !prev)} style={{ ...wmsGhostButton, minHeight: "32px", fontSize: "11px", padding: "0 10px", marginTop: "8px" }}>
            {showDetail ? "상세 결과 숨기기" : "상세 결과 보기"}
          </button>

          {showDetail && (
            <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "4px", maxHeight: "260px", overflowY: "auto" }}>
              {result.preview.rows.map((row: MatchedRow) => (
                <div key={row.sheetRowNumber} style={{ background: "#ffffff", borderRadius: "6px", padding: "6px 8px", fontSize: "11px" }}>
                  <div style={{ fontWeight: 700 }}>
                    {row.modelSku} {row.eligible ? <span style={{ color: wmsColors.greenDark }}>· 반영됨</span> : <span style={{ color: wmsColors.warn }}>· 미반영</span>}
                  </div>
                  {row.eligible && row.downloadSkuId && <div>입력 SKU ID: {row.downloadSkuId}</div>}
                  {row.reasons.length > 0 && <div style={{ color: wmsColors.muted }}>{row.reasons.join(" / ")}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
