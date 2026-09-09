import type { WeeklyReview, WeeklyRun, WeeklyVendorItem } from "./weekly-work-types";

/** Completion is explicit operator confirmation; generating a file never completes work. */
export function weeklyReviewCompletion(run: WeeklyRun, review: WeeklyReview): { label: string; at: string } | undefined {
  if (review.decision === "order" && run.sentVendors[review.vendorName]) return { label: "거래처 발송 완료", at: run.sentVendors[review.vendorName] };
  if (review.decision === "reorder" && run.reorderRequestedAt) return { label: "재발주 요청 완료", at: run.reorderRequestedAt };
  if (review.decision === "discontinue" && (run.discontinueSubmittedSkuIds?.includes(review.skuId) || !run.discontinueSubmittedSkuIds && run.discontinueSubmittedAt)) {
    return { label: "단종 신청 완료", at: run.discontinueSubmittedAt || run.updatedAt };
  }
  if (run.completedAt) return { label: review.decision === "hold" ? "이번 업무 보류" : "처리 완료", at: run.completedAt };
  const item = run.snapshot.vendorItems.find(item => item.skuId === review.skuId);
  // Only a linked, explicitly pending request may reopen a discontinued SKU.
  const pendingDiscontinue = review.decision === "discontinue" && !!run.discontinueQueueRequestIds?.[review.skuId]?.length;
  if (!pendingDiscontinue && (item?.discontinued || run.previouslyDiscontinuedSkuIds?.includes(review.skuId))) return { label: "이전 단종 처리 · 자동 제외", at: "" };
  if (review.decision !== "discontinue") {
    const requested = (run.reorderPreviouslyRequestedLines || []).filter(line => line.skuId === review.skuId);
    if (item?.shortageDetails?.length && item.shortageDetails.every(detail => requested.some(line => line.purchaseOrderNumber === detail.purchaseOrderNumber && line.shortageQuantity >= detail.shortageQuantity))) {
      return { label: "이전 재발주 요청 완료 · 자동 제외", at: "" };
    }
  }
  return undefined;
}

export function weeklyReviewIsActive(run: WeeklyRun, review: WeeklyReview): boolean {
  return !run.routedElsewhereSkuIds?.includes(review.skuId) && !weeklyReviewCompletion(run, review)
    && !(review.decision === "discontinue" && run.discontinueQueueRequestIds?.[review.skuId]?.length)
    && !(review.decision === "order" && run.vendorQueueTransfers?.some(transfer => transfer.lines.some(line => line.skuId === review.skuId)));
}

/** Queue ownership survives new analyses. Match PO + SKU, never SKU alone for orders. */
export function weeklyFreshVendorItem(item: WeeklyVendorItem, runs: WeeklyRun[], ownId: string): WeeklyVendorItem | undefined {
  const previous = runs.filter(run => run.id !== ownId);
  if (previous.some(run => run.discontinueQueueRequestIds?.[item.skuId]?.length || run.discontinueSubmittedSkuIds?.includes(item.skuId)
    || run.discontinueSubmittedAt && run.reviews[item.skuId]?.decision === "discontinue")) return undefined;
  if (!item.shortageDetails?.length) return item;
  const remaining = item.shortageDetails.filter(detail => !previous.some(run => {
    const review = run.reviews[item.skuId];
    const old = run.snapshot.vendorItems.find(row => row.skuId === item.skuId);
    const covered = old?.shortageDetails?.some(row => row.purchaseOrderNumber === detail.purchaseOrderNumber && row.shortageQuantity >= detail.shortageQuantity);
    if (!covered) return false;
    return review?.decision === "reorder" || review?.decision === "order" && (Boolean(run.routedElsewhereSkuIds?.includes(item.skuId)) || Boolean(run.sentVendors[review.vendorName])
      || Boolean(run.vendorQueueTransfers?.some(transfer => transfer.completed && transfer.lines.some(line => line.skuId === item.skuId && line.relatedPurchaseOrderNumbers.includes(detail.purchaseOrderNumber)))));
  }));
  if (remaining.length === item.shortageDetails.length) return item;
  if (!remaining.length) return undefined;
  const shortageQuantity = remaining.reduce((total, row) => total + row.shortageQuantity, 0);
  return { ...item, shortageDetails: remaining, relatedPurchaseOrderNumbers: remaining.map(row => row.purchaseOrderNumber), shortageQuantity,
    confirmedQuantity: remaining.reduce((total, row) => total + row.confirmedQuantity, 0), receivedQuantity: remaining.reduce((total, row) => total + row.receivedQuantity, 0),
    suggestedQuantity: shortageQuantity, openOrderQuantity: 0 };
}
