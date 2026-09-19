import assert from "node:assert/strict";
import { AutoShipmentBlockedError, buildInvoiceNumbersByPurchaseOrder } from "../lib/wms/hanjin-shipment-auto";
import type { HanjinShipmentRequest, ParsedTrackingRow } from "../lib/wms/hanjin-upload";

const requests: HanjinShipmentRequest[] = [
  { purchaseOrderNumber: "140000001", fulfillmentCenter: "동탄1", expectedDate: "2026-09-22" },
  { purchaseOrderNumber: "140000002", fulfillmentCenter: "동탄1", expectedDate: "2026-09-22" },
];
const rows: ParsedTrackingRow[] = [
  { purchaseOrderNumber: "140000001", fulfillmentCenter: "동탄1", transportType: "쉽먼트", expectedDate: "2026-09-22", skuId: "1001", barcode: "R1001", productName: "상품1", confirmedQuantity: "1", shippedQuantity: "1", trackingNumber: "463000000001" },
  { purchaseOrderNumber: "140000001", fulfillmentCenter: "동탄1", transportType: "쉽먼트", expectedDate: "2026-09-22", skuId: "1002", barcode: "R1002", productName: "상품2", confirmedQuantity: "2", shippedQuantity: "2", trackingNumber: "463000000001" },
  { purchaseOrderNumber: "140000002", fulfillmentCenter: "동탄1", transportType: "쉽먼트", expectedDate: "2026-09-22", skuId: "1003", barcode: "R1003", productName: "상품3", confirmedQuantity: "1", shippedQuantity: "1", trackingNumber: "463000000002" },
];

const actual = buildInvoiceNumbersByPurchaseOrder(requests, rows);
assert.deepEqual(actual, { "140000001": "463000000001", "140000002": "463000000002" });
assert.throws(
  () => buildInvoiceNumbersByPurchaseOrder(requests, [...rows.slice(0, 1), { ...rows[1], trackingNumber: "463000000099" }, rows[2]]),
  AutoShipmentBlockedError,
);
assert.throws(
  () => buildInvoiceNumbersByPurchaseOrder([...requests, { ...requests[0], expectedDate: "2026-09-23" }], rows),
  AutoShipmentBlockedError,
);
console.log(JSON.stringify({ mappedPurchaseOrders: Object.keys(actual).length, inconsistentTrackingBlocked: true, crossGroupPurchaseOrderBlocked: true }, null, 2));
