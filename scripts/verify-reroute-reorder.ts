import assert from "node:assert/strict";
import { mergeHubClosedSnapshot, logisticsTargetsFromSnapshot, logisticsReceiptLineKey } from "../lib/wms/logistics-receipts";
import { reserveLogisticsReceiptRoute, rerouteToReorder } from "../lib/wms/logistics-receipt-routing";
const at = new Date(Date.now() - 60_000).toISOString();
const snap = mergeHubClosedSnapshot(undefined, { source: "supplier-hub-shipments", schemaVersion: 3, mode: "hub-closed", since: "2026-09-13", collectedAt: at,
  requestedShipmentNumbers: ["50000001"], shipments: [{ shipmentNumber: "50000001", status: "마감", totalDelivered: 5, totalReceived: 1,
    lines: [{ boxId: "A", purchaseOrderNumber: "111", skuId: "1", productName: "가", barcode: "B", deliveredQuantity: 3, receivedQuantity: 1 }, { boxId: "A", purchaseOrderNumber: "111", skuId: "2", productName: "나", barcode: "B", deliveredQuantity: 2, receivedQuantity: 0 }] }],
  skuStatuses: [{ skuId: "1", orderStatus: "정상" }, { skuId: "2", orderStatus: "정상" }], shipmentMetadata: { "50000001": { expectedDate: "2026-09-20", centerName: "동탄1" } } });
const ws: any = { schemaVersion: 1, revision: 0, runs: [], productOverrides: {}, logisticsReceipts: snap };
const targets = logisticsTargetsFromSnapshot(snap);
const k1 = logisticsReceiptLineKey("50000001", "A", "111", "1"), k2 = logisticsReceiptLineKey("50000001", "A", "111", "2");
reserveLogisticsReceiptRoute(ws, targets, { lineKey: k1, decision: "discontinue", expectedCollectedAt: at });
const r = rerouteToReorder(ws, targets, { lineKey: k1, expectedCollectedAt: at });
assert.equal(ws.logisticsReceiptRoutes[k1].decision, "reorder", "단종 → 재발주요청으로 바뀜");
assert.equal(ws.runs.filter((run: any) => run.logisticsReceiptLine?.lineKey === k1).length, 1, "옛 단종 기록은 지워짐");
assert.equal(r.note, "");
assert.throws(() => rerouteToReorder(ws, targets, { lineKey: k1, expectedCollectedAt: at }), /이미 재발주요청/);
ws.coveredByVendorOrder = { [k2]: { skuId: "2" } };
rerouteToReorder(ws, targets, { lineKey: k2, expectedCollectedAt: at });
assert.equal(ws.coveredByVendorOrder[k2], undefined); assert.equal(ws.logisticsReceiptRoutes[k2].decision, "reorder");
const ws2: any = { schemaVersion: 1, revision: 0, runs: [], productOverrides: {}, logisticsReceipts: snap };
reserveLogisticsReceiptRoute(ws2, targets, { lineKey: k1, decision: "discontinue", expectedCollectedAt: at });
ws2.logisticsFollowUp = { proofs: [{ kind: "discontinue", sourceKeys: [k1] }] };
assert.throws(() => rerouteToReorder(ws2, targets, { lineKey: k1, expectedCollectedAt: at }), /단종신청 파일/);
console.log("PASS 재발주요청으로 바꾸기: 단종(미신청)·기존발주처리→재발주, 중복·신청완료 단종은 막음");
