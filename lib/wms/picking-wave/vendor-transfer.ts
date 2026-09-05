import { proposeShortageAllocation } from "./allocate";
import type { PickingWaveItem } from "./types";

export interface VendorTransferSelection {
  productCode: string;
  shortageQuantity: string;
}

/** A suggestion only: no picking or vendor state changes before the user confirms it. */
export function suggestVendorTransferQuantity(item: PickingWaveItem): number {
  return item.status === "pending"
    ? Math.max(0, item.totalQuantity - item.pickedQuantity)
    : Math.max(0, item.shortageQuantity);
}

export function preparePickingVendorTransfer(
  items: readonly PickingWaveItem[],
  selections: readonly VendorTransferSelection[],
  now: string,
): { transferItems: PickingWaveItem[]; changedItems: PickingWaveItem[] } {
  const byCode = new Map(items.map(item => [item.productCode, item]));
  const seen = new Set<string>();
  const transferItems: PickingWaveItem[] = [];
  const changedItems: PickingWaveItem[] = [];
  for (const selection of selections) {
    const item = byCode.get(selection.productCode);
    if (!item || seen.has(selection.productCode)) throw new Error("선택 상품이 변경되었거나 중복되었습니다. 목록을 다시 확인해 주세요.");
    seen.add(selection.productCode);
    const text = selection.shortageQuantity.trim();
    const quantity = Number(text);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(quantity) || quantity > item.totalQuantity) {
      throw new Error(`SKU ${item.productCode}: 부족수량은 0~${item.totalQuantity} 사이의 정수로 입력해 주세요.`);
    }
    // Zero means do not transfer; it must never silently mark a pending item as found.
    if (quantity === 0) continue;
    if (item.sources.reduce((sum, source) => sum + source.requestedQuantity, 0) !== item.totalQuantity) {
      throw new Error(`SKU ${item.productCode}: 발주서 수량 합계가 일치하지 않아 저장하지 않았습니다.`);
    }
    if (item.status !== "pending" && item.shortageQuantity === quantity) {
      transferItems.push(item);
      continue;
    }
    const pickedQuantity = item.totalQuantity - quantity;
    const updated: PickingWaveItem = {
      ...item,
      status: quantity === item.totalQuantity ? "notfound" : "partial",
      pickedQuantity,
      shortageQuantity: quantity,
      allocations: proposeShortageAllocation(item.sources, pickedQuantity),
      updatedAt: now,
    };
    transferItems.push(updated);
    changedItems.push(updated);
  }
  return { transferItems, changedItems };
}
