import assert from "node:assert/strict";
import { summarizeClosedShipmentHistory, summarizeClosedShipmentHistoryDates } from "../lib/wms/closed-shipment-history";
import { mergeLogisticsReceiptSnapshot } from "../lib/wms/logistics-receipts";
import type { LogisticsReceiptSnapshot } from "../lib/wms/logistics-receipts";

const snapshot: LogisticsReceiptSnapshot = {
  source: "supplier-hub-shipments", schemaVersion: 3, collectedAt: "2026-09-20T01:00:00.000Z", requestedShipmentNumbers: ["12345678", "87654321"], skuStatuses: [],
  shipments: [
    { shipmentNumber: "12345678", status: "마감", totalDelivered: 8, totalReceived: 8, lines: [
      { boxId: "box-1", purchaseOrderNumber: "1001", skuId: "2001", productName: "상품 A", barcode: "a", deliveredQuantity: 2, receivedQuantity: 2 },
      { boxId: "box-2", purchaseOrderNumber: "1001", skuId: "2001", productName: "상품 A", barcode: "a", deliveredQuantity: 3, receivedQuantity: 3 },
      { boxId: "box-3", purchaseOrderNumber: "1001", skuId: "2002", productName: "상품 B", barcode: "b", deliveredQuantity: 3, receivedQuantity: 3 },
      { boxId: "box-2", purchaseOrderNumber: "1001", skuId: "2001", productName: "상품 A", barcode: "a", deliveredQuantity: 3, receivedQuantity: 3 },
    ] },
    { shipmentNumber: "87654321", status: "발송 완료", totalDelivered: null, totalReceived: null, lines: [] },
  ],
};

const rows = summarizeClosedShipmentHistory(snapshot, new Map([["12345678", { expectedDate: "2026-09-22", centerName: "동탄1" }]]));
assert.equal(rows.length, 2);
assert.equal(rows.find(row => row.skuId === "2001")?.receivedQuantity, 5, "same box line must not be added twice");
assert.equal(rows.find(row => row.skuId === "2002")?.receivedQuantity, 3);
const dates = summarizeClosedShipmentHistoryDates(rows);
assert.deepEqual(dates, [{ expectedDate: "2026-09-22", shipmentCount: 1, purchaseOrderCount: 1, skuCount: 2, receivedQuantity: 8 }]);
const saved = mergeLogisticsReceiptSnapshot(undefined, {
  source: "supplier-hub-shipments", schemaVersion: 3, collectedAt: new Date().toISOString(), requestedShipmentNumbers: ["12345678"],
  shipments: [{ shipmentNumber: "12345678", status: "마감", totalDelivered: 1, totalReceived: 1, lines: [{ boxId: "box-1", purchaseOrderNumber: "1001", skuId: "2001", productName: "상품 A", barcode: "a", deliveredQuantity: 1, receivedQuantity: 1 }] }],
  skuStatuses: [{ skuId: "2001", orderStatus: "정상" }],
}, [{ shipmentNumber: "12345678", expectedDate: "2026-09-22", centerName: "동탄1", purchaseOrderNumbers: ["1001"], source: "dispatch" }]);
assert.deepEqual(saved.shipmentMetadata, { "12345678": { expectedDate: "2026-09-22", centerName: "동탄1" } }, "target metadata must remain with the saved snapshot");
console.log("PASS closed shipment history: closed rows only, box rows folded, duplicate box line ignored");
