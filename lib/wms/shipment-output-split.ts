import type { PurchaseOrderSourceDocument } from "./purchase-order-source/types";

export const DEFAULT_MAX_INVOICE_QUANTITY = 200;

export interface ShipmentOutputDocumentBatch {
  documents: PurchaseOrderSourceDocument[];
  totalQuantity: number;
  manualReviewRequired: boolean;
}

function documentQuantity(document: PurchaseOrderSourceDocument): number {
  return document.records.reduce((sum, record) => sum + (Number.isFinite(record.orderedQuantity) ? record.orderedQuantity : 0), 0);
}

/**
 * 한 송장에 들어갈 발주서를 총수량 한도까지 묶는다. 발주서 한 건은 항상 원자 단위이며
 * 단일 발주가 한도를 넘으면 쪼개지 않고 수동 분할 확인 대상으로 별도 반환한다.
 */
export function splitShipmentOutputDocuments(
  source: readonly PurchaseOrderSourceDocument[],
  maxTotalQuantity = DEFAULT_MAX_INVOICE_QUANTITY,
): ShipmentOutputDocumentBatch[] {
  if (!Number.isInteger(maxTotalQuantity) || maxTotalQuantity < 1) throw new Error("송장 최대수량은 1 이상의 정수여야 합니다.");
  const documents = [...source].sort((left, right) => left.purchaseOrderNumber.localeCompare(right.purchaseOrderNumber));
  const batches: ShipmentOutputDocumentBatch[] = [];
  let pending: PurchaseOrderSourceDocument[] = [];
  let pendingQuantity = 0;

  const flush = () => {
    if (!pending.length) return;
    batches.push({ documents: pending, totalQuantity: pendingQuantity, manualReviewRequired: false });
    pending = [];
    pendingQuantity = 0;
  };

  for (const document of documents) {
    const quantity = documentQuantity(document);
    if (quantity > maxTotalQuantity) {
      flush();
      batches.push({ documents: [document], totalQuantity: quantity, manualReviewRequired: true });
      continue;
    }
    if (pending.length && pendingQuantity + quantity > maxTotalQuantity) flush();
    pending.push(document);
    pendingQuantity += quantity;
  }
  flush();
  return batches;
}
