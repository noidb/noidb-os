import type { WeeklyRun } from "./weekly-work-types";
import type { PickingWaveStoreSnapshot } from "./picking-wave/shared-store-types";
import type { StatusRequestRecord } from "./vendor-order-actions";

export interface ExistingWeeklyRouteLink {
  skuId: string;
  destination: "vendor" | "discontinue";
  recordIds: string[];
  relatedPurchaseOrderNumbers: string[];
  match: "purchase-order" | "existing-sku" | "status-request";
}

/** Read-only proposal. SKU-only matching must be explicitly selected for a repair. */
export function planExistingWeeklyRoutes(run: WeeklyRun, snapshot: PickingWaveStoreSnapshot, requests: StatusRequestRecord[], allowExistingSku = false): ExistingWeeklyRouteLink[] {
  const drafts = new Map(snapshot.vendorOrderDrafts.map(draft => [draft.id, draft]));
  const linked = new Set([...(run.routedElsewhereSkuIds || []), ...(run.vendorQueueTransfers || []).flatMap(transfer => transfer.lines.map(line => line.skuId))]);
  return run.snapshot.vendorItems.flatMap<ExistingWeeklyRouteLink>(item => {
    const review = run.reviews[item.skuId];
    if (!review || !["order", "discontinue"].includes(review.decision) || linked.has(item.skuId) || run.completedAt) return [];
    if (review.decision === "discontinue" && run.discontinueQueueRequestIds?.[item.skuId]?.length) return [];
    const status = requests.filter(request => request.skuId === item.skuId && request.requestType === "단종" && request.supplyHubStatus === "처리대기");
    if (status.length) return [{ skuId: item.skuId, destination: "discontinue" as const, recordIds: status.map(request => request.id), relatedPurchaseOrderNumbers: item.relatedPurchaseOrderNumbers, match: "status-request" as const }];
    if (review.decision !== "order" || run.sentVendors[review.vendorName]) return [];
    const candidates = snapshot.vendorOrderLines.filter(line => {
      const draft = drafts.get(line.draftId);
      return line.skuId === item.skuId && draft && (!draft.archivedAt || draft.status === "sent") && !snapshot.deletedVendorLineIds[line.id]
        && !line.orderExclusion && line.shortageQuantity > (line.receivedQuantity || 0);
    });
    const exact = candidates.filter(line => item.relatedPurchaseOrderNumbers.length && item.relatedPurchaseOrderNumbers.every(po => line.relatedPurchaseOrderNumbers.includes(po)));
    const chosen = exact.length ? exact : allowExistingSku ? candidates : [];
    if (!chosen.length || chosen.reduce((sum, line) => sum + line.shortageQuantity - (line.receivedQuantity || 0), 0) < item.shortageQuantity) return [];
    return [{ skuId: item.skuId, destination: "vendor" as const, recordIds: chosen.map(line => line.id), relatedPurchaseOrderNumbers: item.relatedPurchaseOrderNumbers, match: exact.length ? "purchase-order" as const : "existing-sku" as const }];
  });
}

export function applyExistingWeeklyRoutes(run: WeeklyRun, links: ExistingWeeklyRouteLink[], now: string) {
  const target = run as WeeklyRun & { existingRouteLinks?: Array<ExistingWeeklyRouteLink & { at: string }> };
  const existing = new Set(run.routedElsewhereSkuIds || []);
  const fresh = links.filter(link => !existing.has(link.skuId));
  if (!fresh.length) return run;
  run.routedElsewhereSkuIds = [...new Set([...existing, ...fresh.map(link => link.skuId)])];
  target.existingRouteLinks = [...(target.existingRouteLinks || []), ...fresh.map(link => ({ ...link, at: now }))];
  for (const link of fresh.filter(link => link.destination === "discontinue")) run.discontinueQueueRequestIds = { ...run.discontinueQueueRequestIds, [link.skuId]: link.recordIds };
  run.revision++; run.updatedAt = now;
  return run;
}
