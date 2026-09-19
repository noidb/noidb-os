/**
 * Hides the old picking-flow provenance marker from vendor-order displays.
 * The persisted memo remains untouched so historical records stay intact.
 */
const LEGACY_PICKING_PROVENANCE_MEMO = "피킹 목록에서 추가";

export function displayVendorOrderMemo(memo: string): string {
  return memo.trim() === LEGACY_PICKING_PROVENANCE_MEMO ? "" : memo;
}
