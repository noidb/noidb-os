/**
 * Hides the old picking-flow provenance marker from vendor-order displays.
 * The persisted memo remains untouched so historical records stay intact.
 */
const LEGACY_PICKING_PROVENANCE_MEMO = "피킹 목록에서 추가";

/** 입고결과(미납 SKU)에서 보낼 때 넣었던 내부 메모 — 거래처 카드에 찍히면 안 된다(2026-10-08). */
const LOGISTICS_INTERNAL_MEMO = /^쉽먼트 \d+ · 거래처\/이미지\/주문수량 검토 필요$/;

export function displayVendorOrderMemo(memo: string): string {
  const trimmed = memo.trim();
  return trimmed === LEGACY_PICKING_PROVENANCE_MEMO || LOGISTICS_INTERNAL_MEMO.test(trimmed) ? "" : memo;
}
