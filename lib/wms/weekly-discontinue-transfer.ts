import { readWeeklyWorkspace, mutateWeeklyWorkspace } from "./weekly-work-store";
import { assertWeeklyCurrentRules, assertWeeklyReviewEligibility, requireWeeklyRun } from "./weekly-work-state";
import { queueDiscontinueCandidate } from "./vendor-order-actions";

/** Transfer selected work to the one status queue. Retries reuse pending requests
 * and persisted exact IDs; this never marks an external submission complete. */
export async function transferWeeklyDiscontinue(runId: string, revision: number,
  deps = { readWeeklyWorkspace, mutateWeeklyWorkspace, queueDiscontinueCandidate }) {
  const workspace = await deps.readWeeklyWorkspace();
  const before = requireWeeklyRun(workspace, runId, revision);
  assertWeeklyCurrentRules(before);
  assertWeeklyReviewEligibility(workspace, before);
  const selected = Object.values(before.reviews).filter(review => review.decision === "discontinue"
    && !before.discontinueSubmittedSkuIds?.includes(review.skuId)
    && !before.discontinueQueueRequestIds?.[review.skuId]?.length);
  for (const review of selected) {
    const item = before.snapshot.vendorItems.find(row => row.skuId === review.skuId);
    const request = await deps.queueDiscontinueCandidate({ skuId: review.skuId, operator: "주간업무", purchaseOrderNumber: item?.relatedPurchaseOrderNumbers.join(" / ") });
    await deps.mutateWeeklyWorkspace(current => {
      const run = requireWeeklyRun(current, runId);
      const previous = run.discontinueQueueRequestIds?.[review.skuId] || [];
      if (!previous.includes(request.id)) {
        run.discontinueQueueRequestIds = { ...run.discontinueQueueRequestIds, [review.skuId]: [...previous, request.id] };
        run.revision++; run.updatedAt = new Date().toISOString();
      }
      return run;
    });
  }
  return requireWeeklyRun(await deps.readWeeklyWorkspace(), runId);
}
