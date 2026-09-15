import { createHash } from "node:crypto";
import { readWeeklyWorkspace, mutateWeeklyWorkspace } from "./weekly-work-store";
import { listStatusRequests } from "./vendor-order-actions";
import { readPickingWaveStore, mutatePickingWaveStore } from "./picking-wave/server-store";
import { getVendorLineDeletionBlockReason } from "./vendor-order/delete-lines";
import { savedWeeklyMaterial } from "./saved-weekly-material";
import { vendorReorderMaterial } from "./vendor-order/reorder-material";
import { transferWeeklyVendorQueue } from "./weekly-vendor-queue";
import type { WeeklyRun } from "./weekly-work-types";

const dependencies = { readWeeklyWorkspace, mutateWeeklyWorkspace, listStatusRequests, readPickingWaveStore, mutatePickingWaveStore, transferWeeklyVendorQueue };
export async function moveWorkListItem(source: "status" | "vendor", sourceId: string, target: "order" | "reorder", expectedUpdatedAt?: string, deps = dependencies, preserveSentOrder = false, confirmedReorder?: { token: string; purchaseOrderNumbers: string[] }) {
  if (!sourceId || !["status", "vendor"].includes(source) || !["order", "reorder"].includes(target) || source === "vendor" && target !== "reorder") throw new Error("이동할 상품과 목록을 확인해 주세요.");
  const key = createHash("sha256").update(JSON.stringify([source, sourceId])).digest("hex");
  const workspace = await deps.readWeeklyWorkspace();
  const prior = workspace.workTransfers?.[key];
  if (prior && prior.target !== target) throw new Error("이미 다른 목록으로 이동한 상품입니다. 이동한 목록에서 확인해 주세요.");
  if (prior?.completed) {
    if (source === "vendor" && preserveSentOrder && prior.sourceUpdatedAt) await deps.mutatePickingWaveStore({ action: "resolveSentVendorLine", lineId: sourceId, expectedUpdatedAt: prior.sourceUpdatedAt, kind: "reorder", destinationId: prior.runId, now: prior.at });
    return { id: sourceId, runId: prior.runId, reused: true };
  }
  let skuId: string, purchaseOrders: string[], vendorSource: { waveId: string; updatedAt: string; preserve?: boolean } | undefined, completedAt = "";
  let confirmedMaterial: ReturnType<typeof vendorReorderMaterial> | undefined;
  if (source === "status") {
    const record = (await deps.listStatusRequests()).find(row => row.id === sourceId);
    if (!record || record.requestType !== "단종") throw new Error("단종 목록의 원래 상품을 확인하지 못했습니다.");
    skuId = record.skuId; completedAt = record.supplyHubStatus === "처리완료" ? record.completedAt : "";
    purchaseOrders = record.purchaseOrderNumber.split(/[,/\s]+/).filter(Boolean);
    for (const run of workspace.runs) if (run.discontinueQueueRequestIds?.[skuId]?.includes(sourceId)) purchaseOrders.push(...(run.snapshot.vendorItems.find(item=>item.skuId===skuId)?.relatedPurchaseOrderNumbers || []));
  } else {
    const snapshot = await deps.readPickingWaveStore();
    const line = snapshot.vendorOrderLines.find(row => row.id === sourceId);
    if (!line) {
      if (!prior || snapshot.deletedVendorLineIds[sourceId] !== prior.at) throw new Error("현재 발주서에 없는 상품입니다. 이동 기록을 확인해 주세요.");
      const pendingRun = workspace.runs.find(run=>run.id===prior.runId);
      if (!pendingRun) throw new Error("이동 기록을 확인하지 못했습니다.");
      skuId = pendingRun.snapshot.vendorItems[0].skuId; purchaseOrders = pendingRun.snapshot.vendorItems[0].relatedPurchaseOrderNumbers;
    } else {
      if (line.isStockReplenishment) throw new Error("재고보충 상품은 쿠팡 재발주요청 대상이 아닙니다.");
      if (line.vendorTransfer || line.sentResolution) throw new Error("이미 다른 목록으로 이동한 상품입니다.");
      if (prior && prior.sourceUpdatedAt !== line.updatedAt) throw new Error("이동 중 원래 발주 품목이 변경됐습니다. 기존 이동 기록을 확인해 주세요.");
      const draft = snapshot.vendorOrderDrafts.find(draft => draft.id === line.draftId);
      if (!draft) throw new Error("원래 거래처 발주서를 확인하지 못했습니다.");
      if (snapshot.deletedVendorLineIds[sourceId] || line.orderExclusion) throw new Error("이미 제외된 발주 품목입니다. 최신 목록을 확인해 주세요.");
      const preserve = preserveSentOrder && draft.status === "sent";
      const reason = preserve ? null : getVendorLineDeletionBlockReason(line, draft);
      if (reason) throw new Error(reason);
      if (!expectedUpdatedAt || line.updatedAt !== expectedUpdatedAt) throw new Error("다른 화면에서 발주서가 바뀌었습니다. 저장된 목록을 다시 열어 주세요.");
      skuId = line.skuId; purchaseOrders = line.relatedPurchaseOrderNumbers;
      if (confirmedReorder) {
        confirmedMaterial = vendorReorderMaterial(workspace,line,confirmedReorder.purchaseOrderNumbers);
        if (confirmedMaterial.token !== confirmedReorder.token) throw new Error("확인 후 미입고 자료가 바뀌었습니다. 수량을 다시 확인해 주세요.");
        purchaseOrders = confirmedMaterial.purchaseOrderNumbers;
      }
      vendorSource = { waveId: line.waveId, updatedAt: line.updatedAt, preserve };
    }
  }
  let reserved: WeeklyRun;
  if (prior) reserved = workspace.runs.find(run => run.id === prior.runId)!;
  else {
    const { snapshot, item } = confirmedMaterial || savedWeeklyMaterial(workspace, skuId, purchaseOrders);
    // The user may have manually added the same product after it was already queued.
    // Reuse that exact PO/SKU demand instead of blocking the source order forever.
    const existingTarget = confirmedMaterial && vendorSource?.preserve && workspace.runs.find(run => !run.completedAt && !run.reorderRequestedAt && run.reviews[skuId]?.decision === "reorder" && !run.routedElsewhereSkuIds?.includes(skuId) && purchaseOrders.every(po => run.snapshot.vendorItems.some(row => row.skuId === skuId && row.shortageDetails?.some(detail => detail.purchaseOrderNumber === po && detail.shortageQuantity === item.shortageDetails!.find(d=>d.purchaseOrderNumber===po)!.shortageQuantity))));
    if (existingTarget && vendorSource) {
      const at=new Date().toISOString();
      await deps.mutatePickingWaveStore({action:"resolveSentVendorLine",lineId:sourceId,expectedUpdatedAt:vendorSource.updatedAt,kind:"reorder",destinationId:existingTarget.id,now:at});
      await deps.mutateWeeklyWorkspace(current=>{current.workTransfers={...current.workTransfers,[key]:{source,sourceId,sourceUpdatedAt:vendorSource!.updatedAt,target,runId:existingTarget.id,completed:true,at}};});
      return {id:sourceId,runId:existingTarget.id,reused:true};
    }
    for (const run of workspace.runs) {
      if (run.reorderRequestedLines?.some(row=>row.skuId===skuId && purchaseOrders.includes(row.purchaseOrderNumber))) throw new Error("이 발주번호의 상품은 이미 재발주 요청을 완료했습니다.");
      const transfer = Object.values(workspace.workTransfers || {}).find(move=>move.runId===run.id);
      if (transfer && (transfer.target === "reorder" || target === "order") && run.snapshot.vendorItems.some(row=>row.skuId===skuId && row.relatedPurchaseOrderNumbers.some(po=>purchaseOrders.includes(po)))) throw new Error("같은 발주번호의 상품이 이미 이동됐거나 이동 중입니다. 대상 목록을 확인해 주세요.");
    }
    if (completedAt && Date.parse(snapshot.createdAt) <= Date.parse(completedAt)) throw new Error("단종 처리완료 이후의 해제 상태를 확인해야 합니다. 해제 후 입고상세내역 조회를 한 번 진행해 주세요.");
    const at = new Date().toISOString(), runId = `TRANSFER-${key.slice(0,24)}`;
    reserved = await deps.mutateWeeklyWorkspace(current => {
      const existing = current.workTransfers?.[key];
      if (existing) { if (existing.target !== target) throw new Error("다른 목록으로 이동 중입니다."); return current.runs.find(run=>run.id===existing.runId)!; }
      if (current.revision !== workspace.revision) throw new Error("작업 목록이 변경됐습니다. 다시 이동해 주세요.");
      if (source === "status" && current.statusCompletionIds?.includes(sourceId)) throw new Error("이 상품의 단종 완료 저장을 먼저 확인해 주세요.");
      const run: WeeklyRun = { id: runId, snapshot: { ...snapshot, id: runId, couponItems: [], couponReceiptKeys: {}, vendorItems: [item] },
        reviews: { [skuId]: { skuId, vendorName: item.vendorName, imageUrl: item.imageUrl, quantity: item.shortageQuantity, quantityConfirmed: true, decision: target } },
        reviewedSkuIds: [skuId], revision: 0, updatedAt: at, sentVendors: {}, routedElsewhereSkuIds: target === "reorder" ? [skuId] : [],
        itemRoutes: { [skuId]: { decision: target, at, completed: false } } };
      current.runs.push(run);
      current.workTransfers = { ...current.workTransfers, [key]: { source, sourceId, sourceUpdatedAt: vendorSource?.updatedAt, target, runId, completed: false, at } };
      return run;
    });
  }
  if (target === "order") await deps.transferWeeklyVendorQueue(reserved.id, reserved.revision, [skuId]);
  if (vendorSource?.preserve) {
    const latest = await deps.readPickingWaveStore();
    const original = latest.vendorOrderLines.find(line => line.id === sourceId);
    if (!original || original.updatedAt !== vendorSource.updatedAt || original.orderExclusion || latest.deletedVendorLineIds[sourceId]
      || !latest.vendorOrderDrafts.some(draft => draft.id === original.draftId && draft.status === "sent")) throw new Error("이동 중 발주서가 변경됐습니다. 최신 목록을 확인해 주세요.");
  } else if (vendorSource) await deps.mutatePickingWaveStore({ action: "deleteVendorLines", waveId: vendorSource.waveId, lineIds: [sourceId], expectedUpdatedAtByLineId: { [sourceId]: vendorSource.updatedAt }, deletedAt: prior?.at || reserved.updatedAt });
  await deps.mutateWeeklyWorkspace(current => {
    const transfer = current.workTransfers?.[key];
    if (!transfer || transfer.target !== target) throw new Error("이동 기록이 변경됐습니다.");
    if (transfer.completed) return;
    const run = current.runs.find(run => run.id === transfer.runId)!;
    transfer.completed = true;
    run.routedElsewhereSkuIds = []; run.itemRoutes![skuId].completed = true; run.revision++; run.updatedAt = new Date().toISOString();
    for (const old of current.runs) if (old.id !== run.id && old.discontinueQueueRequestIds?.[skuId]?.includes(sourceId)) {
      old.routedElsewhereSkuIds = [...new Set([...(old.routedElsewhereSkuIds || []), skuId])]; old.revision++; old.updatedAt = run.updatedAt;
    }
  });
  if (vendorSource?.preserve) await deps.mutatePickingWaveStore({ action: "resolveSentVendorLine", lineId: sourceId, expectedUpdatedAt: vendorSource.updatedAt, kind: "reorder", destinationId: reserved.id, now: new Date().toISOString() });
  return { id: sourceId, runId: reserved.id, reused: false };
}
