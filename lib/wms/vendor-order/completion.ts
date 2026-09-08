import { normalizeSkuId } from "../sku-normalize";
import type { StatusRequestRecord } from "../vendor-order-actions";
import type { WeeklyWorkspace } from "../weekly-work-types";
import type { VendorOrderDraft, VendorOrderDraftLine, VendorOrderDraftStatus } from "./types";
export interface VendorCompletionEvidence { skuId: string; kind: "discontinue" | "reorder"; completedAt: string; sourceId: string; purchaseOrderNumbers: string[]; shortageQuantity?: number }
export interface VendorOrderCompletionScope { checkedAt: string; discontinued: VendorCompletionEvidence[]; reorders: VendorCompletionEvidence[]; demandSources?: Array<{ skuId: string; createdAt: string; purchaseOrderNumbers: string[]; actualShortageQuantity: number; shortageDetails: Array<{ purchaseOrderNumber: string; shortageQuantity: number }> }> }
export interface VendorOrderExclusion extends VendorCompletionEvidence { reason: string; excludedAt: string }
const at = (value?: string) => Number.isFinite(Date.parse(value || "")) ? Date.parse(value!) : 0;
const ids = (values: readonly string[]) => [...new Set(values.map(normalizeSkuId).filter(Boolean))];
/** Pending decisions and productOverrides are deliberately not completion evidence. */
export function buildVendorOrderCompletionScope(requests: readonly StatusRequestRecord[], workspace: WeeklyWorkspace,
  products: readonly { skuId: string; currentStatus: string }[], checkedAt = new Date().toISOString()): VendorOrderCompletionScope {
  const events = new Map<string, { stopped: boolean; evidence: VendorCompletionEvidence }>();
  const add = (sku: string, stopped: boolean, completedAt: string, sourceId: string) => {
    const skuId = normalizeSkuId(sku); if (!skuId || !at(completedAt)) return;
    const prior = events.get(skuId);
    if (!prior || at(prior.evidence.completedAt) < at(completedAt) || at(prior.evidence.completedAt) === at(completedAt) && !stopped) {
      events.set(skuId, { stopped, evidence: { skuId, kind: "discontinue", completedAt, sourceId, purchaseOrderNumbers: [] } });
    }
  };
  for (const request of requests) if (request.supplyHubStatus === "처리완료" && ["단종", "단종해제"].includes(request.requestType)) {
    add(request.skuId, request.requestType === "단종", request.completedAt, request.id);
  }
  const reorders: VendorCompletionEvidence[] = [];
  const demandSources: NonNullable<VendorOrderCompletionScope["demandSources"]> = [];
  for (const run of workspace.runs) {
    for (const item of run.snapshot.vendorItems || []) if (item.shortageDetails?.length && Number.isSafeInteger(item.shortageQuantity) && item.shortageQuantity > 0 && item.shortageDetails.every(detail => Number.isSafeInteger(detail.shortageQuantity) && detail.shortageQuantity >= 0 && detail.confirmedQuantity - detail.receivedQuantity === detail.shortageQuantity) && item.shortageDetails.reduce((sum, detail) => sum + detail.shortageQuantity, 0) === item.shortageQuantity) {
      demandSources.push({ skuId: normalizeSkuId(item.skuId), createdAt: run.snapshot.createdAt, purchaseOrderNumbers: ids(item.relatedPurchaseOrderNumbers), actualShortageQuantity: item.shortageQuantity, shortageDetails: item.shortageDetails.map(detail => ({ purchaseOrderNumber: normalizeSkuId(detail.purchaseOrderNumber), shortageQuantity: detail.shortageQuantity })) });
    }
    const submitted = run.discontinueSubmittedSkuIds || (run.discontinueSubmittedAt ? Object.values(run.reviews).filter(review => review.decision === "discontinue").map(review => review.skuId) : []);
    for (const skuId of submitted) {
      const linked = new Set(run.discontinueQueueRequestIds?.[skuId] || []);
      const completed = requests.filter(request => linked.has(request.id) && request.supplyHubStatus === "처리완료" && request.requestType === "단종").map(request => request.completedAt).sort().at(-1);
      // Old snapshots have no per-SKU completion time. Their source time cannot override a later explicit release.
      add(skuId, true, completed || run.discontinueSubmittedAt || run.snapshot.createdAt, run.id);
    }
    if (at(run.reorderRequestedAt)) for (const line of run.reorderRequestedLines || []) {
      const skuId = normalizeSkuId(line.skuId), po = normalizeSkuId(line.purchaseOrderNumber);
      if (skuId && po && Number.isSafeInteger(line.shortageQuantity) && line.shortageQuantity > 0) reorders.push({ skuId, kind: "reorder", completedAt: run.reorderRequestedAt!, sourceId: run.id, purchaseOrderNumbers: [po], shortageQuantity: line.shortageQuantity });
    }
  }
  for (const product of products) {
    const skuId = normalizeSkuId(product.skuId);
    // A completed release is authoritative even if the product DB is awaiting synchronization.
    if (skuId && product.currentStatus.trim() === "단종" && !events.has(skuId)) add(skuId, true, checkedAt, "product-db");
  }
  return { checkedAt, discontinued: [...events.values()].filter(event => event.stopped).map(event => event.evidence), reorders, demandSources };
}
export function vendorOrderLineExclusion(line: Pick<VendorOrderDraftLine, "skuId" | "relatedPurchaseOrderNumbers"> & Partial<Pick<VendorOrderDraftLine, "createdAt" | "orderExclusion" | "actualShortageQuantity">>,
  scope: VendorOrderCompletionScope, status?: VendorOrderDraftStatus): VendorOrderExclusion | null {
  if (line.orderExclusion) return line.orderExclusion;
  if (status === "sent") return null;
  const skuId = normalizeSkuId(line.skuId);
  const discontinued = scope.discontinued.find(evidence => evidence.skuId === skuId);
  if (discontinued) return { ...discontinued, reason: "단종 처리완료", excludedAt: scope.checkedAt };
  const pos = ids(line.relatedPurchaseOrderNumbers || []), createdAt = at(line.createdAt);
  if (!pos.length || !createdAt) return null;
  const completed = scope.reorders.filter(evidence => evidence.skuId === skuId && at(evidence.completedAt) >= createdAt);
  if (!pos.every(po => completed.some(evidence => evidence.purchaseOrderNumbers.includes(po)))) return null;
  const actual = vendorLineActualShortage(line, scope);
  const completedQuantity = completedReorderQuantity(pos, completed);
  // A prior request for three units cannot erase a later six-unit shortage on the same PO.
  // Rounded vendor order quantities are not proof of the actual shortage.
  if (actual === null || completedQuantity < actual) return null;
  if (pos.length > 1) {
    const details = vendorLineDemandDetails(line, scope);
    if (!details || details.some(detail => completedReorderQuantity([detail.purchaseOrderNumber], completed) < detail.shortageQuantity)) return null;
  }
  const latest = [...completed].filter(evidence => evidence.purchaseOrderNumbers.some(po => pos.includes(po))).sort((a,b) => at(b.completedAt) - at(a.completedAt))[0];
  return latest ? { ...latest, purchaseOrderNumbers: pos, reason: "미납분 재발주요청 완료", excludedAt: scope.checkedAt } : null;
}
function vendorLineActualShortage(line: { skuId: string; relatedPurchaseOrderNumbers: string[]; createdAt?: string; actualShortageQuantity?: number }, scope: VendorOrderCompletionScope): number | null {
  if (Number.isSafeInteger(line.actualShortageQuantity) && line.actualShortageQuantity! > 0) return line.actualShortageQuantity!;
  const pos = ids(line.relatedPurchaseOrderNumbers).sort().join("\0");
  const totals = new Set((scope.demandSources || []).filter(source => source.skuId === normalizeSkuId(line.skuId) && source.createdAt === line.createdAt && ids(source.purchaseOrderNumbers).sort().join("\0") === pos).map(source => source.actualShortageQuantity));
  return totals.size === 1 ? [...totals][0] : null;
}
function vendorLineDemandDetails(line: { skuId: string; relatedPurchaseOrderNumbers: string[]; createdAt?: string; actualShortageQuantity?: number }, scope: VendorOrderCompletionScope) {
  const pos = ids(line.relatedPurchaseOrderNumbers).sort().join("\0");
  const matches = (scope.demandSources || []).filter(source => source.skuId === normalizeSkuId(line.skuId) && source.createdAt === line.createdAt && ids(source.purchaseOrderNumbers).sort().join("\0") === pos
    && (line.actualShortageQuantity === undefined || line.actualShortageQuantity === source.actualShortageQuantity));
  const distinct = new Map(matches.map(source => [JSON.stringify([...source.shortageDetails].sort((a,b) => a.purchaseOrderNumber.localeCompare(b.purchaseOrderNumber))), source.shortageDetails]));
  if (distinct.size !== 1) return null;
  const details = [...distinct.values()][0];
  if (ids(details.map(detail => detail.purchaseOrderNumber)).length !== details.length || ids(details.map(detail => detail.purchaseOrderNumber)).sort().join("\0") !== pos) return null;
  return details;
}
function completedReorderQuantity(pos: string[], completed: VendorCompletionEvidence[]): number {
  // Repeated acknowledgments of the same original PO are not additive demand.
  return pos.reduce((sum, po) => sum + Math.max(0, ...completed.filter(row => row.purchaseOrderNumbers.includes(po)).map(row => Number.isSafeInteger(row.shortageQuantity) && row.shortageQuantity! > 0 ? row.shortageQuantity! : 0)), 0);
}
export function partialVendorOrderCompletions(lines: readonly VendorOrderDraftLine[], drafts: readonly VendorOrderDraft[], scope: VendorOrderCompletionScope) {
  const statuses = new Map(drafts.map(draft => [draft.id, draft.status]));
  return lines.flatMap(line => {
    if (statuses.get(line.draftId) === "sent" || vendorOrderLineExclusion(line, scope, statuses.get(line.draftId))) return [];
    const pos = ids(line.relatedPurchaseOrderNumbers), createdAt = at(line.createdAt);
    if (!createdAt) return [];
    const matches = scope.reorders.filter(row => row.skuId === normalizeSkuId(line.skuId) && at(row.completedAt) >= createdAt && row.purchaseOrderNumbers.some(po => pos.includes(po)));
    if (!matches.length) return [];
    const completedPurchaseOrderNumbers = pos.filter(po => matches.some(row => row.purchaseOrderNumbers.includes(po)));
    const actualShortageQuantity = vendorLineActualShortage(line, scope);
    return [{ lineId: line.id, skuId: normalizeSkuId(line.skuId), completedPurchaseOrderNumbers,
      remainingPurchaseOrderNumbers: pos.filter(po => !completedPurchaseOrderNumbers.includes(po)),
      completedQuantity: completedReorderQuantity(completedPurchaseOrderNumbers, matches), actualShortageQuantity,
      reason: actualShortageQuantity === null ? "재발주 완료 이력은 있으나 원래 발주별 부족수량 근거가 없어 기존 수량을 유지했습니다."
        : "일부 발주 또는 수량만 재발주 처리완료되어 남은 수요를 보존했습니다. 주문수량과 부족수량은 기존 값을 유지합니다." }];
  });
}
export function vendorOrderCompletionExclusions(lines: readonly VendorOrderDraftLine[], drafts: readonly VendorOrderDraft[], scope: VendorOrderCompletionScope) {
  const statuses = new Map(drafts.map(draft => [draft.id, draft.status]));
  return lines.flatMap(line => { const exclusion = vendorOrderLineExclusion(line, scope, statuses.get(line.draftId)); return exclusion ? [{ lineId: line.id, ...exclusion }] : []; });
}
/** Archive only a pending order's membership; quantities, source POs and receiving records remain immutable history. */
export function archiveCompletedVendorOrderLines(store: { vendorOrderLines: VendorOrderDraftLine[]; vendorOrderDrafts: VendorOrderDraft[] }, scope: VendorOrderCompletionScope): void {
  const excluded = new Map(vendorOrderCompletionExclusions(store.vendorOrderLines, store.vendorOrderDrafts, scope).map(row => [row.lineId, row]));
  store.vendorOrderLines = store.vendorOrderLines.map(line => {
    const entry = excluded.get(line.id); if (!entry || line.orderExclusion) return line;
    const { lineId: _id, ...orderExclusion } = entry; return { ...line, orderExclusion };
  });
}
