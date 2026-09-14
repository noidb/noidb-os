import type { ProductCatalogItem } from "./product-catalog";
import { fetchProductCatalog } from "./product-catalog";
import { normalizeSkuId } from "./sku-normalize";
import { listStatusRequests, type StatusRequestRecord } from "./vendor-order-actions";
import { weeklyReviewToken } from "./weekly-work-state";
import type { WeeklyRun, WeeklyVendorItem } from "./weekly-work-types";

export interface WeeklyDiscontinueQueueSource {
  requests: StatusRequestRecord[];
  catalogItems: ProductCatalogItem[];
}

/** Reading the queue never creates a Sheet or changes product status. */
export async function readWeeklyDiscontinueQueue(): Promise<WeeklyDiscontinueQueueSource> {
  const [requests, catalog] = await Promise.all([
    listStatusRequests(),
    fetchProductCatalog().catch(() => ({ configured: false, items: [] as ProductCatalogItem[] })),
  ]);
  return { requests, catalogItems: catalog.items };
}

/** Merge only explicitly pending requests. Quantities from receipt analysis are
 * retained; a queue-only product does not invent a shortage or vendor order. */
export function syncWeeklyDiscontinueQueue(run: WeeklyRun, source: WeeklyDiscontinueQueueSource, now = new Date().toISOString()): number {
  if (run.pendingDiscontinueSubmission) throw new Error("단종 신청 완료 연결을 먼저 마무리해 주세요.");
  const requestLinks = { ...(run.discontinueQueueRequestIds || {}) };
  const catalog = new Map(source.catalogItems.map(item => [normalizeSkuId(item.skuId), item]));
  const requestsById = new Map(source.requests.map(request => [request.id, request]));
  const pending = new Map<string, StatusRequestRecord[]>();
  for (const request of source.requests) {
    const skuId = normalizeSkuId(request.skuId);
    if (!skuId || !request.id || request.requestType !== "단종" || request.supplyHubStatus !== "처리대기") continue;
    const group = pending.get(skuId) || [];
    if (!group.some(item => item.id === request.id)) group.push(request);
    pending.set(skuId, group);
  }
  const submitted = new Set(run.discontinueSubmittedSkuIds || (run.discontinueSubmittedAt
    ? Object.values(run.reviews).filter(review => review.decision === "discontinue").map(review => review.skuId) : []));
  let changed = false;
  let added = 0;
  let pendingAdded = false;
  const changedVendors = new Set<string>();

  for (const [skuId, linkedIds] of Object.entries(requestLinks)) {
    if (run.reviews[skuId]?.decision !== "discontinue" || submitted.has(skuId) || !linkedIds.length) continue;
    // Completion elsewhere removes this task too, while keeping source rows and links as history.
    if (linkedIds.every(id => requestsById.get(id)?.supplyHubStatus === "처리완료")) {
      submitted.add(skuId); changed = true;
    }
  }

  for (const [skuId, requests] of pending) {
    const oldIds = requestLinks[skuId] || [];
    const ids = [...new Set([...oldIds, ...requests.map(request => request.id)])].sort();
    const hasNewRequest = requests.some(request => !oldIds.includes(request.id));
    // A persisted weekly completion is authoritative during retry of its Sheet acknowledgement.
    if (!hasNewRequest && submitted.has(skuId)) continue;
    if (!hasNewRequest) continue;
    requestLinks[skuId] = ids;
    changed = true; pendingAdded = true;
    submitted.delete(skuId);
    const request = requests[0];
    const product = catalog.get(skuId);
    let item = run.snapshot.vendorItems.find(item => normalizeSkuId(item.skuId) === skuId);
    if (!item) {
      item = {
        skuId, productName: product?.productName || request.productName,
        productLink: product?.productLink || request.productLink,
        vendorName: product?.vendorName || "", imageUrl: product?.imageUrl || "",
        optionLabel: product?.optionLabel || request.optionLabel, modelName: product?.modelName || request.modelSku,
        barcode: product?.barcode || "", shortageQuantity: 0, openOrderQuantity: 0, suggestedQuantity: 0,
        relatedPurchaseOrderNumbers: [...new Set(requests.map(record => record.purchaseOrderNumber).filter(Boolean))],
        issues: [], discontinued: product?.currentStatus === "단종",
      } satisfies WeeklyVendorItem;
      run.snapshot.vendorItems.push(item);
      added++;
    }
    const previous = run.reviews[item.skuId];
    if (previous?.decision === "order") changedVendors.add(previous.vendorName);
    run.reviews[item.skuId] = {
      skuId: item.skuId, vendorName: previous?.vendorName || item.vendorName,
      imageUrl: previous?.imageUrl || item.imageUrl, quantity: previous?.quantity ?? item.suggestedQuantity,
      quantityConfirmed: previous?.quantityConfirmed ?? false, decision: "discontinue",
    };
    run.reviewedSkuIds = [...new Set([...(run.reviewedSkuIds || []), item.skuId])];
  }

  if (!changed) return 0;
  run.discontinueQueueRequestIds = requestLinks;
  run.discontinueSubmittedSkuIds = [...submitted].sort();
  if (pendingAdded) run.discontinueSubmittedAt = undefined;
  if (pendingAdded) run.completedAt = undefined;
  run.revision++;
  run.updatedAt = now;
  if (run.generated) run.generated = {
    ...run.generated,
    reviewToken: weeklyReviewToken(run),
    discontinueCount: 0,
    vendors: run.generated.vendors.filter(vendor => !changedVendors.has(vendor)),
  };
  return added;
}

/** Immutable IDs let the status route acknowledge exactly the generated request
 * set after the user confirms external upload, without completing later arrivals. */
export function weeklyDiscontinueQueueRequestIds(run: WeeklyRun, skuIds?: readonly string[]): string[] {
  const selected = new Set((skuIds || Object.values(run.reviews).filter(review => review.decision === "discontinue"
    && !run.discontinueSubmittedSkuIds?.includes(review.skuId)).map(review => review.skuId)).map(normalizeSkuId));
  return [...new Set(Object.entries(run.discontinueQueueRequestIds || {})
    .filter(([skuId]) => selected.has(normalizeSkuId(skuId))).flatMap(([, ids]) => ids))].sort();
}
