import type { PickingWaveStoreSnapshot } from "./picking-wave/shared-store-types";
import type { WeeklyWorkspace } from "./weekly-work-types";

export type HistoricalShortageStatus = "already_resolved" | "shipping_today" | "delayed" | "discontinued" | "vendor_correction" | "needs_review";
export interface HistoricalShortageEvidence { purchaseOrderNumber: string; skuId: string; status: Exclude<HistoricalShortageStatus, "shipping_today" | "needs_review">; reason: string }

const pairKey = (purchaseOrderNumber: string, skuId: string) => JSON.stringify([purchaseOrderNumber.trim(), skuId.trim()]);

/** Read-only projection from existing completion, receiving, and status records. */
export function historicalShortageEvidence(workspace: WeeklyWorkspace, store: Pick<PickingWaveStoreSnapshot, "vendorOrderDrafts" | "vendorOrderLines">): HistoricalShortageEvidence[] {
  const draftStatus = new Map(store.vendorOrderDrafts.map(draft => [draft.id, draft.status]));
  const result = new Map<string, HistoricalShortageEvidence>();
  const priority: Record<HistoricalShortageEvidence["status"], number> = { already_resolved: 4, discontinued: 3, delayed: 2, vendor_correction: 1 };
  const add = (purchaseOrderNumber: string, skuId: string, status: HistoricalShortageEvidence["status"], reason: string) => {
    const po = purchaseOrderNumber.trim(), sku = skuId.trim();
    if (!po || !sku) return;
    const key = pairKey(po, sku), prior = result.get(key);
    if (!prior || priority[status] > priority[prior.status]) result.set(key, { purchaseOrderNumber: po, skuId: sku, status, reason });
  };

  for (const run of workspace.runs) {
    if (run.reorderRequestedAt || run.reorderQueuePartialRequestedAt) for (const line of run.reorderRequestedLines || []) {
      add(line.purchaseOrderNumber, line.skuId, "already_resolved", "기존 재발주 처리완료 이력");
    }
  }
  for (const line of store.vendorOrderLines) {
    const purchaseOrders = [...new Set(line.relatedPurchaseOrderNumbers.map(value => value.trim()).filter(Boolean))];
    for (const purchaseOrderNumber of purchaseOrders) {
      if (line.sentResolution?.kind === "reorder" || line.receivingCompletedAt && (line.receivedQuantity || 0) >= line.shortageQuantity) {
        add(purchaseOrderNumber, line.skuId, "already_resolved", line.sentResolution?.kind === "reorder" ? "기존 재발주 이동 완료" : "기존 입고완료 기록");
      } else if (line.sentResolution?.kind === "discontinue") {
        add(purchaseOrderNumber, line.skuId, "discontinued", "기존 단종 분리 기록");
      } else if (draftStatus.get(line.draftId) === "sent" && line.receivingDelayedAt && !line.receivingDelayReleasedAt) {
        add(purchaseOrderNumber, line.skuId, "delayed", "전송 발주서의 입고지연 진행 기록");
      } else if (line.vendorTransfer) {
        add(purchaseOrderNumber, line.skuId, "vendor_correction", "기존 거래처 이동 기록");
      }
    }
  }
  for (const request of workspace.statusListSnapshot?.requests || []) {
    if (request.requestType !== "단종" || request.supplyHubStatus !== "처리대기" && request.supplyHubStatus !== "처리완료") continue;
    if (request.purchaseOrderNumber) add(request.purchaseOrderNumber, request.skuId, "discontinued", `기존 단종 ${request.supplyHubStatus} 기록`);
  }
  return [...result.values()].sort((a, b) => a.purchaseOrderNumber.localeCompare(b.purchaseOrderNumber) || a.skuId.localeCompare(b.skuId));
}

export function historicalShortagePairKey(purchaseOrderNumber: string, skuId: string): string { return pairKey(purchaseOrderNumber, skuId); }
