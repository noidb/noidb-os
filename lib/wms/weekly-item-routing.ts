import { readWeeklyWorkspace, mutateWeeklyWorkspace } from "./weekly-work-store";
import { requireWeeklyRun, updateWeeklyReviews, weeklyReorderRows, assertWeeklyCurrentRules } from "./weekly-work-state";
import { weeklyFreshVendorItem } from "./weekly-work-progress";
import { transferWeeklyVendorQueue } from "./weekly-vendor-queue";
import { queueDiscontinueCandidate } from "./vendor-order-actions";
import type { WeeklyReview } from "./weekly-work-types";

/** Persist intent before crossing stores. A retry resumes the same SKU and decision. */
export async function routeWeeklyItem(runId: string, revision: number, skuId: string, decision: WeeklyReview["decision"],
  deps = { readWeeklyWorkspace, mutateWeeklyWorkspace, transferWeeklyVendorQueue, queueDiscontinueCandidate }) {
  if (!skuId || !["order", "discontinue", "reorder"].includes(decision)) throw new Error("이동할 상품과 처리 방법을 확인해 주세요.");
  const now = new Date().toISOString();
  const reserved = await deps.mutateWeeklyWorkspace(workspace => {
    const current = requireWeeklyRun(workspace, runId);
    const prior = current.itemRoutes?.[skuId];
    if (prior) {
      if (prior.decision !== decision) throw new Error("이미 선택한 대기 목록으로 이동 중입니다. 같은 처리 방법으로 다시 확인해 주세요.");
      return current;
    }
    requireWeeklyRun(workspace, runId, revision); assertWeeklyCurrentRules(current);
    if (Object.values(current.itemRoutes || {}).some(route => !route.completed)) throw new Error("이전 상품 이동을 먼저 다시 확인해 주세요.");
    const item = current.snapshot.vendorItems.find(row => row.skuId === skuId);
    const review = current.reviews[skuId];
    if (!item || !review) throw new Error("현재 검토 목록에 없는 상품입니다.");
    if (current.routedElsewhereSkuIds?.includes(skuId) || decision === "order" && current.vendorQueueTransfers?.some(t => t.lines.some(line => line.skuId === skuId)) || current.discontinueQueueRequestIds?.[skuId]?.length) throw new Error("이미 이동한 상품입니다. 해당 관리 목록에서 확인해 주세요.");
    for (const other of workspace.runs.filter(run => run.id !== runId)) {
      const pending = other.itemRoutes?.[skuId];
      if (pending && !pending.completed && other.snapshot.vendorItems.find(row => row.skuId === skuId)?.relatedPurchaseOrderNumbers.some(po => item.relatedPurchaseOrderNumbers.includes(po))) throw new Error("다른 작업에서 같은 미입고 상품을 이동 중입니다. 해당 작업에서 다시 확인해 주세요.");
    }
    const fresh = decision === "discontinue" ? item : weeklyFreshVendorItem(item, workspace.runs, runId);
    if (!fresh) {
      current.routedElsewhereSkuIds = [...new Set([...(current.routedElsewhereSkuIds || []), skuId])];
      current.revision++; current.updatedAt = now;
      return current;
    }
    if (fresh !== item) throw new Error("일부 발주가 이미 이동했습니다. 최신 자료로 다시 확인해 주세요.");
    if (decision === "reorder") weeklyReorderRows({ ...current, reviews: { [skuId]: { ...review, decision } } });
    updateWeeklyReviews(workspace, current, [{ ...review, decision }], now);
    current.itemRoutes = { ...current.itemRoutes, [skuId]: { decision, at: now, completed: false } };
    current.reviewedSkuIds = [...new Set([...(current.reviewedSkuIds || []), skuId])];
    current.revision++; current.updatedAt = now;
    return current;
  });
  if (reserved.routedElsewhereSkuIds?.includes(skuId) || reserved.itemRoutes?.[skuId]?.completed) return reserved;
  if (decision === "order" && !reserved.vendorQueueTransfers?.some(t => t.completed && t.lines.some(line => line.skuId === skuId))) await deps.transferWeeklyVendorQueue(runId, reserved.revision, [skuId]);
  let requestId: string | undefined;
  if (decision === "discontinue") {
    const item = reserved.snapshot.vendorItems.find(row => row.skuId === skuId)!;
    requestId = (await deps.queueDiscontinueCandidate({ skuId, operator: "주간업무", purchaseOrderNumber: item.relatedPurchaseOrderNumbers.join(" / ") })).id;
  }
  return deps.mutateWeeklyWorkspace(workspace => {
    const current = requireWeeklyRun(workspace, runId);
    const route = current.itemRoutes?.[skuId];
    if (!route || route.decision !== decision) throw new Error("이동 기록을 다시 확인해 주세요.");
    if (!route.completed) {
      if (requestId) current.discontinueQueueRequestIds = { ...current.discontinueQueueRequestIds, [skuId]: [...new Set([...(current.discontinueQueueRequestIds?.[skuId] || []), requestId])] };
      route.completed = true; current.revision++; current.updatedAt = new Date().toISOString();
    }
    return current;
  });
}
