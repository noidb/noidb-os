import type { PickingWaveStoreSnapshot, SupplierHubInboundEvent } from "./picking-wave/shared-store-types";
import type { SupplierHubPurchaseOrder } from "./supplier-hub-orders";
import type { WeeklyWorkspace } from "./weekly-work-types";
import type { ProductCatalogItem } from "./product-catalog";
import { calculateSupplierHubShortages } from "./supplier-hub-shortage";
import { vendorLineClassification } from "./vendor-order/receiving-state";
import { buildClearanceCouponSnapshot } from "./clearance-coupons";
import { addWeeklyRun } from "./weekly-work-state";
import { pendingReorderQueue } from "./weekly-reorder-queue";

export type InboundDestination = "vendor" | "discontinue" | "reorder" | "delay";
export const inboundPairKey = (po: string, sku: string) => JSON.stringify([po.trim(), sku.trim()]);
export const inboundPurchaseRows = (orders: readonly SupplierHubPurchaseOrder[]) => [
  ["발주번호", "SKU ID", "상품명", "확정수량", "_주간원문검증오류"],
  ...orders.flatMap(order => order.items.map(item => [order.purchaseOrderNumber, item.productCode, item.productName, String(item.vendorConfirmedQuantity), ""])),
];
const pos = (text: string) => text.split(/[,/\s]+/).filter(Boolean);
type Ownership = { destination: InboundDestination; state: string; evidenceIds: string[]; vendorName?: string; memo?: string };

/** Existing ledgers are the source of truth. An explicit transfer supersedes its source. */
export function inboundOwnership(workspace: WeeklyWorkspace, store: PickingWaveStoreSnapshot): Map<string, Ownership> {
  const queuedReorders = new Set(pendingReorderQueue(workspace).rows.map(row => inboundPairKey(row.purchaseOrderNumber, row.skuId)));
  const claims = new Map<string, Ownership[]>();
  const add = (po: string, sku: string, claim: Ownership) => {
    const key = inboundPairKey(po, sku);
    claims.set(key, [...(claims.get(key) || []), claim]);
  };
  for (const request of workspace.statusListSnapshot?.requests || []) {
    if (request.requestType !== "단종" || request.supplyHubStatus === "처리완료") continue;
    if (Object.values(workspace.workTransfers || {}).some(t => t.source === "status" && t.sourceId === request.id)) continue;
    for (const po of pos(request.purchaseOrderNumber)) add(po, request.skuId, { destination: "discontinue", state: "업로드 대기", evidenceIds: [request.id] });
  }
  for (const line of store.vendorOrderLines) {
    if (store.deletedVendorLineIds[line.id] || store.deletedVendorDraftIds[line.draftId] || store.vendorQueueConsumedLineIds?.[line.id] || line.orderExclusion || line.shortageQuantity <= 0) continue;
    const draft = store.vendorOrderDrafts.find(d => d.id === line.draftId);
    if (!draft) continue;
    if (line.vendorTransfer || line.sentResolution || vendorLineClassification(line) === "resolved") continue;
    for (const po of line.relatedPurchaseOrderNumbers) add(po, line.skuId, {
      destination: vendorLineClassification(line) === "delayed" ? "delay" : "vendor",
      state: vendorLineClassification(line) === "delayed" ? "입고지연" : draft.status === "sent" ? "거래처 결과대기" : "거래처 발주대기",
      evidenceIds: [draft.id, line.id], vendorName: line.vendorName, memo: line.receivingDelayMemo,
    });
  }
  for (const run of workspace.runs) {
    for (const item of run.snapshot.vendorItems) {
      const review = run.reviews[item.skuId];
      if (!review) continue;
      const initial = run.actualInboundRoute;
      if (initial?.resolvedAt) continue;
      const route = run.itemRoutes?.[item.skuId];
      const target = initial?.decision || (review.decision === "reorder" ? "reorder" : review.decision === "discontinue" ? "discontinue" : undefined);
      if (!target) continue;
      for (const po of item.relatedPurchaseOrderNumbers) {
        const key = inboundPairKey(po, item.skuId);
        if (target === "reorder" && run.reorderRequestedLines?.some(l => l.purchaseOrderNumber === po && l.skuId === item.skuId && l.shortageQuantity >= (item.shortageDetails?.find(d => d.purchaseOrderNumber === po)?.shortageQuantity || item.shortageQuantity)) && (run.reorderRequestedAt || run.reorderQueuePartialRequestedAt)) continue;
        if (target === "discontinue" && (run.discontinueSubmittedSkuIds?.includes(item.skuId) || run.discontinueSubmittedAt && !run.discontinueSubmittedSkuIds)) continue;
        if (initial && !initial.completed) {
          claims.set(key, [{ destination: target, state: "이동 중 · 다시 시도 필요", evidenceIds: [run.id], memo: initial.memo }]);
          continue;
        }
        if (target === "vendor" && initial?.completed) {
          // The target line owns this pair, including later sent resolutions.
          if (!claims.has(key) && !store.vendorOrderLines.some(l => l.relatedPurchaseOrderNumbers.includes(po) && l.skuId === item.skuId && (l.sentResolution || l.vendorTransfer))) add(po, item.skuId, { destination: "vendor", state: "거래처 연결 확인필요", evidenceIds: [run.id] });
          continue;
        }
        if (target === "delay" && initial) {
          add(po, item.skuId, { destination: "delay", state: "입고지연", evidenceIds: [run.id], vendorName: review.vendorName, memo: initial.memo });
          continue;
        }
        const linkedRequests = run.discontinueQueueRequestIds?.[item.skuId] || [];
        if (target === "discontinue" && linkedRequests.length && linkedRequests.every(id => workspace.statusListSnapshot?.requests.some(r => r.id === id && r.supplyHubStatus === "처리완료"))) continue;
        if (run.completedAt || run.reorderRequestedAt || run.routedElsewhereSkuIds?.includes(item.skuId) && target !== "reorder") continue;
        if (target === "reorder" && queuedReorders.has(key) && !run.routedElsewhereSkuIds?.includes(item.skuId) || target === "discontinue" && (route || linkedRequests.length)) add(po, item.skuId, { destination: target, state: "업로드 대기", evidenceIds: [run.id, ...linkedRequests] });
      }
    }
  }
  const result = new Map<string, Ownership>();
  for (const [key, entries] of claims) {
    const targets = new Set(entries.map(e => e.destination));
    result.set(key, { ...entries[0], state: targets.size > 1 ? "목적지 충돌 · 확인필요" : entries[0].state, evidenceIds: [...new Set(entries.flatMap(e => e.evidenceIds))] });
  }
  return result;
}

export interface InboundLifecycleRow {
  purchaseOrderNumber: string; skuId: string; productName: string;
  confirmedQuantity: number; actualReceivedQuantity: number; initialShortageQuantity: number;
  finalClassification: string; finalStatus: string; completedAt: string | null;
  expectedDate: string; vendorName: string; evidenceIds: string[]; blockers: string[];
}

export function projectInboundLifecycle(input: { orders: readonly SupplierHubPurchaseOrder[]; store: PickingWaveStoreSnapshot; workspace: WeeklyWorkspace; catalog?: ProductCatalogItem[] }) {
  const { orders, store, workspace } = input;
  const calculation = calculateSupplierHubShortages({ statuses: store.supplierHubOrderStatuses || [], events: store.supplierHubInboundEvents || [], purchaseRows: inboundPurchaseRows(orders) });
  const ownership = inboundOwnership(workspace, store);
  const shortages = new Map(calculation.shortagePairs.map(p => [inboundPairKey(p.orderNo, p.skuId), p]));
  const unresolved = new Map(calculation.unresolvedPairs.map(p => [inboundPairKey(p.orderNo, p.skuId), p.issue]));
  const eligible = new Set((store.supplierHubOrderStatuses || []).filter(s => s.settlementStatus === "정산완료" && s.purchaseType !== "매입용").map(s => s.orderNo));
  const events = new Map<string, SupplierHubInboundEvent[]>(), seen = new Set<string>();
  for (const e of store.supplierHubInboundEvents || []) {
    const eventKey = JSON.stringify([e.orderNo.trim(), e.skuId.trim(), e.inboundDate.trim(), e.quantity.trim(), e.division.trim()]);
    if (seen.has(eventKey)) continue;
    seen.add(eventKey);
    const key = inboundPairKey(e.orderNo, e.skuId);
    events.set(key, [...(events.get(key) || []), e]);
  }
  const couponSnapshot = buildClearanceCouponSnapshot(store.supplierHubInboundEvents || [], input.catalog || []);
  const couponRun = addWeeklyRun(structuredClone(workspace), couponSnapshot);
  const couponPending = new Set(couponRun.couponUploadedAt ? [] : couponRun.snapshot.couponItems.map(i => i.skuId));
  const couponRequired = new Set(couponSnapshot.couponItems.map(i => i.skuId));
  const rows: InboundLifecycleRow[] = [];
  for (const order of orders) for (const item of order.items) {
    const key = inboundPairKey(order.purchaseOrderNumber, item.productCode), receiptEvents = events.get(key) || [];
    const received = receiptEvents.reduce((sum, e) => sum + (/^\d+$/.test(e.quantity.trim().replace(/,/g, "")) ? Number(e.quantity.replace(/,/g, "")) : 0), 0);
    const shortage = shortages.get(key)?.shortageQuantity ?? Math.max(0, item.vendorConfirmedQuantity - received);
    const owner = ownership.get(key), blockers: string[] = [];
    const evidence = receiptEvents.map(e => e.id);
    let classification: string = owner?.destination || (shortage ? "unclassified" : "received"), completedAt: string | null = null;
    if (!eligible.has(order.purchaseOrderNumber)) blockers.push("입고결과 정산 대기");
    if (unresolved.has(key)) blockers.push(unresolved.get(key)!);
    if (receiptEvents.some(e => !/^\d+$/.test(e.quantity.trim().replace(/,/g, "")))) blockers.push("실제 입고수량 확인필요");
    if (owner) { blockers.push(owner.state); evidence.push(...owner.evidenceIds); }
    if (couponPending.has(item.productCode) && received > 0) blockers.push("쿠폰·광고 처리대기");
    if (couponSnapshot.blockers.length && received === 1) blockers.push("쿠폰 입고근거 확인필요");
    const reorder = workspace.runs.flatMap(run => (run.reorderRequestedAt || run.reorderQueuePartialRequestedAt) ? (run.reorderRequestedLines || []).filter(l => l.purchaseOrderNumber === order.purchaseOrderNumber && l.skuId === item.productCode && l.shortageQuantity >= shortage).map(() => ({ at: run.reorderRequestedAt || run.reorderQueuePartialRequestedAt!, id: run.id })) : []).sort((a,b) => b.at.localeCompare(a.at))[0];
    // A legacy SKU-only status cannot close a different PO without lineage evidence.
    const discontinued = workspace.statusListSnapshot?.requests.filter(r => r.skuId === item.productCode && r.requestType === "단종" && r.supplyHubStatus === "처리완료" && (pos(r.purchaseOrderNumber).includes(order.purchaseOrderNumber) || workspace.runs.some(run => run.discontinueQueueRequestIds?.[item.productCode]?.includes(r.id) && run.snapshot.vendorItems.some(i => i.skuId === item.productCode && i.relatedPurchaseOrderNumbers.includes(order.purchaseOrderNumber))))).sort((a,b) => b.completedAt.localeCompare(a.completedAt))[0];
    if (shortage > 0) {
      if (reorder) { classification = owner?.destination || "reorder"; completedAt = reorder.at; evidence.push(reorder.id); }
      else if (discontinued) { classification = owner?.destination || "discontinue"; completedAt = discontinued.completedAt; evidence.push(discontinued.id); }
      else if (!owner) blockers.push("미납 최종처리 대기");
    } else completedAt = receiptEvents.map(e => e.collectedAt).sort().at(-1) || order.capturedAt;
    if (couponRequired.has(item.productCode) && !couponPending.has(item.productCode)) {
      const completion = workspace.runs.filter(run => run.couponUploadedAt && run.snapshot.couponItems.some(i => i.skuId === item.productCode)).sort((a,b) => b.couponUploadedAt!.localeCompare(a.couponUploadedAt!))[0];
      if (completion) { evidence.push(completion.id); completedAt = [completedAt || "", completion.couponUploadedAt!].sort().at(-1)!; }
      else evidence.push(...(workspace.couponChecks || []).filter(c => c.skuId === item.productCode).map(c => `coupon-check:${c.checkedAt}`));
    }
    for (const run of workspace.runs.filter(r => r.actualInboundRoute?.resolvedAt && r.snapshot.vendorItems.some(i => i.skuId === item.productCode && i.relatedPurchaseOrderNumbers.includes(order.purchaseOrderNumber)))) { evidence.push(run.id); completedAt = [completedAt || "", run.actualInboundRoute!.resolvedAt!].sort().at(-1)!; }
    for (const line of store.vendorOrderLines.filter(l => l.skuId === item.productCode && l.relatedPurchaseOrderNumbers.includes(order.purchaseOrderNumber))) {
      if (line.vendorTransfer) evidence.push(line.id, line.vendorTransfer.operationId, line.vendorTransfer.targetLineId);
      if (line.sentResolution) evidence.push(line.id, line.sentResolution.destinationId);
    }
    rows.push({ purchaseOrderNumber: order.purchaseOrderNumber, skuId: item.productCode, productName: item.productName,
      confirmedQuantity: item.vendorConfirmedQuantity, actualReceivedQuantity: received, initialShortageQuantity: Math.max(shortage, ...workspace.runs.flatMap(run => [
        ...(run.actualInboundRoute ? run.snapshot.vendorItems.filter(i => i.skuId === item.productCode).flatMap(i => (i.shortageDetails || []).filter(d => d.purchaseOrderNumber === order.purchaseOrderNumber).map(d => run.actualInboundRoute!.initialShortageQuantity ?? d.shortageQuantity)) : []),
        ...(run.reorderRequestedLines || []).filter(d => d.purchaseOrderNumber === order.purchaseOrderNumber && d.skuId === item.productCode).map(d => d.shortageQuantity),
      ])),
      finalClassification: classification, finalStatus: blockers.length ? blockers[0] : "최종완료", completedAt: blockers.length ? null : completedAt,
      expectedDate: order.expectedDate, vendorName: owner?.vendorName || input.catalog?.find(p => p.skuId === item.productCode)?.vendorName || "", evidenceIds: [...new Set(evidence)], blockers });
  }
  const completedPurchaseOrderNumbers = orders.filter(o => o.items.length > 0 && rows.filter(r => r.purchaseOrderNumber === o.purchaseOrderNumber).every(r => r.finalStatus === "최종완료")).map(o => o.purchaseOrderNumber);
  return { rows, completedPurchaseOrderNumbers, activeOrders: orders.filter(o => !completedPurchaseOrderNumbers.includes(o.purchaseOrderNumber)), calculation, couponRun, ownership };
}
