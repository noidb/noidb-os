import { projectInboundLifecycle } from "./inbound-lifecycle";
import { emptyPickingWaveStoreSnapshot } from "./picking-wave/shared-store-types";
import type { SupplierHubInboundEvent } from "./picking-wave/shared-store-types";
import type { SupplierHubPurchaseOrder, SupplierHubPurchaseOrderSnapshotConflict } from "./supplier-hub-orders";
import { selectLatestSupplierHubPurchaseOrderSnapshots } from "./supplier-hub-orders";
import type { WeeklyWorkspace } from "./weekly-work-types";
import type { HistoricalInboundEvent } from "./vendor-order/actual-inbound-history";

const clean = (value: unknown) => String(value ?? "").trim();
const pairKey = (purchaseOrderNumber: string, skuId: string) => JSON.stringify([clean(purchaseOrderNumber), clean(skuId)]);
export const supplierHubInboundEventFiveFieldKey = (event: Pick<SupplierHubInboundEvent, "orderNo" | "skuId" | "inboundDate" | "quantity" | "division">) => JSON.stringify([
  clean(event.orderNo), clean(event.skuId), clean(event.inboundDate), clean(event.quantity), clean(event.division),
]);

function eventQuantity(value: string): number {
  const quantity = Number(clean(value).replace(/,/g, ""));
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

export function uniqueSupplierHubInboundEvents(events: readonly SupplierHubInboundEvent[]): SupplierHubInboundEvent[] {
  return [...new Map(events.map(event => [supplierHubInboundEventFiveFieldKey(event), event])).values()];
}

export function mergeStoredSupplierHubPurchaseOrders(
  existing: readonly SupplierHubPurchaseOrder[],
  incoming: readonly SupplierHubPurchaseOrder[],
): { orders: SupplierHubPurchaseOrder[]; conflicts: SupplierHubPurchaseOrderSnapshotConflict[] } {
  const selected = selectLatestSupplierHubPurchaseOrderSnapshots([...existing, ...incoming]);
  if (!selected.conflicts.length) return selected;
  const conflicted = new Set(selected.conflicts.map(conflict => conflict.purchaseOrderNumber));
  const preserved = existing.filter(order => conflicted.has(order.purchaseOrderNumber));
  return {
    orders: [...selected.orders, ...preserved].sort((a, b) => a.purchaseOrderNumber.localeCompare(b.purchaseOrderNumber)),
    conflicts: selected.conflicts,
  };
}

export function summarizeSupplierHubInboundByMonth(events: readonly SupplierHubInboundEvent[]) {
  const byMonthSku = new Map<string, { year: number; month: number; skuId: string; actualReceivedQuantity: number; details: Array<{ purchaseOrderNumber: string; skuId: string; actualReceivedQuantity: number; inboundDate: string }> }>();
  for (const event of uniqueSupplierHubInboundEvents(events)) {
    const date = clean(event.inboundDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
    const quantity = eventQuantity(event.quantity);
    const skuId = clean(event.skuId), purchaseOrderNumber = clean(event.orderNo);
    if (!date || !quantity || !skuId || !purchaseOrderNumber) continue;
    const year = Number(date[1]), month = Number(date[2]), key = JSON.stringify([year, month, skuId]);
    const row = byMonthSku.get(key) || { year, month, skuId, actualReceivedQuantity: 0, details: [] };
    row.actualReceivedQuantity += quantity;
    row.details.push({ purchaseOrderNumber, skuId, actualReceivedQuantity: quantity, inboundDate: clean(event.inboundDate) });
    byMonthSku.set(key, row);
  }
  return [...byMonthSku.values()].sort((a, b) => b.year - a.year || b.month - a.month || a.skuId.localeCompare(b.skuId));
}

export function summarizeCombinedInboundByMonth(
  currentEvents: readonly SupplierHubInboundEvent[],
  historicalEvents: readonly HistoricalInboundEvent[],
) {
  const combined = [...currentEvents, ...historicalEvents];
  const byMonthSku = new Map<string, { year: number; month: number; skuId: string; actualReceivedQuantity: number; details: Array<{ purchaseOrderNumber: string; skuId: string; actualReceivedQuantity: number; inboundDate: string; sourceFile?: string }> }>();
  const seen = new Set<string>();
  for (const event of combined) {
    const orderNo = clean(event.orderNo), skuId = clean(event.skuId), inboundDate = clean(event.inboundDate);
    const division = clean(event.division), quantity = eventQuantity(event.quantity);
    const date = inboundDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const key = supplierHubInboundEventFiveFieldKey({ orderNo, skuId, inboundDate, quantity: clean(event.quantity), division });
    if (seen.has(key) || !date || !quantity || !skuId || !orderNo) continue;
    seen.add(key);
    const year = Number(date[1]), month = Number(date[2]), groupKey = JSON.stringify([year, month, skuId]);
    const row = byMonthSku.get(groupKey) || { year, month, skuId, actualReceivedQuantity: 0, details: [] };
    row.actualReceivedQuantity += quantity;
    row.details.push({ purchaseOrderNumber: orderNo, skuId, actualReceivedQuantity: quantity, inboundDate, ...("sourceFile" in event ? { sourceFile: event.sourceFile } : {}) });
    byMonthSku.set(groupKey, row);
  }
  return [...byMonthSku.values()].sort((a, b) => b.year - a.year || b.month - a.month || a.skuId.localeCompare(b.skuId));
}

export function projectActiveSupplierHubPurchaseOrders(input: {
  orders: readonly SupplierHubPurchaseOrder[]; events: readonly SupplierHubInboundEvent[]; workspace: WeeklyWorkspace;
  store?: import("./picking-wave/shared-store-types").PickingWaveStoreSnapshot;
}) {
  const store = { ...(input.store || emptyPickingWaveStoreSnapshot()), supplierHubInboundEvents: [...input.events] };
  return projectInboundLifecycle({ orders: input.orders, store, workspace: input.workspace });
}
