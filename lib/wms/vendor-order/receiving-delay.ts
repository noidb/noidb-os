import { normalizeSkuId } from "../sku-normalize";

export interface ReceivingDelaySummary {
  skuId: string;
  recentDelayedAt: string;
  active: boolean;
  lastActionAt: string;
  vendorName?: string;
  memo?: string;
}

/** Pure reader for the existing 11-column log and its optional trailing memo column. */
export function summarizeReceivingDelayRows(rows: string[][]): ReceivingDelaySummary[] {
  const summaries = new Map<string, ReceivingDelaySummary>();
  for (const row of rows.slice(1)) {
    const skuId = normalizeSkuId(row[1]);
    if (!skuId) continue;
    const previous = summaries.get(skuId);
    const delayed = String(row[7] || "") === "입고지연";
    summaries.set(skuId, {
      skuId,
      recentDelayedAt: delayed ? String(row[8] || "") : previous?.recentDelayedAt || "",
      active: String(row[10] || "") === "입고지연",
      lastActionAt: String(row[8] || ""),
      vendorName: String(row[5] || ""),
      memo: String(row[11] || ""),
    });
  }
  return [...summaries.values()];
}

export function receivingDelayDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "날짜 확인 필요";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (name: string) => parts.find(value => value.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function validateReceivingDelayChange(input: { delayed: unknown; expectedLastActionAt?: unknown; memo?: unknown }, previous?: ReceivingDelaySummary) {
  if (typeof input.delayed !== "boolean") throw new Error("입고지연 처리 구분을 확인해 주세요.");
  if (input.expectedLastActionAt !== undefined && input.expectedLastActionAt !== null && typeof input.expectedLastActionAt !== "string") throw new Error("입고지연 조회 상태가 올바르지 않습니다.");
  // A successful response lost in transit can be retried without appending the same state again.
  if (Boolean(previous?.active) === input.delayed) return { changed: false, memo: previous?.memo || "" };
  if (input.expectedLastActionAt !== undefined && (input.expectedLastActionAt || "") !== (previous?.lastActionAt || "")) throw new Error("입고지연 상태가 다른 화면에서 변경됐습니다. 최신 상태를 확인한 후 다시 처리해 주세요.");
  const memo = String(input.memo ?? "").trim();
  if (memo.length > 500) throw new Error("입고지연 메모는 500자 이내로 입력해 주세요.");
  return { changed: true, memo };
}
