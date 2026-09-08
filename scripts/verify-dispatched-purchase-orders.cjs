const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { emptyPickingWaveStoreSnapshot } = require("../lib/wms/picking-wave/shared-store-types.ts");
const { buildDispatchedPurchaseOrderIndex, projectWaveDispatchedPurchaseOrders, dispatchedPurchaseOrderIdentity } = require("../lib/wms/dispatched-purchase-orders.ts");
const { packingGenerationKey, packingManifestKey, packingShipmentManifestKeys } = require("../lib/wms/packing-progress.ts");

const before = "2026-09-08T05:00:00.000Z", completedAt = "2026-09-08T08:31:12.808Z", after = "2026-09-08T09:00:00.000Z";
const sourceId = "WAVE-SHIPPED", targetId = "WAVE-WORK";
function wave(id, pos) {
  return { id, status: "in_progress", sourcePurchaseOrderNumbers: pos, completedGroupIds: [], productDbConfigured: true, createdAt: before, updatedAt: before,
    shippingGroups: pos.map((po, i) => ({ key: `2026-09-09\u0000센터${i}`, expectedDate: "2026-09-09", fulfillmentCenter: "센터" + i, purchaseOrderNumbers: [po] })) };
}
function item(waveId, po, sku, quantity, index = 0) {
  return { id: waveId + "-" + sku, waveId, productCode: sku, productName: "상품 " + sku, barcode: "R" + sku,
    totalQuantity: quantity, sources: [{ purchaseOrderNumber: po, basketNumber: "B" + index, requestedQuantity: quantity, shippingGroupKey: `2026-09-09\u0000센터${index}` }],
    allocations: [], status: "pending", pickedQuantity: 0, shortageQuantity: 0, createdAt: before, updatedAt: before };
}
function fixture() {
  const snapshot = emptyPickingWaveStoreSnapshot();
  snapshot.waves = [wave(sourceId, ["141427163", "141427351"]), wave(targetId, ["141427163", "141427351", "NEWPO"])];
  snapshot.items = [item(sourceId, "141427163", "79392729", 1), item(sourceId, "141427351", "79392727", 3, 1),
    item(targetId, "141427163", "79392729", 1), item(targetId, "141427351", "79392727", 3, 1), item(targetId, "NEWPO", "80000001", 7, 2)];
  snapshot.outboundWorkStates = { [sourceId]: { status: "completed", source: "manual", updatedAt: completedAt, history: [{ status: "completed", source: "manual", changedAt: completedAt }] } };
  return snapshot;
}
function projected(snapshot) { return projectWaveDispatchedPurchaseOrders(snapshot, targetId); }
function expectOnly(snapshot, pos, reason) { assert.deepEqual(projected(snapshot).completedPurchaseOrderNumbers, pos, reason); }
function targetItem(snapshot, po) { return snapshot.items.find(row => row.waveId === targetId && row.sources.some(source => source.purchaseOrderNumber === po)); }
function packingFixture() {
  const snapshot = fixture();
  snapshot.outboundWorkStates = {};
  const source = snapshot.waves[0];
  for (const row of snapshot.items.filter(row => row.waveId === sourceId)) row.status = "full";
  source.outputGenerations = [{ generationId: "G1", waveId: source.id, purchaseOrderNumbers: [...source.sourcePurchaseOrderNumbers], shipmentFileName: "shipment.xlsx", invoiceGroups: [["141427163"], ["141427351"]], status: "shipment_generated", createdAt: before, updatedAt: before }];
  const rows = snapshot.items.filter(row => row.waveId === sourceId).map((row, i) => ({ key: "K" + i, shipmentNumber: "5000000" + i, purchaseOrderNumber: row.sources[0].purchaseOrderNumber, skuId: row.productCode, barcode: row.barcode, quantity: row.totalQuantity }));
  snapshot.packingProgress = { [sourceId]: { generationKey: packingGenerationKey(source), manifestKey: packingManifestKey(rows), rows, checkedKeys: rows.map(row => row.key),
    shipmentPurchaseOrders: { "50000000": ["141427163"], "50000001": ["141427351"] }, shipmentManifestKeys: packingShipmentManifestKeys(rows), dispatchedShipmentNumbers: ["50000000"], updatedAt: completedAt } };
  return snapshot;
}
function freeze(value) { if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; }

let cases = 0;
function check(name, run) { run(); cases++; process.stdout.write("PASS " + name + "\n"); }
check("actual duplicate PO identity is excluded, raw source history and snapshot remain unchanged", () => {
  const snapshot = freeze(fixture()), original = JSON.stringify(snapshot);
  const index = buildDispatchedPurchaseOrderIndex(snapshot), result = projectWaveDispatchedPurchaseOrders(snapshot, targetId, index);
  assert.deepEqual(result.completedPurchaseOrderNumbers, ["141427163", "141427351"]);
  assert.deepEqual(result.remainingPurchaseOrderNumbers, ["NEWPO"]);
  assert.equal(result.completed[0].source, "manual");
  assert.equal(result.completed[0].waveId, sourceId);
  assert.deepEqual(projectWaveDispatchedPurchaseOrders(snapshot, sourceId, index).completedPurchaseOrderNumbers, []);
  assert.equal(JSON.stringify(snapshot), original);
});
check("scoped manual completion cannot claim inherited PO work after its original source is restored", () => {
  const snapshot = fixture();
  snapshot.outboundWorkStates[sourceId].purchaseOrderNumbers = ["141427163"];
  expectOnly(snapshot, ["141427163"]);
  snapshot.outboundWorkStates[sourceId].purchaseOrderNumbers = [];
  expectOnly(snapshot, []);
});
check("manual actual parcel confirmation remains valid despite partial picking records", () => {
  const snapshot = fixture(); snapshot.items[0].status = "partial"; snapshot.items[0].shortageQuantity = 1;
  snapshot.items[0].allocations = [{ ...snapshot.items[0].sources[0], fulfilledQuantity: 0, shortageQuantity: 1 }];
  expectOnly(snapshot, ["141427163", "141427351"]);
});
check("shared SKU identity compares only the corresponding PO source, not aggregate SKU quantity", () => {
  const snapshot = fixture(), row = targetItem(snapshot, "141427163");
  row.sources.push({ purchaseOrderNumber: "NEWPO", basketNumber: "other-basket", requestedQuantity: 7, shippingGroupKey: "2026-09-09\u0000센터2" }); row.totalQuantity += 7;
  expectOnly(snapshot, ["141427163", "141427351"]);
});
check("wave-local basket numbers and source ordering do not change an otherwise exact identity", () => {
  const snapshot = fixture(), row = targetItem(snapshot, "141427351");
  row.sources = [{ ...row.sources[0], basketNumber: "NEWB1", requestedQuantity: 1 }, { ...row.sources[0], basketNumber: "NEWB2", requestedQuantity: 2 }];
  expectOnly(snapshot, ["141427163", "141427351"]);
});
for (const field of ["date", "center", "quantity", "sku", "barcode"]) check("changed " + field + " keeps the new PO visible", () => {
  const snapshot = fixture(), row = targetItem(snapshot, "141427163"), group = snapshot.waves[1].shippingGroups[0];
  if (field === "date") { group.expectedDate = "2026-09-11"; row.sources[0].shippingGroupKey = "2026-09-11\u0000센터0"; }
  if (field === "center") { group.fulfillmentCenter = "다른센터"; row.sources[0].shippingGroupKey = "2026-09-09\u0000다른센터"; }
  if (field === "quantity") row.sources[0].requestedQuantity++;
  if (field === "sku") row.productCode = "079392729";
  if (field === "barcode") row.barcode = "DIFFERENT";
  expectOnly(snapshot, ["141427351"]);
});
check("missing or contradictory shipping identity cannot hide a PO", () => {
  const snapshot = fixture(), row = targetItem(snapshot, "141427163");
  snapshot.waves[1].shippingGroups.shift(); delete row.sources[0].shippingGroupKey;
  expectOnly(snapshot, ["141427351"]);
  row.sources[0].shippingGroupKey = "2026-09-09\u0000센터0";
  snapshot.waves[1].shippingGroups.push({ expectedDate: "2026-09-11", fulfillmentCenter: "센터0", purchaseOrderNumbers: ["141427163"] });
  expectOnly(snapshot, ["141427351"]);
});
check("picking completed and generated documents are not dispatch evidence", () => {
  const snapshot = fixture(); snapshot.outboundWorkStates = {}; snapshot.waves[0].status = "completed";
  snapshot.waves[0].outputGenerations = [{ generationId: "G", purchaseOrderNumbers: ["141427163", "141427351"], status: "shipment_generated" }];
  expectOnly(snapshot, []);
});
check("source manual restore revokes completed evidence", () => {
  const snapshot = fixture(); snapshot.outboundWorkStates[sourceId] = { status: "active", source: "manual", updatedAt: after, history: [] };
  expectOnly(snapshot, []);
});
check("target restore wins over earlier cross-wave completion but newer dispatch can apply", () => {
  const snapshot = fixture(); snapshot.outboundWorkStates[targetId] = { status: "active", source: "manual", updatedAt: after, history: [] };
  expectOnly(snapshot, []);
  snapshot.outboundWorkStates[targetId].updatedAt = before;
  expectOnly(snapshot, ["141427163", "141427351"]);
});
check("explicitly completed or archived target is kept intact as history", () => {
  for (const status of ["completed", "archived"]) {
    const snapshot = fixture(); snapshot.outboundWorkStates[targetId] = { status, source: "manual", updatedAt: after, history: [] };
    expectOnly(snapshot, []);
  }
});
check("one verified dispatched Shipment excludes only its own complete PO", () => {
  const snapshot = packingFixture(); expectOnly(snapshot, ["141427163"]);
  assert.equal(projected(snapshot).completed[0].source, "packing");
});
check("all completed target packing remains an intact history record", () => {
  const snapshot = packingFixture(), progress = snapshot.packingProgress[sourceId];
  progress.dispatchedShipmentNumbers.push("50000001");
  expectOnly(snapshot, ["141427163", "141427351"]);
  assert.deepEqual(projectWaveDispatchedPurchaseOrders(snapshot, sourceId).completedPurchaseOrderNumbers, []);
});
check("old output generation completion is rejected", () => {
  const snapshot = packingFixture(); snapshot.waves[0].outputGenerations[0].generationId = "REGENERATED";
  expectOnly(snapshot, []);
});
check("automatic completed state alone cannot bypass missing or stale packing evidence", () => {
  const snapshot = fixture(); snapshot.outboundWorkStates[sourceId].source = "packing";
  snapshot.outboundWorkStates[sourceId].generationKey = "OLD";
  expectOnly(snapshot, []);
});
check("packing restore prevents old manifests from creating new cross-wave completion", () => {
  const snapshot = packingFixture(); snapshot.outboundWorkStates[sourceId] = { status: "active", source: "manual", updatedAt: completedAt, history: [] };
  expectOnly(snapshot, []);
});
check("completed manifest for another center survives changing the latest visible packing rows", () => {
  const snapshot = packingFixture(), progress = snapshot.packingProgress[sourceId];
  progress.rows = [progress.rows[1]]; progress.manifestKey = packingManifestKey(progress.rows);
  expectOnly(snapshot, ["141427163"]);
});
check("a dispatched PO with a confirmed shortage is complete for this shipment", () => {
  const snapshot = packingFixture(), row = snapshot.items[0];
  row.sources[0].requestedQuantity = 12; targetItem(snapshot, "141427163").sources[0].requestedQuantity = 12;
  row.status = "partial"; row.pickedQuantity = 8; row.shortageQuantity = 4;
  row.allocations = [{ ...row.sources[0], fulfilledQuantity: 8, shortageQuantity: 4 }];
  const progress = snapshot.packingProgress[sourceId]; progress.rows[0].quantity = 8;
  progress.shipmentManifestKeys = packingShipmentManifestKeys(progress.rows);
  expectOnly(snapshot, ["141427163"]);
  progress.rows[0].quantity = 7;
  expectOnly(snapshot, [], "a partial subset of the committed eight units is insufficient");
});
check("unreviewed or missing partial allocations cannot prove completed fulfillment", () => {
  const snapshot = packingFixture(); snapshot.items[0].status = "pending"; expectOnly(snapshot, []);
  snapshot.items[0].status = "partial"; expectOnly(snapshot, []);
  snapshot.items[0].allocations = [{ ...snapshot.items[0].sources[0], fulfilledQuantity: 1, shortageQuantity: 1 }];
  expectOnly(snapshot, [], "allocation quantities must add up to original request");
});
check("same-generation quantity changes cannot make a stale Shipment hide the changed PO", () => {
  const snapshot = packingFixture(); snapshot.items[0].sources[0].requestedQuantity = 2; targetItem(snapshot, "141427163").sources[0].requestedQuantity = 2;
  expectOnly(snapshot, []);
});
check("partial dispatch and ambiguously split PO are never summed into a complete PO", () => {
  const snapshot = packingFixture(), progress = snapshot.packingProgress[sourceId];
  snapshot.items[0].sources[0].requestedQuantity = 2; targetItem(snapshot, "141427163").sources[0].requestedQuantity = 2;
  expectOnly(snapshot, []);
  progress.shipmentPurchaseOrders["50000002"] = ["141427163"];
  progress.shipmentManifestKeys["50000002"] = progress.shipmentManifestKeys["50000000"];
  progress.dispatchedShipmentNumbers.push("50000002");
  expectOnly(snapshot, []);
});
check("membership with no verifiable stored manifest cannot prove completion", () => {
  const snapshot = packingFixture(), progress = snapshot.packingProgress[sourceId];
  progress.rows = [progress.rows[1]]; delete progress.shipmentManifestKeys["50000000"];
  expectOnly(snapshot, []);
  progress.shipmentManifestKeys["50000000"] = "corrupted";
  expectOnly(snapshot, []);
});
check("invalid completion timestamp is ignored while legacy manual completion remains supported", () => {
  const snapshot = fixture(); snapshot.outboundWorkStates[sourceId].updatedAt = "invalid"; expectOnly(snapshot, []);
  snapshot.outboundWorkStates[sourceId].updatedAt = completedAt; delete snapshot.outboundWorkStates[sourceId].source; expectOnly(snapshot, ["141427163", "141427351"]);
});
check("identity requires positive integer requested quantities and exact nonempty SKU", () => {
  const snapshot = fixture(); const source = snapshot.waves[0], row = snapshot.items[0];
  for (const quantity of [0, -1, 1.5, Number.NaN]) { row.sources[0].requestedQuantity = quantity; assert.equal(dispatchedPurchaseOrderIdentity(source, snapshot.items, "141427163"), null); }
  row.sources[0].requestedQuantity = 1; row.productCode = ""; assert.equal(dispatchedPurchaseOrderIdentity(source, snapshot.items, "141427163"), null);
});
check("missing target and unrelated PO numbers are safe empty projections", () => {
  const snapshot = fixture(); assert.deepEqual(projectWaveDispatchedPurchaseOrders(snapshot, "MISSING"), { completed: [], completedPurchaseOrderNumbers: [], remainingPurchaseOrderNumbers: [] });
  snapshot.waves[1].sourcePurchaseOrderNumbers[0] = "0141427163"; expectOnly(snapshot, ["141427351"]);
});
process.stdout.write(`Verified ${cases} cross-wave dispatch regression cases.\n`);
