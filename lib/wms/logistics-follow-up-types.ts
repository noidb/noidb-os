/** Browser-safe contract for shipment follow-up review. */
export type LogisticsFollowUpKind = "marketing" | "discontinue" | "reorder" | "vendor";
export interface LogisticsFollowUpLine {
  lineKey: string; sourceLineKey: string; shipmentNumber: string; boxId: string; purchaseOrderNumber: string;
  skuId: string; productName: string; barcode: string; kind: "marketing" | "shortage";
  sourceFingerprint: string; state: "ready" | "routed" | "review" | "pending" | "unknown"; blockedReason?: string; route?: { decision: string; runId: string; completed: boolean };
}
export interface LogisticsMarketingExclusion { lineKey: string; sourceFingerprint: string; skuId: string; at: string; restoredAt?: string }
export interface LogisticsFollowUpProof {
  kind: "marketing" | "discontinue" | "reorder"; outputKey: string; fileName: string; at: string; token: string;
  sourceKeys: string[]; sourceFingerprints: string[]; couponCount: number; discontinueCount: number;
  advertisingCount: number; advertisingFiles: string[]; completedAt?: string;
  reorderRows?: Array<{ sourceId: string; pair: string; sourceLineKey?: string; purchaseOrderNumber: string; skuId: string; shortageQuantity: number }>;
  requestIds?: string[]; requestSkuIds?: string[]; discontinueReviewToken?: string;
}
export interface LogisticsFollowUpState { exclusions?: LogisticsMarketingExclusion[]; proofs?: LogisticsFollowUpProof[]; blockedMarketingSkuIds?: string[] }
export interface LogisticsFollowUpResponse {
  ok: true; token: string; collectedAt?: string;
  queues: Record<LogisticsFollowUpKind, LogisticsFollowUpLine[]>;
  exclusionHistory: LogisticsMarketingExclusion[]; proofs: LogisticsFollowUpProof[];
}
