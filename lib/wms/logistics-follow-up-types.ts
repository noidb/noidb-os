/** Browser-safe contract for shipment follow-up review. */
export type LogisticsFollowUpKind = "marketing" | "discontinue" | "reorder" | "vendor";
export interface LogisticsFollowUpLine {
  lineKey: string; sourceLineKey: string; shipmentNumber: string; boxId: string; purchaseOrderNumber: string;
  skuId: string; productName: string; barcode: string; kind: "marketing" | "shortage";
  sourceFingerprint: string; state: "ready" | "routed" | "review" | "pending" | "unknown"; blockedReason?: string; route?: { decision: string; runId: string; completed: boolean };
  /** 2026-10-11: 화면 표시용 — 그 쉽먼트의 입고예정일과 미납수량(미납 줄만). */
  expectedDate?: string; shortageQuantity?: number;
  /** 2026-10-11: 쿠폰이 아직 걸려 있거나 예전 쿠폰 종료일을 확인하지 못해 이번 쿠폰 파일에서 빠지는 이유. */
  couponNote?: string;
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
