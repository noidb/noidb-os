/**
 * Aside 2026-09-17 14:45 completed dispatch evidence. This PO must never
 * return to the new-order flow merely because it predates the InvoiceGroup store.
 */
export const ASIDE_COMPLETED_DISPATCHES = [{
  purchaseOrderNumber: "142638543",
  expectedDate: "2026-09-22",
  shipmentNumber: "50640740",
}] as const;

export function isAsideCompletedDispatchPurchaseOrder(purchaseOrderNumber: string) {
  return ASIDE_COMPLETED_DISPATCHES.some(item => item.purchaseOrderNumber === purchaseOrderNumber);
}
