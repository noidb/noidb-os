import type { SupplierHubPurchaseOrder } from "./supplier-hub-orders";
export function summarizePurchaseOrder(order: SupplierHubPurchaseOrder) {
  return { skuCount: new Set(order.items.map(item => item.productCode).filter(Boolean)).size, totalQuantity: order.items.reduce((sum, item) => sum + Math.max(0, Number(item.orderedQuantity) || 0), 0) };
}
export function groupPurchaseOrdersForShipping(orders: readonly SupplierHubPurchaseOrder[]) {
  const groups = new Map<string, SupplierHubPurchaseOrder[]>();
  for (const order of orders) { const key = `${order.expectedDate || "입고예정일 미정"}\u0000${order.fulfillmentCenter || "물류센터 미정"}`; groups.set(key, [...(groups.get(key) || []), order]); }
  return [...groups.entries()].map(([key, grouped]) => ({
    key, expectedDate: grouped[0].expectedDate || "입고예정일 미정", fulfillmentCenter: grouped[0].fulfillmentCenter || "물류센터 미정", orders: grouped,
    orderCount: grouped.length, skuCount: new Set(grouped.flatMap(order => order.items.map(item => item.productCode)).filter(Boolean)).size,
    totalQuantity: grouped.reduce((sum, order) => sum + summarizePurchaseOrder(order).totalQuantity, 0),
  })).sort((a, b) => a.expectedDate.localeCompare(b.expectedDate) || a.fulfillmentCenter.localeCompare(b.fulfillmentCenter, "ko"));
}

export function toggleExpectedDateSelection(current: ReadonlySet<string>, dateOrders: readonly SupplierHubPurchaseOrder[]): Set<string> {
  const next = new Set(current);
  const poNumbers = dateOrders.map(order => order.purchaseOrderNumber);
  const allSelected = poNumbers.every(po => next.has(po));
  poNumbers.forEach(po => allSelected ? next.delete(po) : next.add(po));
  return next;
}
