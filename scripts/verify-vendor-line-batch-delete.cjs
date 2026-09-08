const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { emptyPickingWaveStoreSnapshot, isPickingWaveStoreMutation } = require("../lib/wms/picking-wave/shared-store-types.ts");
const { applyPickingWaveStoreMutation } = require("../lib/wms/picking-wave/server-store.ts");
const { getVendorLineDeletionBlockReason, VendorLineBatchDeleteConflictError } = require("../lib/wms/vendor-order/delete-lines.ts");
const { VendorOrderWriteConflictError } = require("../lib/wms/vendor-order/queue-write-guard.ts");
const { consolidateVendorOrders } = require("../lib/wms/vendor-order/consolidate.ts");
const before = "2026-09-08T10:00:00.000Z", deletedAt = "2026-09-08T11:00:00.000Z", queueId = "VENDOR-QUEUE-delete-test";
function fixture() {
  const snapshot = emptyPickingWaveStoreSnapshot();
  snapshot.activeVendorQueueId = queueId;
  snapshot.vendorOrderDrafts = ["창성", "다른거래처"].map(vendorName => ({ id: queueId + "::" + vendorName, waveId: queueId, vendorName, status: "draft", createdAt: before, updatedAt: before }));
  snapshot.vendorOrderLines = ["78483551", "78483550", "90000001"].map((skuId, index) => ({ id: queueId + "::" + skuId, draftId: snapshot.vendorOrderDrafts[index === 2 ? 1 : 0].id,
    waveId: queueId, vendorName: index === 2 ? "다른거래처" : "창성", skuId, productName: "상품 " + skuId, category: "반지", modelName: "모델", optionLabel: "옵션",
    barcode: "R" + skuId, imageUrl: "https://example.test/" + skuId + ".png", shortageQuantity: 24, actualShortageQuantity: 3, memo: "보존할 메모", currentStock: "0",
    relatedPurchaseOrderNumbers: ["PO" + index], isManuallyAdded: true, createdAt: before, updatedAt: before }));
  snapshot.vendorQueueConsumedLineIds = { "original::78483551": queueId, "original::78483550": queueId };
  snapshot.vendorQueueReceipts = { original: { queueId, at: before, added: 2, duplicates: 0, sourceLines: structuredClone(snapshot.vendorOrderLines.slice(0, 2)) } };
  return snapshot;
}
function mutation(snapshot) {
  const lines = snapshot.vendorOrderLines.slice(0, 2);
  return { action: "deleteVendorLines", waveId: queueId, lineIds: lines.map(line => line.id), expectedUpdatedAtByLineId: Object.fromEntries(lines.map(line => [line.id, line.updatedAt])), deletedAt };
}
function unchangedOnReject(snapshot, request, pattern) {
  const original = structuredClone(snapshot);
  assert.throws(() => applyPickingWaveStoreMutation(snapshot, request), pattern || VendorLineBatchDeleteConflictError);
  assert.deepEqual(snapshot, original, "the whole original snapshot survives a rejected selection");
}

const initial = fixture(), request = mutation(initial), original = structuredClone(initial);
assert.equal(isPickingWaveStoreMutation(request), true);
const deleted = applyPickingWaveStoreMutation(initial, request);
assert.deepEqual(initial, original, "input is immutable");
assert.deepEqual(deleted.vendorOrderLines, initial.vendorOrderLines.slice(2), "only the two selected IDs disappear");
assert.deepEqual(deleted.vendorOrderDrafts, initial.vendorOrderDrafts);
assert.deepEqual(deleted.vendorQueueConsumedLineIds, initial.vendorQueueConsumedLineIds);
assert.deepEqual(deleted.vendorQueueReceipts, initial.vendorQueueReceipts);
for (const id of request.lineIds) assert.equal(deleted.deletedVendorLineIds[id], deletedAt);
assert.equal(applyPickingWaveStoreMutation(deleted, request), deleted, "lost-response retry is idempotent");
assert.equal(isPickingWaveStoreMutation({ ...request, lineIds: [] }), false);
assert.equal(isPickingWaveStoreMutation({ ...request, lineIds: [request.lineIds[0], request.lineIds[0]] }), false);
assert.equal(isPickingWaveStoreMutation({ ...request, expectedUpdatedAtByLineId: {} }), false);
assert.equal(isPickingWaveStoreMutation({ ...request, deletedAt: "invalid" }), false);
unchangedOnReject(initial, { ...request, lineIds: [request.lineIds[0], "unknown"] }, /削|삭제|이동/);
unchangedOnReject(initial, { ...request, waveId: "OTHER-WAVE" }, /경로/);
unchangedOnReject(initial, { ...request, expectedUpdatedAtByLineId: { ...request.expectedUpdatedAtByLineId, [request.lineIds[1]]: "stale" } }, /변경/);
for (const status of ["approved", "sent"]) {
  const locked = fixture(); locked.vendorOrderDrafts[0].status = status;
  unchangedOnReject(locked, mutation(locked), /승인·전송/);
  assert.match(getVendorLineDeletionBlockReason(locked.vendorOrderLines[0], locked.vendorOrderDrafts[0]), /승인·전송/);
}
for (const status of ["draft", "review", "resend_needed"]) {
  const editable = fixture(); editable.vendorOrderDrafts[0].status = status;
  assert.equal(applyPickingWaveStoreMutation(editable, mutation(editable)).vendorOrderLines.length, 1);
}
for (const history of [
  { receivedQuantity: 1 }, { receivedUnitPrice: 1200 }, { receivedVat: 120 }, { receivedCostVatIncluded: 1320 },
  { receivedCostAppliedAt: before }, { receivedUsedImmediatelyAt: before }, { receivingHistory: [{ savedAt: before, record: {} }] },
]) {
  const locked = fixture(); Object.assign(locked.vendorOrderLines[1], history);
  unchangedOnReject(locked, mutation(locked), /입고·원가/);
  assert.match(getVendorLineDeletionBlockReason(locked.vendorOrderLines[1], locked.vendorOrderDrafts[0]), /입고·원가/);
}
const zero = fixture(); Object.assign(zero.vendorOrderLines[0], { receivedQuantity: 0, receivedUnitPrice: 0, receivedVat: 0, receivedCostVatIncluded: 0, receivingHistory: [] });
assert.equal(applyPickingWaveStoreMutation(zero, mutation(zero)).vendorOrderLines.length, 1, "empty default receiving fields do not block an untouched draft");
const moved = fixture(); moved.vendorQueueConsumedLineIds[moved.vendorOrderLines[1].id] = "NEW-QUEUE";
unchangedOnReject(moved, mutation(moved), /경로/);
const removedDraft = fixture(); removedDraft.deletedVendorDraftIds[removedDraft.vendorOrderDrafts[0].id] = deletedAt;
unchangedOnReject(removedDraft, mutation(removedDraft), /경로/);
const changed = fixture(), staleRequest = mutation(changed); changed.vendorOrderLines[1].updatedAt = deletedAt;
unchangedOnReject(changed, staleRequest, /변경/);

unchangedOnReject(deleted, { action: "saveVendorLine", line: initial.vendorOrderLines[0] }, /이미 삭제/, "ordinary stale saves cannot revive a deleted queue row");
const draftBeforeDelete = initial.vendorOrderDrafts[0];
const draftLinesBeforeDelete = initial.vendorOrderLines.filter(line => line.draftId === draftBeforeDelete.id);
const deletedDraft = applyPickingWaveStoreMutation(initial, { action: "deleteVendorDraft", draftId: draftBeforeDelete.id, deletedAt });
const restoreRequest = { action: "restoreVendorDraft", draft: draftBeforeDelete, lines: draftLinesBeforeDelete };
assert.equal(isPickingWaveStoreMutation(restoreRequest), true);
const restored = applyPickingWaveStoreMutation(deletedDraft, restoreRequest);
assert.deepEqual(restored.vendorOrderDrafts.find(draft => draft.id === draftBeforeDelete.id), draftBeforeDelete, "explicit undo restores the exact original draft");
assert.deepEqual(restored.vendorOrderLines.filter(line => line.draftId === draftBeforeDelete.id), draftLinesBeforeDelete, "explicit undo restores every original quantity, memo and receipt");
assert.equal(restored.deletedVendorDraftIds[draftBeforeDelete.id], undefined);
for (const line of draftLinesBeforeDelete) assert.equal(restored.deletedVendorLineIds[line.id], undefined);
assert.deepEqual(deletedDraft.vendorOrderLines, initial.vendorOrderLines.slice(2), "restore does not mutate its input");
unchangedOnReject(restored, restoreRequest, /이미 복원|변경/);
const changedRestore = structuredClone(deletedDraft); changedRestore.deletedVendorLineIds[draftLinesBeforeDelete[1].id] = "2026-09-08T12:00:00Z";
unchangedOnReject(changedRestore, restoreRequest, /변경|이동/);
const occupiedRestore = structuredClone(deletedDraft); occupiedRestore.vendorOrderLines.push({ ...draftLinesBeforeDelete[1], draftId: "other", waveId: "other" });
unchangedOnReject(occupiedRestore, restoreRequest, /변경|이동/);
const outsideRestore = { ...restoreRequest, lines: [...draftLinesBeforeDelete, initial.vendorOrderLines[2]] };
assert.equal(isPickingWaveStoreMutation(outsideRestore), false, "restore cannot include another draft's row");
unchangedOnReject(deletedDraft, outsideRestore, /다시 확인/);
assert.equal(isPickingWaveStoreMutation({ ...restoreRequest, lines: [draftLinesBeforeDelete[0], draftLinesBeforeDelete[0]] }), false);
const legacyLine = { ...initial.vendorOrderLines[0], id: "legacy-line", waveId: "legacy", draftId: "legacy-draft" };
const legacyDeleted = emptyPickingWaveStoreSnapshot(); legacyDeleted.deletedVendorLineIds[legacyLine.id] = deletedAt;
assert.deepEqual(applyPickingWaveStoreMutation(legacyDeleted, { action: "saveVendorLine", line: legacyLine }).vendorOrderLines[0], legacyLine, "legacy non-queue explicit restoration remains compatible");
const consolidated = structuredClone(deleted);
consolidateVendorOrders(consolidated, "after-delete", initial.vendorOrderLines.slice(0, 2).map(line => ({ ...line, id: "original::" + line.skuId })), "2026-09-08T12:00:00Z");
assert.equal(consolidated.vendorOrderLines.some(line => ["78483551", "78483550"].includes(line.skuId)), false, "reconsolidating consumed source IDs does not revive deleted queue rows");
consolidateVendorOrders(consolidated, "new-demand", [{ ...initial.vendorOrderLines[0], id: "new-demand::78483551" }], "2026-09-08T12:01:00Z");
assert.equal(consolidated.vendorOrderLines.some(line => line.skuId === "78483551"), false, "background demand cannot revive a SKU the user explicitly deleted");
const manual = { ...initial.vendorOrderLines[0], id: queueId + "::manual-78483551", isManuallyAdded: true, updatedAt: "2026-09-08T12:02:00Z" };
const manuallyAdded = applyPickingWaveStoreMutation(consolidated, { action: "saveVendorWorkspace", operationId: "manual-restore", waveId: queueId, lines: [manual], drafts: [], removedLineIds: [], expectedUpdatedAtByLineId: { [manual.id]: null }, expectedUpdatedAtByDraftId: {}, expectedLineIdsByDraftId: {}, now: manual.updatedAt });
assert.equal(manuallyAdded.vendorOrderLines.some(line => line.skuId === "78483551"), true, "an explicit product or unpaid-order add restores the SKU");
assert.equal(manuallyAdded.suppressedVendorSkuIds["78483551"], undefined);
console.log("PASS atomic deletion: exact selection, immutable input, received/cost history and approved/sent locks, stale/missing/moved guards, idempotent retry, original provenance, explicit restore, background suppression and explicit re-add.");

async function verifyRoute() {
  let snapshot = fixture(); const module = { exports: {} };
  const dependencies = {
    "next/server": { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } },
    "@/lib/wms/vendor-order/delete-lines": { VendorLineBatchDeleteConflictError },
    "@/lib/wms/vendor-order/queue-write-guard": { VendorOrderWriteConflictError },
    "@/lib/wms/picking-wave/shared-store-types": { isPickingWaveStoreMutation },
    "@/lib/wms/picking-wave/server-store": { readPickingWaveStore: async () => snapshot, PickingWaveStoreBusyError: class extends Error {}, mutatePickingWaveStore: async input => { snapshot = applyPickingWaveStoreMutation(snapshot, input); return snapshot; } },
  };
  const source = ts.transpileModule(fs.readFileSync("app/api/wms/picking-waves/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, Error, console, require: name => { assert(dependencies[name], name); return dependencies[name]; } });
  const payload = mutation(snapshot); snapshot.vendorOrderLines[1].receivedQuantity = 1;
  const failed = await module.exports.POST({ json: async () => payload });
  assert.equal(failed.status, 409); assert.match(failed.body.error, /입고·원가/); assert.equal(snapshot.vendorOrderLines.length, 3);
  delete snapshot.vendorOrderLines[1].receivedQuantity;
  const saved = await module.exports.POST({ json: async () => payload });
  assert.equal(saved.status, 200); assert.equal(saved.body.snapshot.vendorOrderLines.length, 1);
  assert.equal((await module.exports.POST({ json: async () => ({ ...payload, lineIds: [] }) })).status, 400);
  const undoDeleted = applyPickingWaveStoreMutation(fixture(), { action: "deleteVendorDraft", draftId: draftBeforeDelete.id, deletedAt });
  snapshot = undoDeleted;
  assert.equal((await module.exports.POST({ json: async () => restoreRequest })).status, 200);
  assert.equal((await module.exports.POST({ json: async () => restoreRequest })).status, 409);
  console.log("PASS HTTP contract: invalid request 400, protected history 409 with specific reason, successful batch 200.");
}
verifyRoute().catch(error => { console.error(error); process.exitCode = 1; });
