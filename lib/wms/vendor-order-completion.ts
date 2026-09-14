import { listStatusRequests } from "./vendor-order-actions";
import { fetchProductCatalog } from "./product-catalog";
import { readWeeklyWorkspace } from "./weekly-work-store";
import { buildVendorOrderCompletionScope } from "./vendor-order/completion";
/** Read fresh completion evidence before new order output, consolidation or sending. Never writes any ledger. */
export async function loadVendorOrderCompletionContext() {
  const [requests, workspace, catalog] = await Promise.all([listStatusRequests(), readWeeklyWorkspace(), fetchProductCatalog()]);
  return { scope: buildVendorOrderCompletionScope(requests, workspace, catalog.items), catalogItems: catalog.items };
}

/** Existing callers only need the completion evidence. */
export async function loadVendorOrderCompletionScope() {
  return (await loadVendorOrderCompletionContext()).scope;
}
