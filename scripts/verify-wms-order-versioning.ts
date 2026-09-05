import assert from "node:assert/strict";
import { hasSupplierHubPurchaseOrderContentChange, type SupplierHubPurchaseOrder } from "../lib/wms/supplier-hub-orders";

const base: SupplierHubPurchaseOrder = {
  purchaseOrderNumber: "140000001",
  orderType: "신규",
  fulfillmentCenter: "동탄1",
  fulfillmentAddress: "경기도 예시로 1",
  fulfillmentContactPhone: "010-0000-0000",
  expectedDate: "2026-09-05",
  accountName: "노이드비",
  sourceFileName: "old.xlsx",
  capturedAt: "2026-09-01T00:00:00.000Z",
  items: [{
    lineNo: 1,
    productCode: "SKU-1",
    productName: "상품, 실버, 25호",
    barcode: "R000000000001",
    purchaseType: "직매입",
    taxType: "과세",
    orderedQuantity: 1,
    vendorConfirmedQuantity: 0,
    receivedQuantity: 0,
  }],
};

assert.equal(hasSupplierHubPurchaseOrderContentChange(base, { ...base, sourceFileName: "same-copy.xlsx" }), false);
assert.equal(hasSupplierHubPurchaseOrderContentChange(base, {
  ...base,
  sourceFileName: "quantity-changed.xlsx",
  items: [{ ...base.items[0], orderedQuantity: 2 }],
}), true);
assert.equal(hasSupplierHubPurchaseOrderContentChange(base, { ...base, fulfillmentCenter: "서울1" }), true);

console.log("PASS: 동일 발주번호의 일정·상품·수량 변경을 새 버전으로 감지합니다.");
