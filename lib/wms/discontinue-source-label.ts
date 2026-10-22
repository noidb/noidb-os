/**
 * 2026-10-23 사용자 요청: 목록에 왜 떴는지 '기존탭 → 현재탭 (이동사유)'만 보이게.
 * 예) 제품DB → 비관리SKU (비관리(중복등록)) / 제품DB → 판매중지SKU (판매중지) / 제품DB (단종 · 정리 때 비관리SKU로)
 */
export function autoSourceLabel(row: { reason?: string; currentStatus?: string; origin?: string; moveReason?: string }): string {
  const reason = String(row.reason || "제품DB");
  const status = String(row.currentStatus || "").trim();
  // 이동사유 = 현재상태(비관리SKU 현재상태는 비어 있지 않다, 사용자 확인 2026-10-23)
  const why = String(status || row.moveReason || "").trim();
  const short = why.length > 30 ? `${why.slice(0, 30)}…` : why;
  if (["비관리SKU", "판매중지SKU", "실적저조SKU", "그 외 재등록SKU"].includes(reason)) {
    return `${row.origin && row.origin !== reason ? row.origin : "기존 탭 기록 없음"} → ${reason}${short ? ` (${short})` : ""}`;
  }
  if (reason === "제품DB") {
    const next = /판매중지/.test(status) ? " · 정리 때 판매중지SKU로" : /단종|비관리/.test(status) && !/해제/.test(status) ? " · 정리 때 비관리SKU로" : "";
    return `제품DB${status || next ? ` (${status}${next})` : ""}`;
  }
  return `제품DB (${reason})`;
}
