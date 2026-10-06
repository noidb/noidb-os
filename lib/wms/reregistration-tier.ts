import type { SheetCellUpdate } from "./google-sheets";

export const REREGISTRATION_TIER_HEADER = "재등록구분";
export const REREGISTRATION_DONE_PREFIX = "재등록완료";

function kstDateStamp(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
}

/** 재등록 대상(1차·2차)이면 승인 완료 표시로 바꿀 값을, 아니면 null을 돌려준다. 원래 구분은 값 안에 남긴다. */
export function reregistrationDoneValue(current: unknown, now = new Date()): string | null {
  const tier = String(current ?? "").trim();
  if (!tier.startsWith("1차") && !tier.startsWith("2차")) return null;
  return `${REREGISTRATION_DONE_PREFIX}_${tier}_${kstDateStamp(now)}`;
}

/**
 * 제품DB에 "완료"를 쓰는 행 중 재등록구분이 1차·2차인 행은 재등록이 끝난 것이므로
 * 재등록구분을 "재등록완료_<원래구분>_<날짜>"로 바꿔 재등록 필요 목록에서 빠지게 한다.
 * 재등록구분 열이 없으면 아무것도 바꾸지 않는다.
 */
export function buildReregistrationDoneUpdates(sheetRows: string[][], approvedRowNumbers: Iterable<number>, now = new Date()): SheetCellUpdate[] {
  const headers = (sheetRows[0] || []).map(value => String(value ?? "").trim());
  const column = headers.indexOf(REREGISTRATION_TIER_HEADER);
  if (column < 0) return [];
  const updates: SheetCellUpdate[] = [];
  for (const row of new Set(approvedRowNumbers)) {
    const value = reregistrationDoneValue(sheetRows[row - 1]?.[column], now);
    if (value) updates.push({ row, col: column + 1, value });
  }
  return updates;
}
