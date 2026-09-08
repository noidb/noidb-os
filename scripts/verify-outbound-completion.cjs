const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { emptyPickingWaveStoreSnapshot } = require("../lib/wms/picking-wave/shared-store-types.ts");
const { applyPickingWaveStoreMutation } = require("../lib/wms/picking-wave/server-store.ts");
const { buildWorkCenterOverview } = require("../lib/wms/work-center.ts");
const { packingGenerationKey, isPackingFullyDispatched } = require("../lib/wms/packing-progress.ts");

function fixture() {
  const stamp = "2026-09-08T05:04:00.000Z";
  const wave = { id: "WAVE-DISPATCH-TEST", displayName: "출고완료 확인 작업", status: "in_progress", sourcePurchaseOrderNumbers: ["PO1", "PO2"], completedGroupIds: [], createdAt: stamp, updatedAt: stamp };
  const items = wave.sourcePurchaseOrderNumbers.map((po, index) => ({
    id: "I" + index, waveId: wave.id, productCode: String(70000001 + index), productName: "검증 상품 " + index, barcode: "R1000000" + index,
    totalQuantity: 2, sources: [{ purchaseOrderNumber: po, basketNumber: po, requestedQuantity: 2 }], allocations: [], status: "full", pickedQuantity: 2, shortageQuantity: 0, createdAt: stamp, updatedAt: stamp
  }));
  return { ...emptyPickingWaveStoreSnapshot(), waves: [wave], items };
}

function createRoute(initial) {
  let snapshot = structuredClone(initial);
  let writes = 0;
  const dependencies = {
    "next/server": { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } },
    "@/lib/wms/picking-wave/server-store": {
      readPickingWaveStore: async () => structuredClone(snapshot),
      mutatePickingWaveStore: async mutation => { snapshot = applyPickingWaveStoreMutation(snapshot, mutation); writes++; return snapshot; }
    },
    "@/lib/wms/work-center": { buildWorkCenterOverview },
    "@/lib/wms/noidb-action-auth": { isSameOriginActionRequest: request => request.origin !== false },
  };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("app/api/wms/work-center/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module, Error, exports: module.exports, require: name => { assert(Object.hasOwn(dependencies, name), name); return dependencies[name]; }
  });
  return { ...module.exports, snapshot: () => snapshot, writes: () => writes };
}

async function verify() {
  const initial = fixture();
  const wave = initial.waves[0];
  const route = createRoute(initial);
  const request = { waveId: wave.id, status: "completed", expectedUpdatedAt: null, expectedWorkUpdatedAt: wave.updatedAt, confirmed: true };
  assert.equal(buildWorkCenterOverview(initial).works[0].canComplete, false, "offline work may lack old per-item/document bookkeeping");
  assert.equal((await route.POST({ origin: false, json: async () => request })).status, 403);
  assert.equal((await route.POST({ json: async () => ({ ...request, confirmed: false }) })).status, 400);
  assert.equal((await route.POST({ json: async () => ({ ...request, expectedWorkUpdatedAt: "stale" }) })).status, 409);
  assert.equal(route.writes(), 0);
  const completed = await route.POST({ json: async () => request });
  assert.equal(completed.status, 200, "explicit actual dispatch confirmation can finish on the dashboard");
  const filed = completed.body.overview.works[0];
  assert.ok(filed.completedAt);
  assert.equal(filed.state.status, "completed");
  assert.equal(filed.delay, null);
  for (const key of ["waves", "items", "shipments", "baskets", "poConfirmationRecords", "vendorOrderDrafts", "vendorOrderLines"]) assert.deepEqual(route.snapshot()[key], initial[key], key + " preserved");
  assert.ok((await route.GET()).body.overview.works[0].completedAt, "fresh read and second device see completion");
  assert.equal((await route.POST({ json: async () => request })).status, 409, "stale duplicate confirmation cannot override state");
  const reopened = await route.POST({ json: async () => ({ ...request, status: "active", expectedUpdatedAt: filed.state.updatedAt }) });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.overview.works[0].completedAt, null);
  assert.equal(reopened.body.overview.works[0].state.history.length, 2);
  assert.equal(reopened.body.overview.works[0].state.history[0].status, "completed");

  const packing = fixture();
  packing.waves[0].outputGenerations = [{ generationId: "G1", purchaseOrderNumbers: ["PO1", "PO2"], status: "shipment_generated", shipmentFileName: "fixture.xlsx", invoiceGroups: [["PO1"], ["PO2"]] }];
  const generationKey = packingGenerationKey(packing.waves[0]);
  const row = index => ({ key: "K" + index, shipmentNumber: "5000000" + index, purchaseOrderNumber: "PO" + (index + 1), skuId: packing.items[index].productCode, barcode: packing.items[index].barcode, quantity: 2 });
  const base = { action: "savePackingProgress", waveId: wave.id, generationKey, checkedKeys: [], dispatched: false };
  const first = applyPickingWaveStoreMutation(packing, { ...base, rows: [row(0)], dispatchedShipmentNumbers: ["50000000"], expectedUpdatedAt: null, now: "2026-09-08T05:05:00Z" });
  assert.equal(buildWorkCenterOverview(first).works[0].completedAt, null, "one finished center must not hide remaining work");
  const all = applyPickingWaveStoreMutation(first, { ...base, rows: [row(1)], dispatchedShipmentNumbers: ["50000000", "50000001"], expectedUpdatedAt: "2026-09-08T05:05:00Z", now: "2026-09-08T05:06:00Z" });
  assert.deepEqual(all.packingProgress[wave.id].shipmentPurchaseOrders, { "50000000": ["PO1"], "50000001": ["PO2"] });
  assert.equal(all.outboundWorkStates[wave.id].status, "completed", "last Shipment finishes dashboard task without optional item checks");
  assert.ok(buildWorkCenterOverview(all).works[0].completedAt);
  assert.deepEqual(all.items, packing.items);
  assert.deepEqual(all.waves, packing.waves);
  const undone = applyPickingWaveStoreMutation(all, { ...base, rows: [row(1)], dispatchedShipmentNumbers: ["50000000"], expectedUpdatedAt: "2026-09-08T05:06:00Z", now: "2026-09-08T05:07:00Z" });
  assert.equal(undone.outboundWorkStates[wave.id].status, "active", "explicit Shipment undo restores pending work");
  assert.equal(buildWorkCenterOverview(undone).works[0].completedAt, null);
  const regenerated = structuredClone(all);
  regenerated.waves[0].outputGenerations[0].shipmentFileName = "changed.xlsx";
  assert.equal(isPackingFullyDispatched(regenerated.waves[0], regenerated.packingProgress[wave.id]), false, "old Shipment membership must not prove new-file completion");
  const oldWithoutMembership = { ...first, outboundWorkStates: {} };
  oldWithoutMembership.packingProgress[wave.id] = { ...first.packingProgress[wave.id], shipmentPurchaseOrders: undefined, dispatchedShipmentNumbers: ["50000000", "50000001"] };
  assert.equal(buildWorkCenterOverview(oldWithoutMembership).works[0].completedAt, null, "counts without all PO membership must not silently hide a legacy task");
  const legacy = structuredClone(all);
  legacy.outboundWorkStates = {};
  assert.ok(buildWorkCenterOverview(legacy).works[0].completedAt, "verified saved Shipment completion is reflected even without old dashboard filing");
  const restoredLegacy = applyPickingWaveStoreMutation(legacy, { action: "setOutboundWorkState", waveId: wave.id, status: "active", expectedUpdatedAt: null, now: "2026-09-08T05:08:00Z" });
  assert.equal(buildWorkCenterOverview(restoredLegacy).works[0].completedAt, null, "explicit restore overrides derived old completion");
  console.log("Outbound completion PASS: dashboard confirmation and origin checks, concurrent changes blocked, shared persistence, preserved originals/history, multi-center completion, partial and stale data stay visible, undo and restore.");
}

module.exports = { fixture, createRoute, verify };
if (require.main === module) verify().catch(error => { console.error(error); process.exitCode = 1; });
