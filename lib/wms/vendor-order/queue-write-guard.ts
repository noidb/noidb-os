import { normalizeSkuId } from "../sku-normalize";
import type { PickingWaveStoreMutation, PickingWaveStoreSnapshot } from "../picking-wave/shared-store-types";
import type { VendorOrderDraft, VendorOrderDraftLine } from "./types";

export class VendorOrderWriteConflictError extends Error {
  constructor(message: string) { super(message); this.name = "VendorOrderWriteConflictError"; }
}
const queueIdFrom = (value?: string) => value?.startsWith("VENDOR-QUEUE-") ? value.split("::")[0] : undefined;
export const isServerVendorQueueRecord = (value: { id: string; waveId?: string }) => Boolean(queueIdFrom(value.id) || queueIdFrom(value.waveId));
const retired = (store: PickingWaveStoreSnapshot, value?: { id: string; waveId?: string; draftId?: string }) => value && [value.id, value.waveId, value.draftId].some(key => { const queue = queueIdFrom(key); return queue && queue !== store.activeVendorQueueId; });
const fail = (): never => { throw new VendorOrderWriteConflictError("이 화면의 발주대기는 이전 목록입니다. 메인에서 최신 거래처 발주대기를 열어 다시 진행해 주세요."); };
const sent = (store: PickingWaveStoreSnapshot, line?: VendorOrderDraftLine) => Boolean(line && store.vendorOrderDrafts.some(draft => draft.id === line.draftId && draft.status === "sent"));
// A historical receiving screen may update receipt fields, but cannot change the
// original order identity, quantities or product data through an old queue.
const receiptFields = new Set(["updatedAt", "receivedQuantity", "receivedUsedImmediatelyAt", "receivingHistory", "receivedUnitPrice", "receivedVat", "receivedCostVatIncluded", "receivedCostAppliedAt", "receivingDelayedAt", "receivingDelayReleasedAt", "reorderPendingQuantity", "reorderRequestedAt"]);
function onlyReceiptChanged(before: VendorOrderDraftLine, after: VendorOrderDraftLine) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => !receiptFields.has(key))
    .every(key => JSON.stringify(before[key as keyof VendorOrderDraftLine]) === JSON.stringify(after[key as keyof VendorOrderDraftLine]));
}
function canReleaseSent(before: VendorOrderDraft | undefined, after: VendorOrderDraft) {
  if (!before || before.status !== "sent" || after.status !== (before.statusBeforeSent || "approved")) return false;
  return ["id", "waveId", "vendorName", "createdAt", "statusBeforeSent"].every(key => before[key as keyof VendorOrderDraft] === after[key as keyof VendorOrderDraft]);
}
/** Guard before the reducer changes any record, including legacy browser requests. */
export function assertVendorQueueMutation(store: PickingWaveStoreSnapshot, mutation: PickingWaveStoreMutation): void {
  if (mutation.action === "saveVendorLine") {
    const current = store.vendorOrderLines.find(line => line.id === mutation.line.id);
    if (current?.orderExclusion) throw new VendorOrderWriteConflictError("이미 완료 처리되어 발주에서 제외한 상품입니다. 최신 거래처 발주대기를 열어 다시 확인해 주세요.");
    if ((retired(store, current) || retired(store, mutation.line)) && !(current && sent(store, current) && onlyReceiptChanged(current, mutation.line))) fail();
    if (isServerVendorQueueRecord(mutation.line) && store.deletedVendorLineIds[mutation.line.id]) throw new VendorOrderWriteConflictError("이미 삭제한 발주 품목입니다. 최신 거래처 발주대기를 열어 다시 확인해 주세요.");
    if (mutation.expectedUpdatedAt !== undefined && (current?.updatedAt ?? null) !== mutation.expectedUpdatedAt) throw new VendorOrderWriteConflictError("다른 화면에서 이 상품이 변경되거나 삭제되었습니다. 최신 거래처 발주대기를 열어 수정 내용을 확인해 주세요.");
    if (!current && mutation.line.waveId === store.activeVendorQueueId && isServerVendorQueueRecord(mutation.line)
      && mutation.line.shortageQuantity > 0 && !mutation.line.orderExclusion && !sent(store, mutation.line)) {
      const sku = normalizeSkuId(mutation.line.skuId);
      if (sku && store.vendorOrderLines.some(line => line.id !== mutation.line.id && line.waveId === mutation.line.waveId
        && !line.orderExclusion && line.shortageQuantity > 0 && !sent(store, line)
        && !store.deletedVendorLineIds[line.id] && !store.vendorQueueConsumedLineIds?.[line.id] && !store.deletedVendorDraftIds[line.draftId]
        && normalizeSkuId(line.skuId) === sku)) throw new VendorOrderWriteConflictError("이미 추가된 SKU입니다. 최신 거래처 발주대기를 열어 기존 상품의 수량을 확인해 주세요.");
    }
  } else if (mutation.action === "saveSimpleReceiving") {
    const current = store.vendorOrderLines.find(line => line.id === mutation.before.id);
    if (retired(store, current || mutation.before) && !sent(store, current)) fail();
  } else if (mutation.action === "saveVendorDraft") {
    const current = store.vendorOrderDrafts.find(draft => draft.id === mutation.draft.id);
    if (mutation.expectedUpdatedAt !== undefined && (current?.updatedAt ?? null) !== mutation.expectedUpdatedAt) throw new VendorOrderWriteConflictError("다른 화면에서 발주서의 상품 또는 상태가 변경되었습니다. 최신 거래처 발주대기를 열어 확인해 주세요.");
    if ((retired(store, current) || retired(store, mutation.draft)) && !canReleaseSent(current, mutation.draft) && !(current?.status === "sent" && JSON.stringify({ ...current, updatedAt: mutation.draft.updatedAt }) === JSON.stringify(mutation.draft))) fail();
    if (isServerVendorQueueRecord(mutation.draft) && store.deletedVendorDraftIds[mutation.draft.id]) throw new VendorOrderWriteConflictError("이미 삭제한 발주서입니다. 최신 거래처 발주대기를 열어 다시 확인해 주세요.");
  } else if (mutation.action === "deleteVendorDraft") {
    const current = store.vendorOrderDrafts.find(draft => draft.id === mutation.draftId);
    if (retired(store, current || { id: mutation.draftId }) && current?.status !== "sent") fail();
  } else if (mutation.action === "deleteVendorLine" || mutation.action === "saveVendorLineImage") {
    const current = store.vendorOrderLines.find(line => line.id === mutation.lineId);
    if (mutation.action === "saveVendorLineImage" && current?.orderExclusion) throw new VendorOrderWriteConflictError("이미 완료 처리되어 발주에서 제외한 상품입니다. 최신 거래처 발주대기를 열어 다시 확인해 주세요.");
    if (retired(store, current || { id: mutation.lineId }) && (mutation.action === "saveVendorLineImage" || !sent(store, current))) fail();
  } else if (mutation.action === "deleteVendorLines") {
    if (retired(store, { id: mutation.waveId })) fail();
    for (const id of mutation.lineIds) if (retired(store, store.vendorOrderLines.find(line => line.id === id) || { id })) fail();
  }
}
/** Historical sent exports stay available; unsent retired orders cannot be sent again. */
export function assertVendorQueueExport(store: PickingWaveStoreSnapshot, waveId: string, lines: Array<{ id?: string; skuId: string; vendorName: string }>): void {
  if (!retired(store, { id: waveId })) return;
  for (const candidate of lines) {
    const current = candidate.id ? store.vendorOrderLines.find(line => line.id === candidate.id)
      : store.vendorOrderLines.find(line => line.waveId === waveId && line.skuId === candidate.skuId && line.vendorName === candidate.vendorName);
    if (!current || current.waveId !== waveId || !sent(store, current)) fail();
  }
}

/** Latest read-only validation before an edited order is previewed or exported. */
export function assertVendorOrderCandidatesFresh(store: PickingWaveStoreSnapshot, lines: Array<{ id?: string }>, expectedUpdatedAtByLineId?: Record<string, string | null>): void {
  for (const line of lines) {
    if (!line.id) continue;
    const current = store.vendorOrderLines.find(saved => saved.id === line.id);
    if (!current && (store.deletedVendorLineIds[line.id] || store.vendorQueueConsumedLineIds?.[line.id])) throw new VendorOrderWriteConflictError("삭제되거나 다른 발주대기로 이동한 품목이 있습니다. 최신 거래처 발주대기를 열어 다시 확인해 주세요.");
    if (!current?.orderExclusion && expectedUpdatedAtByLineId && Object.hasOwn(expectedUpdatedAtByLineId, line.id)
      && (current?.updatedAt ?? null) !== expectedUpdatedAtByLineId[line.id]) throw new VendorOrderWriteConflictError("다른 화면에서 상품이 변경되었습니다. 최신 거래처 발주대기를 열어 수량과 사진을 확인한 뒤 다시 진행해 주세요.");
  }
}

export function assertVendorDraftsFresh(store: PickingWaveStoreSnapshot, expectedUpdatedAtById?: Record<string, string | null>): void {
  for (const [id, expected] of Object.entries(expectedUpdatedAtById || {})) {
    const current = store.vendorOrderDrafts.find(draft => draft.id === id);
    if ((current?.updatedAt ?? null) !== expected) throw new VendorOrderWriteConflictError("다른 화면에서 발주서에 상품이 추가되거나 상태가 변경되었습니다. 최신 거래처 발주대기를 열어 확인한 뒤 다시 진행해 주세요.");
  }
}
/** Run after completion exclusions, in the same atomic reducer as the sent status. */
export function assertVendorDraftMembership(store: PickingWaveStoreSnapshot, draftId: string, expectedLineIds: string[]): void {
  const activeIds = store.vendorOrderLines.filter(line => line.draftId === draftId && !line.orderExclusion && line.shortageQuantity > 0
    && !store.deletedVendorLineIds[line.id] && !store.vendorQueueConsumedLineIds?.[line.id]).map(line => line.id);
  const expected = new Set(expectedLineIds);
  if (expected.size !== expectedLineIds.length || activeIds.length !== expected.size || activeIds.some(id => !expected.has(id))) throw new VendorOrderWriteConflictError("확인한 뒤 발주서의 상품 목록이 변경되었습니다. 최신 거래처 발주대기를 열어 전체 상품을 확인한 뒤 전송완료해 주세요.");
}
