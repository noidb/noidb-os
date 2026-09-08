const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { emptyPickingWaveStoreSnapshot, isPickingWaveStoreMutation } = require("../lib/wms/picking-wave/shared-store-types.ts");
const { applyPickingWaveStoreMutation } = require("../lib/wms/picking-wave/server-store.ts");
const { mergeVendorImageResult } = require("../lib/wms/vendor-order/image-edit.ts");
const now = "2026-09-08T10:00:00Z";
function fixture() {
  return { ...emptyPickingWaveStoreSnapshot(), vendorOrderDrafts: [{ id: "D1", waveId: "W1", vendorName: "V1", status: "draft", createdAt: now, updatedAt: now }],
    vendorOrderLines: [{ id: "L1", draftId: "D1", waveId: "W1", vendorName: "V1", skuId: "1001", imageUrl: "", shortageQuantity: 36, actualShortageQuantity: 7,
      memo: "다른 화면의 새 메모", receivedQuantity: 3, receivingHistory: [{ id: "receiving-event", quantity: 3 }], receivedCostAppliedAt: now, currentStock: "3",
      relatedPurchaseOrderNumbers: ["PO1", "PO2"], createdAt: now, updatedAt: now }] };
}
const patch = { action: "saveVendorLineImage", lineId: "L1", imageUrl: "/api/wms/weekly-work/image?id=" + "a".repeat(64), expectedImageUrl: "", now: "2026-09-08T10:01:00Z" };
const initial = fixture();
const updated = applyPickingWaveStoreMutation(initial, patch);
assert.deepEqual(updated.vendorOrderLines[0], { ...initial.vendorOrderLines[0], imageUrl: patch.imageUrl, updatedAt: patch.now }, "only image and update timestamp may change");
assert.deepEqual(updated.vendorOrderDrafts, initial.vendorOrderDrafts, "image does not approve or mark sent");
assert.equal(initial.vendorOrderLines[0].imageUrl, "", "input snapshot preserved");
assert.equal(applyPickingWaveStoreMutation(updated, patch), updated, "lost response retry does not create a new revision");
assert.equal(isPickingWaveStoreMutation(patch), false, "dedicated same-origin endpoint is the only public image mutation route");
const concurrentImage = fixture(); concurrentImage.vendorOrderLines[0].imageUrl = "https://example.test/newer.jpg";
assert.throws(() => applyPickingWaveStoreMutation(concurrentImage, patch), /다른 화면.*사진/);
assert.equal(concurrentImage.vendorOrderLines[0].imageUrl, "https://example.test/newer.jpg");
for (const invalid of ["javascript:alert(1)", "data:image/png;base64,aaa", "/untrusted-path", "http://example.test/a.jpg", ""]) assert.throws(() => applyPickingWaveStoreMutation(initial, { ...patch, imageUrl: invalid }), /요청/);
const missing = fixture(); missing.vendorOrderLines = [];
assert.throws(() => applyPickingWaveStoreMutation(missing, patch), /삭제/);
const consumed = fixture(); consumed.vendorQueueConsumedLineIds = { L1: "VENDOR-QUEUE-next" };
assert.throws(() => applyPickingWaveStoreMutation(consumed, patch), /취합/);
const deleted = fixture(); deleted.deletedVendorLineIds.L1 = now;
assert.throws(() => applyPickingWaveStoreMutation(deleted, patch), /삭제/);
const deletedDraft = fixture(); deletedDraft.deletedVendorDraftIds.D1 = now;
assert.throws(() => applyPickingWaveStoreMutation(deletedDraft, patch), /삭제된 거래처/);
for (const status of ["approved", "sent"]) {
  const locked = fixture(); locked.vendorOrderDrafts[0].status = status;
  assert.throws(() => applyPickingWaveStoreMutation(locked, patch), /수정 상태/);
}
const alreadySent = structuredClone(updated); alreadySent.vendorOrderDrafts[0].status = "sent";
assert.equal(applyPickingWaveStoreMutation(alreadySent, patch), alreadySent, "same-image retry is safe even after the draft became sent");
const staleUi = { ...initial.vendorOrderLines[0], shortageQuantity: 12, actualShortageQuantity: 2, memo: "예전 메모", receivedQuantity: 0, receivingHistory: [] };
const clean = mergeVendorImageResult(staleUi, staleUi, updated.vendorOrderLines[0]);
assert.deepEqual(clean, updated.vendorOrderLines[0], "clean UI adopts newest quantities and receiving records");
const unsaved = mergeVendorImageResult({ ...staleUi, shortageQuantity: 24, memo: "내가 편집 중인 메모" }, staleUi, updated.vendorOrderLines[0]);
assert.equal(unsaved.shortageQuantity, 24);
assert.equal(unsaved.memo, "내가 편집 중인 메모");
assert.equal(unsaved.actualShortageQuantity, 7);
assert.equal(unsaved.receivedQuantity, 3);
assert.deepEqual(unsaved.receivingHistory, initial.vendorOrderLines[0].receivingHistory);
assert.equal(unsaved.imageUrl, patch.imageUrl);

async function verifyRoute() {
  let snapshot = fixture(), calls = 0;
  const deps = {
    "node:crypto": require("node:crypto"),
    "next/server": { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } },
    "@/lib/wms/noidb-action-auth": { isSameOriginActionRequest: request => request.origin !== false },
    "@/lib/wms/picking-wave/server-store": { readPickingWaveStore: async () => snapshot, mutatePickingWaveStore: async mutation => { calls++; snapshot = applyPickingWaveStoreMutation(snapshot, mutation); return snapshot; } },
    "@/lib/wms/weekly-vendor-queue": { transferWeeklyVendorQueue: () => { throw new Error("Unexpected weekly transfer"); } }
  };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("app/api/wms/vendor-orders/queue/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module, exports: module.exports, Error, require: name => { assert(deps[name], name); return deps[name]; } });
  const body = { action: "saveLineImage", lineId: patch.lineId, imageUrl: patch.imageUrl, expectedImageUrl: patch.expectedImageUrl };
  assert.equal((await module.exports.POST({ origin: false, json: async () => body })).status, 403);
  assert.equal(calls, 0);
  assert.equal((await module.exports.POST({ json: async () => ({ action: "typo" }) })).status, 409);
  assert.equal(calls, 0, "unknown action cannot accidentally consolidate pending orders");
  const response = await module.exports.POST({ json: async () => body });
  assert.equal(response.status, 200);
  assert.equal(response.body.line.shortageQuantity, 36);
  assert.equal(response.body.line.actualShortageQuantity, 7);
  assert.equal(response.body.line.imageUrl, patch.imageUrl);
  assert.equal((await module.exports.POST({ json: async () => body })).status, 200);
  console.log("Vendor image patch PASS: atomic image-only write, latest quantity/memo/shortage/receiving preserved, image conflicts, consumed/deleted/approved rejection, idempotent retry, unsaved UI edits retained, same-origin route.");
}
verifyRoute().catch(error => { console.error(error); process.exitCode = 1; });
