/**
 * 2026-10-23 사용자 요청: 목록에 '기존탭 → 현재탭 (이동사유)'만 보이게.
 * 현재탭은 시트에서 그 SKU가 지금 실제로 있는 탭(currentTab)이다 — 그 탭에서 바로 검색할 수 있게.
 * 어디서 왔는지 모르면 '현재탭 (이동사유)'만 보인다.
 * 예) 제품DB → 비관리SKU (비관리(중복등록)) / 판매중지SKU (판매중지) / 제품DB (단종 · 정리 때 비관리SKU로)
 */
const TABS = ["제품DB", "비관리SKU", "판매중지SKU", "실적저조SKU", "그 외 재등록SKU"];

export function autoSourceLabel(row: { reason?: string; currentStatus?: string; origin?: string; moveReason?: string; currentTab?: string }): string {
  const reason = String(row.reason || "제품DB");
  const status = String(row.currentStatus || "").trim();
  // 이동사유 = 현재상태. 비어 있으면 보관사유, 그것도 없으면 목록에 오른 이유(예: 재등록완료 옛 SKU)
  const why = status || String(row.moveReason || "").trim() || (TABS.includes(reason) ? "" : reason);
  const short = why.length > 30 ? `${why.slice(0, 30)}…` : why;
  const current = String(row.currentTab || "").trim() || (TABS.includes(reason) ? reason : "제품DB");
  const next = current === "제품DB" ? (/판매중지/.test(status) ? " · 정리 때 판매중지SKU로" : /단종|비관리/.test(status) && !/해제/.test(status) ? " · 정리 때 비관리SKU로" : "") : "";
  const origin = row.origin && row.origin !== current && !current.includes(row.origin) ? `${row.origin} → ` : "";
  const tail = short || next ? ` (${short}${next})` : "";
  return `${origin}${current}${tail}`;
}
