import type { WeeklyReview, WeeklyRun } from "./weekly-work-types";

/** Completion is explicit operator confirmation; generating a file never completes work. */
export function weeklyReviewCompletion(run: WeeklyRun, review: WeeklyReview): { label: string; at: string } | undefined {
  if (review.decision === "order" && run.sentVendors[review.vendorName]) return { label: "거래처 발송 완료", at: run.sentVendors[review.vendorName] };
  if (review.decision === "reorder" && run.reorderRequestedAt) return { label: "재발주 요청 완료", at: run.reorderRequestedAt };
  if (review.decision === "discontinue" && (run.discontinueSubmittedSkuIds?.includes(review.skuId) || !run.discontinueSubmittedSkuIds && run.discontinueSubmittedAt)) {
    return { label: "단종 신청 완료", at: run.discontinueSubmittedAt || run.updatedAt };
  }
  if (run.completedAt) return { label: review.decision === "hold" ? "이번 업무 보류" : "처리 완료", at: run.completedAt };
  return undefined;
}

export function weeklyReviewIsActive(run: WeeklyRun, review: WeeklyReview): boolean {
  return !weeklyReviewCompletion(run, review) && !(review.decision === "order" && run.vendorQueueTransfers?.some(transfer => transfer.lines.some(line => line.skuId === review.skuId)));
}
