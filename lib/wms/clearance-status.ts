import { projectInboundLifecycle, inboundPairKey } from "./inbound-lifecycle";
import { completedShortagePairs } from "./weekly-completion-summary";
import { historicalShortageEvidence } from "./historical-shortage-clearance";
import { vendorLineClassification } from "./vendor-order/receiving-state";

export function buildClearanceStatus(input: Parameters<typeof projectInboundLifecycle>[0]) {
  const result = projectInboundLifecycle(input), { store, workspace } = input;
  const completed = new Set(completedShortagePairs(workspace.runs.map(run => ({ ...run }))));
  for (const item of historicalShortageEvidence(workspace, { ...store, vendorOrderLines: store.vendorOrderLines.filter(l => !store.deletedVendorLineIds[l.id] && !store.deletedVendorDraftIds[l.draftId]) })) if (item.status === "already_resolved" || item.status === "discontinued") completed.add(inboundPairKey(item.purchaseOrderNumber, item.skuId));
  const baseline = result.calculation.shortagePairs.filter(p => !completed.has(inboundPairKey(p.orderNo,p.skuId)) && !/단종/.test(input.catalog?.find(c => c.skuId === p.skuId)?.currentStatus || ""));
  const unclassified = baseline.filter(p => !result.ownership.has(inboundPairKey(p.orderNo,p.skuId)));
  const live = store.vendorOrderLines.filter(l => !store.deletedVendorLineIds[l.id] && !store.deletedVendorDraftIds[l.draftId] && !store.vendorQueueConsumedLineIds?.[l.id] && l.shortageQuantity > 0 && vendorLineClassification(l) !== "resolved");
  const sent = live.filter(l => store.vendorOrderDrafts.some(d => d.id === l.draftId && d.status === "sent"));
  const unsent = live.filter(l => store.vendorOrderDrafts.some(d => d.id === l.draftId && d.status !== "sent" && !d.archivedAt));
  const statusPending = (workspace.statusListSnapshot?.requests || []).filter(r => r.requestType === "단종" && r.supplyHubStatus !== "처리완료" && !Object.values(workspace.workTransfers || {}).some(t => t.source === "status" && t.sourceId === r.id));
  const owners = [...result.ownership.values()];
  return {
    rawShortage: { pairs: result.calculation.shortagePairs.length, quantity: result.calculation.shortagePairs.reduce((s,p) => s+p.shortageQuantity,0) },
    baselinePending: { pairs: baseline.length, quantity: baseline.reduce((s,p) => s+p.shortageQuantity,0) },
    unclassified: { pairs: unclassified.length, quantity: unclassified.reduce((s,p) => s+p.shortageQuantity,0) },
    coupon: result.couponRun.couponUploadedAt ? 0 : result.couponRun.snapshot.couponItems.length,
    discontinue: statusPending.length, discontinueMissingPo: statusPending.filter(r => !r.purchaseOrderNumber).map(r => r.id),
    reorderPairs: owners.filter(o => o.destination === "reorder").length,
    unsent: { drafts: new Set(unsent.map(l => l.draftId)).size, lines: unsent.length },
    sent: { drafts: new Set(sent.map(l => l.draftId)).size, lines: sent.length, unclassified: sent.filter(l => vendorLineClassification(l) === "pending").length, delayed: sent.filter(l => vendorLineClassification(l) === "delayed").length },
    initialDelayed: workspace.runs.filter(r => r.actualInboundRoute?.decision === "delay" && r.actualInboundRoute.completed && !r.actualInboundRoute.resolvedAt).length,
    conflicts: owners.filter(o => o.state.includes("확인필요") || o.state.includes("다시 시도")).length,
    inboundEventCount: result.calculation.inboundEventCount, uniqueInboundEventCount: result.calculation.uniqueInboundEventCount, statusCount: result.calculation.statusCount,
    unresolved: result.calculation.unresolvedPairs.length, completedOrders: result.completedPurchaseOrderNumbers.length,
  };
}
