import { createHash } from "node:crypto";
import { cachedParsedFile } from "./parsed-file-cache";
import { loadHistoricalInboundEvents } from "./vendor-order/actual-inbound-history";
type History = Awaited<ReturnType<typeof loadHistoricalInboundEvents>>;
const version = "historical-inbound-collection-v1";
const descriptor = { source: "historical-inbound", account: "noidb" };
const valid = (value: unknown): value is History => Boolean(value && typeof value === "object" && Array.isArray((value as History).events) && Array.isArray((value as History).parseFailures));
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Normal page reads never enumerate Drive. Only an explicit refresh populates this existing parse cache. */
export async function readSavedInboundHistory() {
  return cachedParsedFile(version, descriptor, async () => { throw new Error("과거 누적 저장본이 없습니다. ‘과거 원본 새로고침’을 눌러 한 번 가져와 주세요."); }, valid);
}
export async function refreshSavedInboundHistory() {
  const previous = await readSavedInboundHistory().catch(() => null);
  try {
    const next = await loadHistoricalInboundEvents();
    if (next.parseFailures.length) throw new Error("일부 과거 입고 파일을 읽지 못해 기존 저장본을 유지했습니다.");
    if (previous && hash(previous) === hash(next)) return { value: previous, changed: false };
    const value = await cachedParsedFile(version, descriptor, async () => ({ value: next, contentHash: hash(next) }), valid, true);
    return { value, changed: true };
  } catch (error) {
    if (!previous) throw error;
    return { value: previous, changed: false, warning: error instanceof Error ? error.message : "Drive 오류로 저장본을 표시합니다." };
  }
}
