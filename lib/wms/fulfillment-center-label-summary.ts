import type { PurchaseOrderSourceRecord } from "./purchase-order-source/types";

export interface FulfillmentCenterLabelSummary {
  fulfillmentCenter: string;
  expectedDate: string;
  purchaseOrderNumbers: string[];
  totalSku: number;
  totalQuantity: number;
}

/** 전달받은 generation의 Source-of-Truth 행만 센터+입고일 단위로 집계한다. */
export function summarizeFulfillmentCenterLabels(records: readonly PurchaseOrderSourceRecord[]): FulfillmentCenterLabelSummary[] {
  const groups = new Map<string, { center: string; date: string; poNumbers: Set<string>; skuIds: Set<string>; totalQuantity: number }>();
  for (const record of records) {
    const center = record.fulfillmentCenterName.trim();
    if (!center) continue;
    const key = `${center}\u0000${record.expectedArrivalDate}`;
    const group = groups.get(key) || { center, date: record.expectedArrivalDate, poNumbers: new Set<string>(), skuIds: new Set<string>(), totalQuantity: 0 };
    group.poNumbers.add(record.purchaseOrderNumber);
    if (record.skuId) group.skuIds.add(record.skuId);
    if (Number.isFinite(record.orderedQuantity) && record.orderedQuantity > 0) group.totalQuantity += record.orderedQuantity;
    groups.set(key, group);
  }
  return [...groups.values()].map(group => ({
    fulfillmentCenter: group.center,
    expectedDate: group.date,
    purchaseOrderNumbers: [...group.poNumbers].sort(),
    totalSku: group.skuIds.size,
    totalQuantity: group.totalQuantity,
  })).sort((a, b) => a.fulfillmentCenter.localeCompare(b.fulfillmentCenter, "ko") || a.expectedDate.localeCompare(b.expectedDate, "ko"));
}
