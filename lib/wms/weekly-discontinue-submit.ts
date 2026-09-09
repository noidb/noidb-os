import { randomUUID } from "node:crypto";
import { mutateWeeklyWorkspace } from "./weekly-work-store";
import { assertWeeklyCurrentRules, assertWeeklyReviewEligibility, requireWeeklyRun, weeklyReviewToken } from "./weekly-work-state";
import { completeStatusRequests, listStatusRequests } from "./vendor-order-actions";
import { weeklyDiscontinueQueueRequestIds } from "./weekly-discontinue-queue";

/** Record the user's completed submission, acknowledging only the queue requests
 * included in that file. A lost response resumes the same immutable reservation. */
export async function recordWeeklyDiscontinueSubmitted(runId: string, revision: number,
  deps = { mutateWeeklyWorkspace, completeStatusRequests, listStatusRequests }, now = new Date().toISOString()) {
  const operationId = randomUUID();
  const reserved = await deps.mutateWeeklyWorkspace(workspace => {
    const run = requireWeeklyRun(workspace, runId, revision);
    if (run.pendingDiscontinueSubmission) return run;
    assertWeeklyCurrentRules(run);
    assertWeeklyReviewEligibility(workspace,run);
    const submitted = new Set(run.discontinueSubmittedSkuIds || []);
    const active = Object.values(run.reviews).filter(review => review.decision === "discontinue" && !submitted.has(review.skuId));
    if (run.discontinueSubmittedAt && (!run.discontinueSubmittedSkuIds || !active.length)) return run;
    if (!run.generated?.discontinueCount || run.generated.reviewToken !== weeklyReviewToken(run)) throw new Error("현재 단종 목록으로 파일을 먼저 생성해 주세요.");
    const skuIds = [...new Set(run.generated.discontinueSkuIds || active.map(review => review.skuId))].sort();
    if (!skuIds.length || skuIds.length !== run.generated.discontinueCount || skuIds.some(skuId => !active.some(review => review.skuId === skuId))) throw new Error("단종 파일의 상품 목록이 변경됐습니다. 파일을 다시 생성해 주세요.");
    run.pendingDiscontinueSubmission = { id: operationId, at: now, skuIds, requestIds: weeklyDiscontinueQueueRequestIds(run, skuIds), reviewToken: weeklyReviewToken(run) };
    run.revision++; run.updatedAt = now;
    return run;
  });
  const pending = reserved.pendingDiscontinueSubmission;
  if (!pending) return reserved;
  if (pending.requestIds.length) {
    await deps.completeStatusRequests(pending.requestIds, "주간업무");
    const requests = await deps.listStatusRequests();
    if (pending.requestIds.some(id => !requests.some(request => request.id === id && request.supplyHubStatus === "처리완료"))) throw new Error("단종대기 완료 저장을 확인하지 못했습니다. 같은 완료 버튼으로 연결을 다시 확인해 주세요.");
  }
  return deps.mutateWeeklyWorkspace(workspace => {
    const run = requireWeeklyRun(workspace, runId);
    if (!run.pendingDiscontinueSubmission && pending.skuIds.every(skuId => run.discontinueSubmittedSkuIds?.includes(skuId))) return run;
    if (run.pendingDiscontinueSubmission?.id !== pending.id) throw new Error("단종 완료 연결 내용을 다시 확인해 주세요.");
    run.discontinueSubmittedSkuIds = [...new Set([...(run.discontinueSubmittedSkuIds || []), ...pending.skuIds])].sort();
    const remaining = Object.values(run.reviews).some(review => review.decision === "discontinue" && !run.discontinueSubmittedSkuIds!.includes(review.skuId));
    run.discontinueSubmittedAt = remaining ? undefined : pending.at;
    delete run.pendingDiscontinueSubmission;
    run.revision++; run.updatedAt = now;
    return run;
  });
}
