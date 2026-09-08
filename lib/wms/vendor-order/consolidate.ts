import { archiveCompletedVendorOrderLines, vendorOrderLineExclusion, type VendorOrderCompletionScope } from "./completion";
import type { PickingWaveStoreSnapshot } from "../picking-wave/shared-store-types";
import { deriveVendorOrderDrafts } from "./derive-drafts";
import { UNASSIGNED_VENDOR_NAME, type VendorOrderDraft, type VendorOrderDraftLine } from "./types";
import { normalizeSkuId } from "../sku-normalize";
export const VENDOR_QUEUE_PREFIX = "VENDOR-QUEUE-";
export interface VendorQueueReceipt { queueId: string; at: string; added: number; duplicates: number; sourceLines: VendorOrderDraftLine[] }
/** Atomic transfer. Retain source evidence and edited quantities; an unsent queue keeps its identity. */
export function consolidateVendorOrders(store: PickingWaveStoreSnapshot, operationId: string, incoming: VendorOrderDraftLine[], now: string, completionScope?: VendorOrderCompletionScope): VendorQueueReceipt {
  const prior = store.vendorQueueReceipts?.[operationId];
  if (prior) return prior;
  // A retry from an old tab must never restore a deleted or previously consumed source.
  incoming = incoming.filter(line => !store.vendorQueueConsumedLineIds?.[line.id] &&
    !store.deletedVendorLineIds[line.id] && !store.deletedVendorDraftIds[line.draftId] &&
    !store.suppressedVendorSkuIds?.[normalizeSkuId(line.skuId)]);
  const excludedIncoming = completionScope ? incoming.flatMap(line => {
    const exclusion = vendorOrderLineExclusion(line, completionScope);
    return exclusion ? [{ ...line, orderExclusion: exclusion }] : [];
  }) : [];
  if (completionScope) archiveCompletedVendorOrderLines(store, completionScope);
  for (const line of excludedIncoming) if (!store.vendorOrderLines.some(saved => saved.id === line.id)) store.vendorOrderLines.push(line);
  const excludedIncomingIds = new Set(excludedIncoming.map(line => line.id));
  incoming = incoming.filter(line => !excludedIncomingIds.has(line.id));
  const drafts = deriveVendorOrderDrafts(store.vendorOrderDrafts, store.vendorOrderLines);
  const pendingIds = new Set(drafts.filter(draft => draft.status !== "sent" && !store.deletedVendorDraftIds[draft.id]).map(draft => draft.id));
  const pending = store.vendorOrderLines.filter(line => pendingIds.has(line.draftId) && line.shortageQuantity > 0 && !line.orderExclusion &&
    !store.deletedVendorLineIds[line.id] && !store.vendorQueueConsumedLineIds?.[line.id] &&
    !store.suppressedVendorSkuIds?.[normalizeSkuId(line.skuId)]);
  if (pending.some(line => (line.receivedQuantity || 0) > 0 || line.receivedCostAppliedAt || line.receivingHistory?.length)) throw new Error("이미 입고 이력이 있는 대기 발주가 있습니다. 입고관리에서 상태를 확인한 뒤 취합해 주세요.");
  const currentQueue = store.activeVendorQueueId;
  // Sent files retain their original batch. Approval, deletion and exclusions alone never rotate a live queue.
  const hasSentBatch = currentQueue && drafts.some(draft => draft.waveId === currentQueue && draft.status === "sent");
  const queueId = currentQueue && !hasSentBatch ? currentQueue : VENDOR_QUEUE_PREFIX + operationId;
  const baseLineId = (skuId: string, waveId = queueId) => waveId + "::" + normalizeSkuId(skuId);
  const rank = (line: VendorOrderDraftLine) => line.id === baseLineId(line.skuId, line.waveId) ? 2 :
    line.id.startsWith(baseLineId(line.skuId, line.waveId) + "::new-") ? 1 : 0;
  // Even after a sent batch requires a new queue, the user's most recent active queue wins over older sources.
  const currentLines = pending.filter(line => line.waveId === currentQueue).sort((a, b) => rank(b) - rank(a) ||
    b.updatedAt.localeCompare(a.updatedAt) || a.createdAt.localeCompare(b.createdAt));
  const sources = [...currentLines, ...pending.filter(line => line.waveId !== currentQueue).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), ...incoming];
  const sourceIds = new Set(sources.map(line => line.id));
  const retainedIds = new Set(store.vendorOrderLines.filter(line => !sourceIds.has(line.id)).map(line => line.id));
  const activeDrafts = new Map<string, VendorOrderDraft>();
  for (const draft of drafts.filter(draft => draft.waveId === queueId && draft.status !== "sent" && !store.deletedVendorDraftIds[draft.id])) {
    if (activeDrafts.has(draft.vendorName) && activeDrafts.get(draft.vendorName)!.id !== draft.id) throw new Error("같은 거래처의 발주대기가 중복되어 있습니다. 저장된 목록을 다시 확인해 주세요.");
    activeDrafts.set(draft.vendorName, draft);
  }
  const draftFor = (vendorName: string) => {
    const existing = activeDrafts.get(vendorName);
    if (existing) return existing;
    const baseId = queueId + "::" + vendorName;
    let id = baseId;
    if (store.deletedVendorDraftIds[id] || store.vendorOrderDrafts.some(draft => draft.id === id)) {
      id = baseId + "::new-" + operationId;
      let suffix = 1;
      while (store.deletedVendorDraftIds[id] || store.vendorOrderDrafts.some(draft => draft.id === id)) id = baseId + "::new-" + operationId + "-" + suffix++;
    }
    const draft: VendorOrderDraft = { id, waveId: queueId, vendorName, status: "draft", createdAt: now, updatedAt: now };
    activeDrafts.set(vendorName, draft);
    return draft;
  };
  const result = new Map<string, VendorOrderDraftLine>();
  const incomingIds = new Set(incoming.map(line => line.id));
  const withTimestampIfChanged = (before: VendorOrderDraftLine, after: VendorOrderDraftLine) =>
    JSON.stringify(before) === JSON.stringify(after) ? before : { ...after, updatedAt: now };
  let added = 0, duplicates = 0;
  for (const source of sources) {
    const skuId = normalizeSkuId(source.skuId);
    if (!skuId || !Number.isSafeInteger(source.shortageQuantity) || source.shortageQuantity <= 0) throw new Error("발주 SKU와 수량을 확인해 주세요.");
    const existing = result.get(skuId);
    if (existing) {
      duplicates++;
      result.set(skuId, withTimestampIfChanged(existing, { ...existing, imageUrl: existing.imageUrl || source.imageUrl,
        actualShortageQuantity: incomingIds.has(source.id) && source.actualShortageQuantity !== undefined ? source.actualShortageQuantity : existing.actualShortageQuantity,
        relatedPurchaseOrderNumbers: [...new Set([...existing.relatedPurchaseOrderNumbers, ...source.relatedPurchaseOrderNumbers])] }));
    } else {
      const vendorName = source.vendorName.trim() || UNASSIGNED_VENDOR_NAME;
      const draft = draftFor(vendorName);
      let id = source.waveId === queueId ? source.id : baseLineId(skuId);
      if (store.deletedVendorLineIds[id] || retainedIds.has(id)) {
        id = baseLineId(skuId) + "::new-" + operationId;
        let suffix = 1;
        while (store.deletedVendorLineIds[id] || retainedIds.has(id)) id = baseLineId(skuId) + "::new-" + operationId + "-" + suffix++;
      }
      result.set(skuId, withTimestampIfChanged(source, { ...source, id, draftId: draft.id, waveId: queueId, vendorName, skuId }));
      if (source.waveId !== queueId) added++;
    }
  }
  const originalById = new Map(store.vendorOrderLines.map(line => [line.id, line]));
  const changedDraftIds = new Set([...result.values()].filter(line => {
    const previous = originalById.get(line.id);
    return !previous || JSON.stringify(previous) !== JSON.stringify(line);
  }).map(line => line.draftId));
  store.vendorOrderLines = store.vendorOrderLines.filter(line => !sourceIds.has(line.id)).concat([...result.values()]);
  for (const draft of activeDrafts.values()) {
    if (![...result.values()].some(line => line.draftId === draft.id)) continue;
    const nextDraft = draft.status === "approved" && changedDraftIds.has(draft.id)
      ? { ...draft, status: "resend_needed" as const, updatedAt: now } : draft;
    const index = store.vendorOrderDrafts.findIndex(saved => saved.id === draft.id);
    if (index < 0) store.vendorOrderDrafts.push(nextDraft); else store.vendorOrderDrafts[index] = nextDraft;
  }
  store.vendorQueueConsumedLineIds = { ...store.vendorQueueConsumedLineIds };
  const resultIds = new Set([...result.values()].map(line => line.id));
  for (const line of sources) {
    if (resultIds.has(line.id)) continue; // Includes stable canonical, manual, and fresh demand version IDs.
    store.vendorQueueConsumedLineIds[line.id] = queueId;
    store.deletedVendorLineIds[line.id] = now;
  }
  for (const line of excludedIncoming) store.vendorQueueConsumedLineIds[line.id] = queueId;
  const receipt = { queueId, at: now, added, duplicates, sourceLines: [...sources, ...excludedIncoming] };
  store.vendorQueueReceipts = { ...store.vendorQueueReceipts, [operationId]: receipt };
  store.activeVendorQueueId = queueId;
  return receipt;
}
