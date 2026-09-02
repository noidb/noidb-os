import assert from "node:assert/strict";
import { assertOutputPurchaseOrderSet, buildShipmentOutputContext } from "../lib/wms/shipment-output-context";
import type { PurchaseOrderIndex, PurchaseOrderSourceDocument } from "../lib/wms/purchase-order-source/types";

const ADDRESS = "경기도 이천시 마장면 이장로 329-38";
function document(po: string, patch: Partial<PurchaseOrderSourceDocument> = {}): PurchaseOrderSourceDocument {
  const base: PurchaseOrderSourceDocument = {
    purchaseOrderNumber: po, sourceContainerFile: "fixture.zip", sourceEntryFile: `${po}.xlsx`, sourceSheet: po, sourceRow: 10,
    fulfillmentCenterName: "이천2", expectedArrivalDate: "2026-09-04", recipientName: "", phone: "+827051588142", postalCode: "", address: ADDRESS,
    records: [{ purchaseOrderNumber: po, sourceContainerFile: "fixture.zip", sourceEntryFile: `${po}.xlsx`, sourceSheet: po, sourceRow: 22,
      fulfillmentCenterName: "이천2", expectedArrivalDate: "2026-09-04", recipientName: "", phone: "+827051588142", postalCode: "", address: ADDRESS,
      skuId: `SKU-${po}`, barcode: `BAR-${po}`, productName: "상품", optionName: "옵션", orderedQuantity: 1 }],
  };
  return { ...base, ...patch, records: patch.records || base.records };
}
function index(documents: PurchaseOrderSourceDocument[], patch: Partial<PurchaseOrderIndex> = {}): PurchaseOrderIndex {
  return { byPurchaseOrderNumber: new Map(documents.map(item => [item.purchaseOrderNumber, item])), duplicateFiles: [], identicalDuplicates: [], conflicts: [], parseErrors: [], sourceContainerCount: 1, sourceEntryCount: documents.length, ...patch };
}

async function main() {
  const single = await buildShipmentOutputContext(["1"], { index: index([document("1")]) });
  assert.equal(single.preview.canGenerate, true); assert.equal(single.preview.shippingGroupCount, 1);
  const multi = await buildShipmentOutputContext(["1", "2"], { index: index([document("1"), document("2")]) });
  assert.equal(multi.preview.shippingGroupCount, 1);
  const differentAddress = document("2", { address: `${ADDRESS} 2층` }); differentAddress.records = differentAddress.records.map(row => ({ ...row, address: differentAddress.address }));
  assert.equal((await buildShipmentOutputContext(["1", "2"], { index: index([document("1"), differentAddress]) })).preview.shippingGroupCount, 2);
  assert.equal((await buildShipmentOutputContext(["1", "2"], { index: index([document("1"), document("2", { phone: "+821011112222" })]) })).preview.shippingGroupCount, 2);
  const missingPostal = await buildShipmentOutputContext(["3"], { index: index([document("3", { fulfillmentCenterName: "미등록센터", address: "미등록 주소" })]) });
  assert.equal(missingPostal.preview.canGenerate, false); assert.deepEqual(missingPostal.preview.missingPostalCodeCenters, ["미등록센터"]);
  assert.equal((await buildShipmentOutputContext(["404"], { index: index([]) })).preview.missingPurchaseOrderNumbers.length, 1);
  const duplicateIndex = index([document("1")], { identicalDuplicates: [{ purchaseOrderNumber: "1", sources: ["a", "b"] }] });
  assert.equal((await buildShipmentOutputContext(["1"], { index: duplicateIndex })).preview.duplicatePurchaseOrderCount, 1);
  const conflictIndex = index([], { conflicts: [{ purchaseOrderNumber: "1", sources: ["a", "b"] }] });
  assert.equal((await buildShipmentOutputContext(["1"], { index: conflictIndex })).preview.conflictPurchaseOrderNumbers.length, 1);
  const badSku = document("1"); badSku.records[0].skuId = "";
  assert.equal((await buildShipmentOutputContext(["1"], { index: index([badSku]) })).preview.missingSkuRows.length, 1);
  const badBarcode = document("1"); badBarcode.records[0].barcode = "";
  assert.equal((await buildShipmentOutputContext(["1"], { index: index([badBarcode]) })).preview.missingBarcodeRows.length, 1);
  const badQty = document("1"); badQty.records[0].orderedQuantity = 0;
  assert.equal((await buildShipmentOutputContext(["1"], { index: index([badQty]) })).preview.quantityErrorRows.length, 1);
  assert.throws(() => assertOutputPurchaseOrderSet(multi, ["1"]));
  console.log("purchase-order source fixtures: PASS");
}
main().catch(error => { console.error(error); process.exit(1); });
