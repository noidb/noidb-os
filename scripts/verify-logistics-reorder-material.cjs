const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { logisticsReceiptLineKey } = require("../lib/wms/logistics-receipts.ts");
const { pendingReorderQueue } = require("../lib/wms/weekly-reorder-queue.ts");
const at = "2026-09-20T00:00:00.000Z";
const baseItem = (skuId, po, shortage) => ({ skuId, productName: `상품 ${skuId}`, productLink: "", vendorName: "거래처", imageUrl: "", optionLabel: "", modelName: "", barcode: "", shortageQuantity: shortage, openOrderQuantity: 0, suggestedQuantity: shortage, relatedPurchaseOrderNumbers: [po], issues: [], discontinued: false });
function logisticsRun(id, shipmentNumber, boxId, po, sku, delivered, received, done = false, handledQuantity = 0) {
  const shortage = delivered - received - handledQuantity;
  return { id, revision: 1, updatedAt: at, sentVendors: {}, reorderRequestedAt: done ? at : undefined,
    snapshot: { id, createdAt: at, sourceToken: id, period: { startDate: "2026-09-20", endDate: "2026-09-20" }, source: { files: [], latestActualDate: "", firstActualDate: "", eventCount: 0, duplicateCount: 0, selectedEventCount: 0, mode: "upload" }, couponItems: [], vendorItems: [baseItem(sku, po, shortage)], warnings: [], blockers: [] },
    reviews: { [sku]: { skuId: sku, vendorName: "거래처", imageUrl: "", quantity: shortage, decision: "reorder", quantityConfirmed: true } },
    logisticsReceiptLine: { lineKey: logisticsReceiptLineKey(shipmentNumber, boxId, po, sku), shipmentNumber, boxId, purchaseOrderNumber: po, skuId: sku, deliveredQuantity: delivered, receivedQuantity: received, handledQuantity, shortageQuantity: shortage } };
}
function snapshot(lines) { return { source: "supplier-hub-shipments", schemaVersion: 2, collectedAt: at, requestedShipmentNumbers: lines.map(line => line.shipmentNumber), shipments: lines.map(line => ({ shipmentNumber: line.shipmentNumber, status: "마감", totalDelivered: line.deliveredQuantity, totalReceived: line.receivedQuantity, lines: [{ boxId: line.boxId, purchaseOrderNumber: line.purchaseOrderNumber, skuId: line.skuId, productName: "상품", barcode: "x", deliveredQuantity: line.deliveredQuantity, receivedQuantity: line.receivedQuantity }] })) }; }
const one = logisticsRun("one", "10000001", "A", "900", "1", 5, 3);
const two = logisticsRun("two", "10000002", "B", "900", "1", 4, 1);
const completed = logisticsRun("done", "10000003", "C", "900", "1", 9, 2, true);
let workspace = { runs: [one, two, completed], logisticsReceipts: snapshot([one.logisticsReceiptLine, two.logisticsReceiptLine, completed.logisticsReceiptLine]), productOverrides: {} };
let queue = pendingReorderQueue(workspace);
assert.deepEqual(queue.rows.map(row => [row.purchaseOrderNumber, row.skuId, row.shortageQuantity]), [["900", "1", 5]]);
assert.equal(queue.sources.length, 2); assert.deepEqual(queue.sources.map(source => source.rows[0].shortageQuantity).sort(), [2, 3]);
const partial = logisticsRun("partial", "10000004", "D", "901", "2", 8, 3, false, 2);
workspace = { runs: [partial], logisticsReceipts: snapshot([partial.logisticsReceiptLine]), productOverrides: {} };
queue = pendingReorderQueue(workspace);
assert.equal(queue.rows[0].shortageQuantity, 3);
workspace = { runs: [one, two, completed], logisticsReceipts: snapshot([one.logisticsReceiptLine, two.logisticsReceiptLine, completed.logisticsReceiptLine]), productOverrides: {} };
workspace.logisticsReceipts.shipments[1].lines[0].receivedQuantity = 0;
workspace.logisticsReceipts.shipments[1].totalReceived = 0;
queue = pendingReorderQueue(workspace);
assert.equal(queue.rows.length, 1); assert.equal(queue.rows[0].shortageQuantity, 2); assert.match(queue.issues[0].message, /현재 저장된/);
const legacy = { id: "legacy", revision: 1, updatedAt: at, sentVendors: {}, snapshot: { ...one.snapshot, id: "legacy", vendorItems: [{ ...baseItem("1", "900", 2), shortageDetails: [{ purchaseOrderNumber: "900", confirmedQuantity: 5, receivedQuantity: 3, shortageQuantity: 2 }] }] }, reviews: one.reviews };
workspace = { runs: [one, legacy], logisticsReceipts: snapshot([one.logisticsReceiptLine]), productOverrides: {} };
queue = pendingReorderQueue(workspace);
assert.equal(queue.rows.length, 0); assert.equal(queue.issues.length, 1); assert.match(queue.issues[0].message, /수량을 합치지 않고/);
const completedLegacy = { ...legacy, id: "legacy-done", reorderRequestedAt: at, reorderRequestedLines: [{ purchaseOrderNumber: "900", skuId: "1", shortageQuantity: 2 }] };
workspace = { runs: [one, completedLegacy], logisticsReceipts: snapshot([one.logisticsReceiptLine]), productOverrides: {} };
queue = pendingReorderQueue(workspace);
assert.equal(queue.rows.length, 0); assert.match(queue.issues[0].message, /수량을 합치지 않고/);
const duplicate = { ...one, id: "duplicate", revision: 2 };
workspace = { runs: [one, duplicate], logisticsReceipts: snapshot([one.logisticsReceiptLine]), productOverrides: {} };
queue = pendingReorderQueue(workspace);
assert.equal(queue.rows.length, 0); assert.equal(queue.sources.length, 0); assert.match(queue.issues[0].message, /여러 업무/);
console.log("PASS logistics line-key aggregation, per-source completion exclusion, current receipt validation, legacy overlap, and duplicate-source blocks");
