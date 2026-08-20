"use client";

import { wmsColors } from "@/lib/wms/ui-tokens";
import { RefreshIcon } from "../../icons";

/**
 * "제품DB 새로고침" 버튼 — 여러 화면(웨이브 상세/완료/완료 수정)에서 각자 다른 스타일로
 * 중복 구현돼 있던 것을 하나로 통일한다 (2026-08-19 4차 실사용 테스트 반영, 아이콘+그린 계열로
 * 구분). 실제 새로고침 동작(fetchLiveCatalogLookup 호출)은 각 페이지가 그대로 갖고 있고,
 * 이 컴포넌트는 버튼 UI만 재사용한다.
 */
/** label을 넘기면 기본 "제품DB 새로고침"/"새로고침 중..." 대신 그 문구를 쓴다(성공/실패 상태
 *  표시용, 2026-08-20 신규) — 넘기지 않는 기존 호출부는 동작이 전혀 바뀌지 않는다. */
export default function RefreshCatalogButton({
  onClick,
  loading,
  label,
  error,
}: {
  onClick: () => void;
  loading: boolean;
  label?: string;
  error?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        minHeight: "40px",
        padding: "0 12px",
        borderRadius: "10px",
        background: error ? wmsColors.warnSoft : wmsColors.greenSoft,
        color: error ? wmsColors.warnText : wmsColors.greenDark,
        border: `1px solid ${error ? wmsColors.warnSoftBorder : wmsColors.green}`,
        fontWeight: 800,
        fontSize: "12px",
        cursor: loading ? "default" : "pointer",
        opacity: loading ? 0.6 : 1,
        flexShrink: 0,
      }}
    >
      <RefreshIcon size={14} />
      {label ?? (loading ? "새로고침 중..." : "제품DB 새로고침")}
    </button>
  );
}
