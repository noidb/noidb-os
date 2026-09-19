import type { PickingWaveStoreSnapshot } from "../picking-wave/shared-store-types";
import { planNewVendorDraft } from "./new-draft";
import { isVendorLineResolved } from "./receiving-state";
import { UNASSIGNED_VENDOR_NAME, type VendorOrderDraftLine } from "./types";

export interface SentVendorTransferInput {
  lineId: string; vendorName: string; operationId: string; now: string;
  expectedUpdatedAt: string; expectedQueueId: string; expectedTargetVersion: string;
}
export function targetVendorVersion(store: PickingWaveStoreSnapshot, vendorName: string): string {
  const drafts = store.vendorOrderDrafts.filter(d => d.waveId === store.activeVendorQueueId && d.vendorName === vendorName && !d.archivedAt && !store.deletedVendorDraftIds[d.id]);
  const ids = new Set(drafts.map(d => d.id));
  return JSON.stringify([drafts.map(d => [d.id, d.updatedAt, d.status]).sort(), store.vendorOrderLines.filter(l => ids.has(l.draftId) && !store.deletedVendorLineIds[l.id]).map(l => [l.id, l.updatedAt]).sort()]);
}
export function transferSentVendorLine(store: PickingWaveStoreSnapshot, input: SentVendorTransferInput): PickingWaveStoreSnapshot {
  const source = store.vendorOrderLines.find(l => l.id === input.lineId);
  if (source?.vendorTransfer?.operationId === input.operationId && source.vendorTransfer.vendorName === input.vendorName) return store;
  const owner = store.vendorOrderDrafts.find(d => d.id === source?.draftId);
  if (!source || !owner || owner.status !== "sent" || store.deletedVendorLineIds[source.id] || store.deletedVendorDraftIds[owner.id] || isVendorLineResolved(source)) throw new Error("이동할 전송완료 상품을 최신 목록에서 확인해 주세요.");
  const name = input.vendorName.trim();
  if (!name || name === source.vendorName || name === UNASSIGNED_VENDOR_NAME || name !== input.vendorName) throw new Error("이동할 다른 거래처를 선택해 주세요.");
  if (source.updatedAt !== input.expectedUpdatedAt || !store.activeVendorQueueId || store.activeVendorQueueId !== input.expectedQueueId || targetVendorVersion(store, name) !== input.expectedTargetVersion) throw new Error("발주서가 변경됐습니다. 이동 수량과 거래처를 다시 확인해 주세요.");
  const quantity = source.shortageQuantity - (source.receivedQuantity || 0);
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > source.shortageQuantity) throw new Error("다른 거래처로 이동할 미입고 수량이 없습니다.");
  let drafts = store.vendorOrderDrafts;
  const targets = drafts.filter(d => d.waveId === store.activeVendorQueueId && d.vendorName === name && !d.archivedAt && !store.deletedVendorDraftIds[d.id] && d.status !== "sent");
  if (targets.length > 1) throw new Error("대상 거래처의 진행 중인 발주서가 중복되어 있습니다. 최신 목록을 확인해 주세요.");
  let target = targets[0];
  if (!target) {
    const plan = planNewVendorDraft(store, store.activeVendorQueueId, name, input.operationId, input.now);
    target = plan.draft;
    const changed = new Map(plan.mutation.drafts.map(d => [d.id, d]));
    drafts = [...drafts.filter(d => !changed.has(d.id)), ...changed.values()];
  }
  const existing = store.vendorOrderLines.find(l => l.draftId === target.id && l.skuId === source.skuId && !store.deletedVendorLineIds[l.id] && !isVendorLineResolved(l));
  if (existing && (!existing.shipmentReceiptDetails?.length || !source.shipmentReceiptDetails?.length
    || Boolean(existing.isStockReplenishment) !== Boolean(source.isStockReplenishment)
    || source.shipmentReceiptDetails.some(detail => existing.shipmentReceiptDetails!.some(saved => saved.lineKey === detail.lineKey)))) {
    throw new Error("대상 발주서에 같은 SKU가 이미 있습니다. 중복 수량을 먼저 확인해 주세요.");
  }
  const id = target.id + "::transfer-" + input.operationId;
  if (store.deletedVendorLineIds[id] || store.vendorOrderLines.some(l => l.id === id)) throw new Error("이미 사용한 이동 번호입니다. 다시 확인해 주세요.");
  const moved: VendorOrderDraftLine = {
    id, draftId: target.id, waveId: target.waveId, vendorName: name,
    skuId: source.skuId, modelName: source.modelName, category: source.category, optionLabel: source.optionLabel,
    productName: source.productName, imageUrl: source.imageUrl, barcode: source.barcode,
    actualShortageQuantity: Math.min(source.actualShortageQuantity ?? quantity, quantity), shortageQuantity: quantity,
    currentStock: source.currentStock, relatedPurchaseOrderNumbers: [...source.relatedPurchaseOrderNumbers],
    memo: source.memo, isManuallyAdded: true, isStockReplenishment: source.isStockReplenishment,
    sourceType: source.sourceType, actualInboundDetails: source.actualInboundDetails?.map(detail => ({ ...detail })),
    shipmentReceiptDetails: source.shipmentReceiptDetails?.map(detail => ({ ...detail })),
    importedVendorSource: source.importedVendorSource && { ...source.importedVendorSource, details: source.importedVendorSource.details.map(detail => ({ ...detail })) },
    coupangConfirmedQuantity: source.coupangConfirmedQuantity, coupangReceivedQuantity: source.coupangReceivedQuantity,
    vendorTransferSourceLineId: source.id, createdAt: input.now, updatedAt: input.now,
  };
  let destination = moved;
  if (existing) {
    const details = [...existing.shipmentReceiptDetails!, ...moved.shipmentReceiptDetails!];
    const byPo = new Map<string, { purchaseOrderNumber: string; confirmedQuantity: number; receivedQuantity: number; shortageQuantity: number }>();
    for (const detail of details) {
      const row = byPo.get(detail.purchaseOrderNumber) || { purchaseOrderNumber: detail.purchaseOrderNumber, confirmedQuantity: 0, receivedQuantity: 0, shortageQuantity: 0 };
      row.confirmedQuantity += detail.receivedQuantity + detail.shortageQuantity;
      row.receivedQuantity += detail.receivedQuantity; row.shortageQuantity += detail.shortageQuantity;
      byPo.set(detail.purchaseOrderNumber, row);
    }
    destination = { ...existing, shortageQuantity: existing.shortageQuantity + quantity,
      actualShortageQuantity: details.reduce((sum, detail) => sum + detail.shortageQuantity, 0),
      shipmentReceiptDetails: details, actualInboundDetails: [...byPo.values()],
      relatedPurchaseOrderNumbers: [...new Set([...existing.relatedPurchaseOrderNumbers, ...source.relatedPurchaseOrderNumbers])],
      updatedAt: input.now };
  }
  const original = { ...source, vendorTransfer: { operationId: input.operationId, targetDraftId: target.id, targetLineId: destination.id, vendorName: name, quantity, at: input.now, sourceUpdatedAt: source.updatedAt }, updatedAt: input.now };
  // Adding demand invalidates approval; other sent orders keep their original records.
  drafts = drafts.map(draft => draft.id === target.id ? { ...draft, status: draft.status === "approved" ? "resend_needed" : draft.status, updatedAt: input.now } : draft);
  return { ...store, vendorOrderDrafts: drafts,
    vendorOrderLines: [...store.vendorOrderLines.filter(line => line.id !== existing?.id).map(line => line.id === source.id ? original : line), destination] };
}
