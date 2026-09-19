import { createHash } from "node:crypto";
import { completeStatusRequests, type StatusRequestRecord } from "./vendor-order-actions";
import { syncWeeklyDiscontinueQueue, weeklyDiscontinueQueueRequestIds, type WeeklyDiscontinueQueueSource } from "./weekly-discontinue-queue";
import { weeklyReviewToken } from "./weekly-work-state";
import type { WeeklyRun, WeeklyWorkspace } from "./weekly-work-types";

export const LOGISTICS_DISCONTINUE_STATUS_RUN_ID = "LOGISTICS-FOLLOWUP-STATUS-DISCONTINUE";

export interface LogisticsDiscontinueProof {
  requestIds: string[];
  skuIds: string[];
  reviewToken: string;
}

function id(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function distinct(values: readonly string[], message: string) {
  const clean = values.map(id).filter(Boolean);
  if (!clean.length || clean.length !== values.length || new Set(clean).size !== clean.length) throw new Error(message);
  return clean;
}

function statusRun(workspace: WeeklyWorkspace, now: string): WeeklyRun {
  const existing = workspace.runs.find(run => run.id === LOGISTICS_DISCONTINUE_STATUS_RUN_ID);
  if (existing) return existing;
  const run: WeeklyRun = {
    id: LOGISTICS_DISCONTINUE_STATUS_RUN_ID, revision: 0, updatedAt: now, sentVendors: {}, reviews: {}, reviewedSkuIds: [], itemRoutes: {},
    snapshot: { id: LOGISTICS_DISCONTINUE_STATUS_RUN_ID, rulesVersion: 5, sourceToken: "status-queue", operationalToken: "status-queue", createdAt: now,
      period: { startDate: now.slice(0, 10), endDate: now.slice(0, 10) }, source: { files: ["단종 요청 대기"], latestActualDate: "", firstActualDate: "", eventCount: 0, duplicateCount: 0, selectedEventCount: 0, mode: "browser" },
      couponItems: [], couponReceiptKeys: {}, vendorItems: [], warnings: [], blockers: [] },
  };
  workspace.runs.push(run);
  return run;
}

/** Read-only preview for GET: no run, queue, or status request is changed. */
export function previewFollowUpDiscontinue(source: WeeklyDiscontinueQueueSource) {
  return source.requests.filter(request => request.requestType === "단종" && request.supplyHubStatus === "처리대기").map(request => ({
    requestId: request.id, skuId: request.skuId, purchaseOrderNumber: request.purchaseOrderNumber, productName: request.productName,
  }));
}

/** Explicit generation-time mutation: link pending status records to one dedicated follow-up run. */
export function collectFollowUpDiscontinue(workspace: WeeklyWorkspace, source: WeeklyDiscontinueQueueSource, now = new Date().toISOString()) {
  const pending = source.requests.filter(request => request.requestType === "단종" && request.supplyHubStatus === "처리대기");
  const run = statusRun(workspace, now);
  syncWeeklyDiscontinueQueue(run, source, now);
  // Only this collection's currently pending IDs enter a new proof. Existing runs may
  // reference the same status request as history and are intentionally left untouched.
  const requestIds = [...new Set(pending.map(request => request.id))].sort();
  const skuIds = [...new Set(pending.map(request => request.skuId))].sort();
  // This map is the current queue only. Snapshot/review history and saved proofs stay
  // intact; a newer collection intentionally supersedes an older unsubmitted proof.
  run.discontinueQueueRequestIds = Object.fromEntries(skuIds.map(skuId => [skuId,
    [...new Set(pending.filter(request => request.skuId === skuId).map(request => request.id))].sort(),
  ]));
  run.snapshot.sourceToken = createHash("sha256").update(JSON.stringify(run.discontinueQueueRequestIds)).digest("hex");
  const linked = new Set(weeklyDiscontinueQueueRequestIds(run, skuIds));
  if (requestIds.some(requestId => !linked.has(requestId))) throw new Error("단종 대기 요청 연결을 확인해 주세요.");
  if (!requestIds.length) throw new Error("생성할 단종 대기 요청이 없습니다.");
  return { run, requestIds, skuIds, reviewToken: weeklyReviewToken(run) };
}

/** Acknowledges only immutable proof request IDs; later queue arrivals remain pending. */
export async function completeFollowUpDiscontinue(workspace: WeeklyWorkspace, proof: LogisticsDiscontinueProof,
  deps: { completeStatusRequests: typeof completeStatusRequests; listStatusRequests: () => Promise<StatusRequestRecord[]> }, now = new Date().toISOString()) {
  const requestIds = distinct(proof.requestIds, "완료할 단종 요청을 확인해 주세요.");
  const skuIds = distinct(proof.skuIds, "완료할 단종 SKU를 확인해 주세요.");
  const run = workspace.runs.find(item => item.id === LOGISTICS_DISCONTINUE_STATUS_RUN_ID);
  if (!run || weeklyReviewToken(run) !== proof.reviewToken) throw new Error("단종 파일 생성 후 목록이 변경됐습니다. 파일을 다시 생성해 주세요.");
  const currentIds = weeklyDiscontinueQueueRequestIds(run, skuIds);
  if (currentIds.length !== requestIds.length || requestIds.some(requestId => !currentIds.includes(requestId))) throw new Error("단종 파일의 요청 연결이 변경됐습니다. 파일을 다시 생성해 주세요.");
  await deps.completeStatusRequests(requestIds, "주간업무");
  const requests = await deps.listStatusRequests();
  if (requestIds.some(requestId => !requests.some(request => request.id === requestId && request.supplyHubStatus === "처리완료"))) throw new Error("단종대기 완료 저장을 확인하지 못했습니다. 같은 완료 버튼으로 연결을 다시 확인해 주세요.");
  run.discontinueSubmittedSkuIds = [...new Set([...(run.discontinueSubmittedSkuIds || []), ...skuIds])].sort();
  const remaining = Object.values(run.reviews).some(review => review.decision === "discontinue" && !run.discontinueSubmittedSkuIds!.includes(review.skuId));
  run.discontinueSubmittedAt = remaining ? undefined : now;
  run.revision++; run.updatedAt = now;
  return run;
}
