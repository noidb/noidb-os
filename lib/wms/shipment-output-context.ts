import { normalizeSkuId } from "./sku-normalize";
import { addressLedgerKey } from "./center-address/address-normalize";
import type { CenterAddressResolution } from "./center-address/types";
import { resolveDestinationSupplements } from "./purchase-order-source/destination";
import { buildPurchaseOrderIndex } from "./purchase-order-source/index";
import type { PurchaseOrderIndex, PurchaseOrderSourceDocument, PurchaseOrderSourceRecord } from "./purchase-order-source/types";
import { DEFAULT_MAX_INVOICE_QUANTITY, splitShipmentOutputDocuments } from "./shipment-output-split";

export interface ShipmentOutputGroup {
  key: string;
  fulfillmentCenterName: string;
  expectedArrivalDate: string;
  recipientName: string;
  phone: string;
  postalCode: string;
  postalCodeSource: string;
  address: string;
  purchaseOrderNumbers: string[];
  records: PurchaseOrderSourceRecord[];
}

export interface ShipmentOutputPreview {
  requestedPurchaseOrderCount: number;
  matchedPurchaseOrderCount: number;
  missingPurchaseOrderNumbers: string[];
  duplicatePurchaseOrderCount: number;
  conflictPurchaseOrderNumbers: string[];
  fulfillmentCenterCount: number;
  shippingGroupCount: number;
  expectedInvoiceRowCount: number;
  missingAddressPurchaseOrders: string[];
  missingPhonePurchaseOrders: string[];
  missingPostalCodeCenters: string[];
  destinationResolutions: CenterAddressResolution[];
  missingSkuRows: string[];
  missingBarcodeRows: string[];
  quantityErrorRows: string[];
  oversizedPurchaseOrderNumbers: string[];
  sourceRecordCount: number;
  totalOrderedQuantity: number;
  blockingReasons: string[];
  canGenerate: boolean;
}

export interface ShipmentOutputContext {
  purchaseOrderNumbers: string[];
  documents: PurchaseOrderSourceDocument[];
  records: PurchaseOrderSourceRecord[];
  groups: ShipmentOutputGroup[];
  preview: ShipmentOutputPreview;
}

function normalizedPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.startsWith("82") ? `0${digits.slice(2)}` : digits;
}
function normalizedAddress(value: string) {
  return value.replace(/\(택배수령담당자\s*:\s*\+?\d+\)\s*$/, "").replace(/\s+/g, "").trim();
}

export async function buildShipmentOutputContext(
  requestedPurchaseOrderNumbers: readonly string[],
  options: { index?: PurchaseOrderIndex; requireDestination?: boolean } = {}
): Promise<ShipmentOutputContext> {
  const index = options.index || await buildPurchaseOrderIndex();
  const purchaseOrderNumbers = [...new Set(requestedPurchaseOrderNumbers.map(normalizeSkuId).filter(Boolean))];
  const conflictSet = new Set(index.conflicts.map(item => normalizeSkuId(item.purchaseOrderNumber)));
  const conflicts = purchaseOrderNumbers.filter(po => conflictSet.has(po));
  const documents = purchaseOrderNumbers.map(po => index.byPurchaseOrderNumber.get(po)).filter((item): item is PurchaseOrderSourceDocument => Boolean(item));
  const matchedSet = new Set(documents.map(item => normalizeSkuId(item.purchaseOrderNumber)));
  const missing = purchaseOrderNumbers.filter(po => !matchedSet.has(po) && !conflictSet.has(po));
  const records = documents.flatMap(item => item.records);
  const missingAddress = documents.filter(item => !item.address.trim()).map(item => item.purchaseOrderNumber);
  const missingPhone = documents.filter(item => !item.phone.trim()).map(item => item.purchaseOrderNumber);
  const missingSkuRows = records.filter(item => !item.skuId.trim()).map(item => `${item.purchaseOrderNumber}:${item.sourceRow}`);
  const missingBarcodeRows = records.filter(item => !item.barcode.trim()).map(item => `${item.purchaseOrderNumber}:${item.sourceRow}`);
  const quantityErrorRows = records.filter(item => !Number.isFinite(item.orderedQuantity) || item.orderedQuantity <= 0).map(item => `${item.purchaseOrderNumber}:${item.sourceRow}`);

  const destinationGroups = new Map<string, { document: PurchaseOrderSourceDocument; postalCode: string; postalCodeSource: string }[]>();
  const missingPostalCodeCenters = new Set<string>();
  const destinationResolutions = await resolveDestinationSupplements(documents.map(document => ({ fulfillmentCenterName: document.fulfillmentCenterName, address: document.address })));
  for (const document of documents) {
    const resolution = destinationResolutions.get(addressLedgerKey(document.fulfillmentCenterName, document.address));
    if (!resolution || resolution.status !== "approved") missingPostalCodeCenters.add(document.fulfillmentCenterName);
    const recipientName = `로켓배송*${document.fulfillmentCenterName}`;
    const postalCode = resolution?.postalCode || "";
    const key = [document.fulfillmentCenterName.replace(/\s+/g, ""), document.expectedArrivalDate, normalizedAddress(document.address), normalizedPhone(document.phone), postalCode, recipientName].join("\0");
    destinationGroups.set(key, [...(destinationGroups.get(key) || []), { document, postalCode, postalCodeSource: resolution?.source || "" }]);
  }
  const oversizedPurchaseOrderNumbers: string[] = [];
  const groups: ShipmentOutputGroup[] = [];
  for (const [destinationKey, entries] of destinationGroups) {
    const entryByPo = new Map(entries.map(entry => [entry.document.purchaseOrderNumber, entry]));
    const batches = splitShipmentOutputDocuments(entries.map(entry => entry.document));
    batches.forEach((batch, batchIndex) => {
      const first = batch.documents[0];
      const firstEntry = entryByPo.get(first.purchaseOrderNumber)!;
      if (batch.manualReviewRequired) oversizedPurchaseOrderNumbers.push(first.purchaseOrderNumber);
      groups.push({
        key: `${destinationKey}\0${batchIndex + 1}`,
        fulfillmentCenterName: first.fulfillmentCenterName,
        expectedArrivalDate: first.expectedArrivalDate,
        recipientName: `로켓배송*${first.fulfillmentCenterName}`,
        phone: first.phone,
        postalCode: firstEntry.postalCode,
        postalCodeSource: firstEntry.postalCodeSource,
        address: first.address,
        purchaseOrderNumbers: batch.documents.map(document => document.purchaseOrderNumber),
        records: batch.documents.flatMap(document => document.records),
      });
    });
  }
  const blockingReasons: string[] = [];
  if (missing.length) blockingReasons.push(`원본 미매칭 발주번호 ${missing.length}개`);
  if (conflicts.length) blockingReasons.push(`원본 충돌 발주번호 ${conflicts.length}개`);
  if (missingAddress.length) blockingReasons.push(`주소 누락 ${missingAddress.length}개`);
  if (missingPhone.length) blockingReasons.push(`전화번호 누락 ${missingPhone.length}개`);
  if (options.requireDestination !== false && missingPostalCodeCenters.size) blockingReasons.push(`우편번호 미등록 센터 ${missingPostalCodeCenters.size}곳`);
  if (missingSkuRows.length) blockingReasons.push(`SKU 누락 ${missingSkuRows.length}행`);
  if (missingBarcodeRows.length) blockingReasons.push(`바코드 누락 ${missingBarcodeRows.length}행`);
  if (quantityErrorRows.length) blockingReasons.push(`수량 오류 ${quantityErrorRows.length}행`);
  if (oversizedPurchaseOrderNumbers.length) blockingReasons.push(`단일 발주 ${DEFAULT_MAX_INVOICE_QUANTITY}개 초과 · 수동 분할 확인 ${oversizedPurchaseOrderNumbers.length}건`);
  if (matchedSet.size !== purchaseOrderNumbers.length) blockingReasons.push("요청 PO 집합과 원본 매칭 PO 집합이 일치하지 않습니다.");

  const preview: ShipmentOutputPreview = {
    requestedPurchaseOrderCount: purchaseOrderNumbers.length,
    matchedPurchaseOrderCount: documents.length,
    missingPurchaseOrderNumbers: missing,
    duplicatePurchaseOrderCount: index.identicalDuplicates.filter(item => purchaseOrderNumbers.includes(normalizeSkuId(item.purchaseOrderNumber))).length,
    conflictPurchaseOrderNumbers: conflicts,
    fulfillmentCenterCount: new Set(documents.map(item => item.fulfillmentCenterName)).size,
    shippingGroupCount: groups.length,
    expectedInvoiceRowCount: groups.length,
    missingAddressPurchaseOrders: missingAddress,
    missingPhonePurchaseOrders: missingPhone,
    missingPostalCodeCenters: [...missingPostalCodeCenters].sort((a, b) => a.localeCompare(b, "ko")),
    destinationResolutions: [...destinationResolutions.values()].sort((a, b) => a.fulfillmentCenterName.localeCompare(b.fulfillmentCenterName, "ko")),
    missingSkuRows,
    missingBarcodeRows,
    quantityErrorRows,
    oversizedPurchaseOrderNumbers,
    sourceRecordCount: records.length,
    totalOrderedQuantity: records.reduce((sum, item) => sum + (Number.isFinite(item.orderedQuantity) ? item.orderedQuantity : 0), 0),
    blockingReasons,
    canGenerate: blockingReasons.length === 0,
  };
  return { purchaseOrderNumbers, documents, records, groups, preview };
}

export class ShipmentOutputValidationError extends Error {
  constructor(public readonly preview: ShipmentOutputPreview) {
    super(`송장 생성 완전성 검사 실패: ${preview.blockingReasons.join(" | ")}`);
    this.name = "ShipmentOutputValidationError";
  }
}

export function assertOutputPurchaseOrderSet(context: ShipmentOutputContext, outputPurchaseOrderNumbers: readonly string[]) {
  const expected = [...context.purchaseOrderNumbers].sort();
  const actual = [...new Set(outputPurchaseOrderNumbers.map(normalizeSkuId))].sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new ShipmentOutputValidationError({ ...context.preview, canGenerate: false, blockingReasons: [...context.preview.blockingReasons, "출력 PO 집합이 요청 PO 집합과 일치하지 않습니다."] });
}
