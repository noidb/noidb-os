import { readWeeklyWorkspace, mutateWeeklyWorkspace } from "./weekly-work-store";
import { readPickingWaveStore, mutatePickingWaveStore } from "./picking-wave/server-store";
import { queueDiscontinueCandidate } from "./vendor-order-actions";
import { queueActualInboundReorder } from "./vendor-order/actual-inbound-routing";
import { inboundOwnership, inboundPairKey, type InboundDestination } from "./inbound-lifecycle";
import type { ActualInboundShortageLine } from "./vendor-order/actual-inbound-shortage";
import type { VendorOrderDraftLine } from "./vendor-order/types";

const dependencies = { readWeeklyWorkspace, mutateWeeklyWorkspace, readPickingWaveStore, mutatePickingWaveStore, queueDiscontinueCandidate };
/** Reserve once in the existing weekly ledger, deliver idempotently, then record the receipt. */
export async function classifyActualInbound(source: ActualInboundShortageLine, decision: InboundDestination, memo = "", deps = dependencies) {
  if (!["vendor", "discontinue", "reorder", "delay"].includes(decision)) throw new Error("분류를 확인해 주세요.");
  if (decision === "delay" && !memo.trim()) throw new Error("입고지연 기간과 확인 근거를 입력해 주세요.");
  const store = await deps.readPickingWaveStore(), at = new Date().toISOString();
  const pair = inboundPairKey(source.purchaseOrderNumber, source.productCode);
  const reserved = await deps.mutateWeeklyWorkspace(workspace => {
    const prior = workspace.runs.find(run => run.actualInboundRoute && run.snapshot.vendorItems.some(i => i.skuId === source.productCode && i.relatedPurchaseOrderNumbers.includes(source.purchaseOrderNumber)));
    if (prior?.actualInboundRoute) {
      const route = prior.actualInboundRoute;
      if (route.resolvedAt) throw new Error("실제입고 완료를 확인한 항목입니다.");
      if (route.decision === decision) return prior;
      if (route.decision !== "delay" || !route.completed) throw new Error("이미 선택한 목적지에서 처리 중입니다. 해당 목록을 확인해 주세요.");
      route.history = [...(route.history || []), { decision: route.decision, at: route.at, memo: route.memo }];
      route.initialShortageQuantity ??= prior.snapshot.vendorItems[0].shortageQuantity;
      const item = prior.snapshot.vendorItems[0];
      item.confirmedQuantity = source.confirmedQuantity; item.receivedQuantity = source.receivedQuantity; item.shortageQuantity = source.shortageQuantity; item.suggestedQuantity = source.shortageQuantity;
      item.shortageDetails = [{ purchaseOrderNumber: source.purchaseOrderNumber, confirmedQuantity: source.confirmedQuantity, receivedQuantity: source.receivedQuantity, shortageQuantity: source.shortageQuantity }];
      prior.reviews[source.productCode].quantity = source.shortageQuantity;
      route.decision = decision; route.completed = false; route.at = at; route.memo = memo;
      prior.reviews[source.productCode].decision = decision === "vendor" ? "order" : decision === "delay" ? "hold" : decision;
      prior.itemRoutes = { [source.productCode]: { decision: prior.reviews[source.productCode].decision, at, completed: false } };
      prior.revision++; prior.updatedAt = at;
      return prior;
    }
    const owner = inboundOwnership(workspace, store).get(pair);
    if (owner) throw new Error(`이미 ${owner.state} 상태입니다. 해당 목록을 확인해 주세요.`);
    const queued = queueActualInboundReorder(workspace, source, at);
    if (queued.reused) throw new Error("이미 쿠팡 재발주 목록에 있습니다.");
    const run = workspace.runs.find(r => r.id === queued.runId)!;
    run.reviews[source.productCode].decision = decision === "vendor" ? "order" : decision === "delay" ? "hold" : decision;
    run.actualInboundRoute = { decision, completed: false, at, memo, initialShortageQuantity: source.shortageQuantity };
    run.itemRoutes = { [source.productCode]: { decision: run.reviews[source.productCode].decision, at, completed: false } };
    return run;
  });
  if (reserved.actualInboundRoute!.completed) return { runId: reserved.id, reused: true };
  let requestId: string | undefined;
  if (decision === "vendor") {
    const line: VendorOrderDraftLine = {
      id: `${reserved.id}::${source.productCode}`, draftId: `${reserved.id}::${source.vendorName}`, waveId: reserved.id,
      vendorName: source.vendorName, skuId: source.productCode, modelName: source.modelName, category: source.category,
      optionLabel: source.optionLabel, productName: source.productName, imageUrl: source.imageUrl, barcode: source.barcode,
      actualShortageQuantity: source.shortageQuantity, shortageQuantity: source.shortageQuantity, currentStock: "",
      relatedPurchaseOrderNumbers: [source.purchaseOrderNumber], actualInboundDetails: reserved.snapshot.vendorItems[0].shortageDetails,
      memo: "", isManuallyAdded: true, sourceType: "actual-inbound-shortage",
      coupangConfirmedQuantity: source.confirmedQuantity, coupangReceivedQuantity: source.receivedQuantity, createdAt: at, updatedAt: at,
    };
    const delivered = await deps.mutatePickingWaveStore({ action: "consolidateVendorOrders", operationId: reserved.id, lines: [line], now: at });
    if (!delivered.vendorOrderLines.some(l => l.skuId === source.productCode && l.relatedPurchaseOrderNumbers.includes(source.purchaseOrderNumber) && !l.orderExclusion && !delivered.deletedVendorLineIds[l.id] && !delivered.vendorQueueConsumedLineIds?.[l.id])) throw new Error("현재 단종·완료 상태 때문에 거래처 대기에 추가되지 않았습니다. 원발주 상태를 확인해 주세요.");
  }
  if (decision === "discontinue") requestId = (await deps.queueDiscontinueCandidate({ skuId: source.productCode, purchaseOrderNumber: source.purchaseOrderNumber, operator: "과거청산", verifyExistingDiscontinue: true })).id;
  await deps.mutateWeeklyWorkspace(workspace => {
    const run = workspace.runs.find(r => r.id === reserved.id)!;
    if (run.actualInboundRoute?.decision !== decision) throw new Error("이동 기록이 변경되었습니다. 목록을 다시 확인해 주세요.");
    run.actualInboundRoute.completed = true;
    run.itemRoutes![source.productCode].completed = true;
    if (requestId) run.discontinueQueueRequestIds = { ...run.discontinueQueueRequestIds, [source.productCode]: [requestId] };
    run.revision++; run.updatedAt = at;
  });
  return { runId: reserved.id, reused: false };
}
