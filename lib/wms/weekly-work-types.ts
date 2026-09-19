/** Shared browser/server contract for one weekly operational review. */
import type { VendorOrderDraftLine } from "./vendor-order/types";
export const WEEKLY_RULES_VERSION = 5;
export interface WeeklyPeriod { startDate: string; endDate: string }
export interface WeeklyCouponItem { skuId: string; productName: string; productLink: string }
export interface WeeklyShortageDetail {
  purchaseOrderNumber: string; confirmedQuantity: number; receivedQuantity: number; shortageQuantity: number;
}
export interface WeeklyVendorItem extends WeeklyCouponItem {
  vendorName: string; imageUrl: string; optionLabel: string; modelName: string; barcode: string;
  shortageQuantity: number; openOrderQuantity: number; suggestedQuantity: number;
  confirmedQuantity?: number; receivedQuantity?: number;
  shortageDetails?: WeeklyShortageDetail[];
  relatedPurchaseOrderNumbers: string[]; issues: string[]; discontinued: boolean;
}
/** Unverified source data is kept separate from confirmed shortage work. */
export interface WeeklyUnresolvedItem {
  skuId: string; productName: string; relatedPurchaseOrderNumbers: string[]; issues: string[];
}
export interface WeeklySnapshot {
  rulesVersion?: number;
  id: string; sourceToken: string; operationalToken?: string; createdAt: string; period: WeeklyPeriod;
  source: { files: string[]; purchaseFiles?: string[]; supplementedPurchaseRows?: number; latestActualDate: string; firstActualDate: string; eventCount: number; duplicateCount: number; selectedEventCount: number; mode: "drive" | "browser" | "upload" };
  couponItems: WeeklyCouponItem[]; vendorItems: WeeklyVendorItem[];
  unresolvedItems?: WeeklyUnresolvedItem[];
  couponReceiptKeys?: Record<string, string[]>;
  warnings: string[]; blockers: string[];
}
export interface WeeklyReview {
  skuId: string; vendorName: string; imageUrl: string; quantity: number;
  decision: "order" | "hold" | "discontinue" | "reorder"; quantityConfirmed: boolean;
}
export interface WeeklyRun {
  /** Exact closed-shipment evidence that originated this follow-up run. */
  logisticsReceiptLine?: {
    lineKey: string; shipmentNumber: string; boxId: string; purchaseOrderNumber: string; skuId: string;
    deliveredQuantity: number; receivedQuantity: number; shortageQuantity: number; handledQuantity?: number;
  };
  /** A vendor draft may consolidate several closed shipment rows for one PO/SKU. */
  logisticsReceiptLines?: Array<{
    lineKey: string; shipmentNumber: string; boxId: string; purchaseOrderNumber: string; skuId: string;
    deliveredQuantity: number; receivedQuantity: number; shortageQuantity: number; handledQuantity?: number;
  }>;
  /** Exact PO/SKU routing intent. Completion here means delivery to the next queue, not external upload. */
  actualInboundRoute?: { decision: "vendor" | "discontinue" | "reorder" | "delay"; completed: boolean; at: string; memo?: string; resolvedAt?: string; initialShortageQuantity?: number; history?: Array<{ decision: string; at: string; memo?: string }> };
  itemRoutes?: Record<string, { decision: WeeklyReview["decision"]; at: string; completed: boolean }>;
  routedElsewhereSkuIds?: string[];
  discontinueQueueRequestIds?: Record<string, string[]>;
  pendingDiscontinueSubmission?: { id: string; at: string; skuIds: string[]; requestIds: string[]; reviewToken: string };

  vendorQueueTransfers?: Array<{ id: string; at: string; lines: VendorOrderDraftLine[]; completed?: boolean; queueId?: string }>;
  id: string; snapshot: WeeklySnapshot; reviews: Record<string, WeeklyReview>;
  reviewedSkuIds?: string[];
  revision: number; updatedAt: string;
  couponUploadedAt?: string; discontinueSubmittedAt?: string; completedAt?: string;
  couponStartsOn?: string;
  couponExpiresOn?: string;
  previouslyDiscontinuedSkuIds?: string[];
  reorderRequestedAt?: string;
  reorderQueuePartialRequestedAt?: string;
  reorderRequestedLines?: Array<{ purchaseOrderNumber: string; skuId: string; shortageQuantity: number }>;
  /** Exact closed-shipment rows completed through a consolidated vendor/reorder file. */
  reorderRequestedShipmentLineKeys?: string[];
  reorderDiscardedIssues?: Array<{ skuId: string; purchaseOrderNumbers: string[] }>;
  reorderPreviouslyRequestedLines?: Array<{ purchaseOrderNumber: string; skuId: string; shortageQuantity: number }>;
  couponExcludedSkuIds?: string[];
  discontinueSubmittedSkuIds?: string[];
  discontinueSubmissionChecks?: Array<{skuId:string;requestId:string;submittedAt:string;recordedAt:string;source:string}>;
  pendingVendorSends?: Record<string, { at: string; reviewToken: string; lines: VendorOrderDraftLine[] }>;
  sentVendors: Record<string, string>;
  generated?: { at: string; reviewToken: string; couponCount: number; vendors: string[]; discontinueCount: number; discontinueSkuIds?: string[]; reorderCount?: number; reorderRequestDate?: string; advertisingCount?: number; advertisingFiles?: string[]; advertisingToken?: string };
}
export interface WeeklyWorkspace {
  /** Explicitly collected shipment snapshots; separate from historical inbound events and runs. */
  shipmentReceiptOrders?: import("./shipment-receipts").ShipmentReceiptOrders;
  /** Complete v2 logistics shipment collection, kept separate from the PO-based v1 snapshots. */
  logisticsReceipts?: import("./logistics-receipts").LogisticsReceiptSnapshot;
  /** A completed follow-up queue connection; it does not mean the external work itself is complete. */
  logisticsReceiptRoutes?: Record<string, import("./logistics-receipts").LogisticsReceiptRoute>;
  logisticsFollowUp?: import("./logistics-follow-up-types").LogisticsFollowUpState;
  materialSnapshot?: WeeklySnapshot;
  statusCompletionIds?: string[];
  statusListSnapshot?: { requests: import("./vendor-order-actions").StatusRequestRecord[]; generations: import("./vendor-order-actions").StatusFileGenerationRecord[]; at: string };
  workTransfers?: Record<string, { source: "status" | "vendor"; sourceId: string; sourceUpdatedAt?: string; target: "order" | "reorder"; runId: string; completed: boolean; at: string }>;
  schemaVersion: 1; revision: number; runs: WeeklyRun[];
  /** Append-only observations of the latest coupon end date for an exact SKU. */
  couponChecks?: Array<{ skuId: string; expiresOn: string; checkedAt: string; source: string }>;
  productOverrides: Record<string, { vendorName: string; imageUrl: string; discontinued: boolean }>;
}
export interface WeeklyBrowserSource {
  headers: string[]; rows: string[][]; coverageComplete: true; totalCount: number;
  startDate: string; endDate: string; collectedAt: string; transferId: string;
}
