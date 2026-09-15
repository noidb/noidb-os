import { createHash } from "node:crypto";
import type { WeeklyRun, WeeklyVendorItem, WeeklyWorkspace } from "../weekly-work-types";
import type { ActualInboundShortageLine } from "./actual-inbound-shortage";
import { WEEKLY_RULES_VERSION } from "../weekly-work-types";

export function queueActualInboundReorder(workspace: WeeklyWorkspace, source: ActualInboundShortageLine, now = new Date().toISOString()) {
  const pair = JSON.stringify([source.purchaseOrderNumber, source.productCode]);
  const key = createHash("sha256").update(pair).digest("hex");
  const runId = `TRANSFER-ACTUAL-${key.slice(0, 20)}`;
  for (const run of workspace.runs) {
    if (run.reorderRequestedLines?.some(row => JSON.stringify([row.purchaseOrderNumber, row.skuId]) === pair)) throw new Error("이 발주번호의 SKU는 이미 재발주 요청을 완료했습니다.");
    const pending = run.reviews[source.productCode]?.decision === "reorder"
      && run.snapshot.vendorItems.some(item => item.skuId === source.productCode && item.shortageDetails?.some(detail => detail.purchaseOrderNumber === source.purchaseOrderNumber));
    if (pending && !run.completedAt && !run.reorderRequestedAt) return { runId: run.id, reused: true };
  }
  const item: WeeklyVendorItem = {
    skuId: source.productCode, productName: source.productName, productLink: "", vendorName: source.vendorName,
    imageUrl: source.imageUrl, optionLabel: source.optionLabel, modelName: source.modelName, barcode: source.barcode,
    shortageQuantity: source.shortageQuantity, openOrderQuantity: 0, suggestedQuantity: source.shortageQuantity,
    confirmedQuantity: source.confirmedQuantity, receivedQuantity: source.receivedQuantity,
    shortageDetails: [{ purchaseOrderNumber: source.purchaseOrderNumber, confirmedQuantity: source.confirmedQuantity, receivedQuantity: source.receivedQuantity, shortageQuantity: source.shortageQuantity }],
    relatedPurchaseOrderNumbers: [source.purchaseOrderNumber], issues: [], discontinued: false,
  };
  const run: WeeklyRun = {
    id: runId,
    snapshot: {
      id: runId, rulesVersion: WEEKLY_RULES_VERSION, sourceToken: key, createdAt: now, period: { startDate: now.slice(0, 10), endDate: now.slice(0, 10) },
      source: { files: [], latestActualDate: now.slice(0, 10), firstActualDate: now.slice(0, 10), eventCount: 0, duplicateCount: 0, selectedEventCount: 0, mode: "drive" },
      couponItems: [], vendorItems: [item], warnings: [], blockers: [],
    },
    reviews: { [source.productCode]: { skuId: source.productCode, vendorName: source.vendorName, imageUrl: source.imageUrl, quantity: source.shortageQuantity, quantityConfirmed: true, decision: "reorder" } },
    reviewedSkuIds: [source.productCode], revision: 0, updatedAt: now, sentVendors: {}, routedElsewhereSkuIds: [],
    itemRoutes: { [source.productCode]: { decision: "reorder", at: now, completed: true } },
  };
  workspace.runs.push(run);
  return { runId, reused: false };
}
