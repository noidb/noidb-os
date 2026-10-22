import { appendSheetRowsKeepingFormulas, ensureHiddenSheet, fetchSheetRows } from "./google-sheets";
import { listStatusRequests } from "./vendor-order-actions";
import { collectSiteDiscontinueHistory } from "./discontinue-history";

/**
 * 단종 기록(사용자 요청 2026-10-22): 사이트 어디서든 단종으로 보낸 SKU를 날짜와 함께 영구히 남긴다.
 * 단종 신청 목록을 비우거나 탭을 옮겨도 이 기록은 지우지 않는다(추가만 한다).
 * 기록 실패가 본래 작업을 막지 않도록 오류는 삼킨다.
 */
export const DISCONTINUE_LOG_SHEET = "_WMS단종기록";
export const DISCONTINUE_LOG_HEADERS = ["기록일시", "SKU ID", "경로", "내용"];

export async function logDiscontinue(skuIds: readonly string[], path: string, note = ""): Promise<void> {
  const ids = [...new Set(skuIds.map(id => String(id ?? "").trim()).filter(id => /^\d{5,20}$/.test(id)))];
  if (!ids.length) return;
  try {
    await ensureHiddenSheet(DISCONTINUE_LOG_SHEET, DISCONTINUE_LOG_HEADERS);
    const at = new Date(Date.now() + 9 * 3600_000).toISOString().replace("T", " ").slice(0, 19);
    await appendSheetRowsKeepingFormulas(DISCONTINUE_LOG_SHEET, ids.map(id => [at, id, path, note.slice(0, 300)]));
  } catch { /* 기록 실패는 본래 작업을 막지 않는다 */ }
}

/** SKU별로 처음 단종으로 보낸 날짜(YYYY-MM-DD)와 보낸 날 수. 이 기록 탭 + 예전 단종해제이력 탭(단종 요청). */
export async function readDiscontinueSentDates(): Promise<Record<string, { first: string; days: number }>> {
  const days = new Map<string, Set<string>>();
  const keep = (skuId: string, date: string) => {
    const id = String(skuId ?? "").trim();
    if (!/^\d{5,20}$/.test(id) || !/^\d{4}-\d{2}-\d{2}/.test(date)) return;
    if (!days.has(id)) days.set(id, new Set());
    days.get(id)!.add(date.slice(0, 10));
  };
  const [rows, requests, history] = await Promise.all([
    fetchSheetRows(DISCONTINUE_LOG_SHEET).catch(() => [] as string[][]),
    listStatusRequests().catch(() => []),
    collectSiteDiscontinueHistory().catch(() => null),
  ]);
  // 이 기록 탭을 만들기 전(2026-10-22 이전)의 사이트 기록도 함께 본다.
  for (const [skuId, set] of history?.events || []) for (const event of set) { const date = event.split("@")[1]; if (date) keep(skuId, date); }
  for (const row of rows.slice(1)) keep(String(row[1] ?? ""), String(row[0] ?? ""));
  for (const request of requests) {
    const type = String(request.requestType || "");
    if (type.includes("단종") && !type.includes("해제")) keep(request.skuId, String(request.requestedAt || ""));
  }
  return Object.fromEntries([...days].map(([id, set]) => [id, { first: [...set].sort()[0], days: set.size }]));
}
