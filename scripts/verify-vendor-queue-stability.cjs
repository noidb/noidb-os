const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { consolidateVendorOrders } = require("../lib/wms/vendor-order/consolidate.ts");
const { emptyPickingWaveStoreSnapshot } = require("../lib/wms/picking-wave/shared-store-types.ts");
const now = "2026-09-08T06:00:00.000Z";
const later = "2026-09-08T07:00:00.000Z";
const latest = "2026-09-08T08:00:00.000Z";
function source(skuId, waveId = "weekly-first", extra = {}) {
  const vendorName = "등록 거래처";
  const draftId = waveId + "::" + vendorName;
  return { id: draftId + "::" + skuId, draftId, waveId, vendorName, skuId, modelName: "MODEL", category: "반지", optionLabel: "실버, 14호", productName: "확정 상품", imageUrl: "", barcode: "BAR" + skuId, actualShortageQuantity: 2, shortageQuantity: 12, currentStock: "", relatedPurchaseOrderNumbers: ["100"], memo: "", isManuallyAdded: false, createdAt: now, updatedAt: now, ...extra };
}
function addSaved(store, line, status = "draft") {
  store.vendorOrderLines.push(line);
  if (!store.vendorOrderDrafts.some(draft => draft.id === line.draftId)) store.vendorOrderDrafts.push({ id: line.draftId, waveId: line.waveId, vendorName: line.vendorName, status, createdAt: line.createdAt, updatedAt: line.updatedAt });
}
const store = emptyPickingWaveStoreSnapshot();
const original = source("101");
consolidateVendorOrders(store, "initial", [original], now);
const queueId = store.activeVendorQueueId;
let current = store.vendorOrderLines[0];
Object.assign(current, { shortageQuantity: 48, memo: "사용자가 승인 전에 수정한 메모", imageUrl: "https://example.test/user-photo.jpg", updatedAt: later });
const approved = store.vendorOrderDrafts.find(draft => draft.id === current.draftId);
Object.assign(approved, { status: "approved", approvedAt: later, updatedAt: later });
const approvedBefore = structuredClone(approved);
const currentBefore = structuredClone(current);
consolidateVendorOrders(store, "reopen-after-approval", [], latest);
assert.equal(store.activeVendorQueueId, queueId, "approval does not create a different queue URL");
assert.deepEqual(store.vendorOrderLines[0], currentBefore, "a read-like consolidation preserves timestamp and all edits");
assert.deepEqual(store.vendorOrderDrafts.find(draft => draft.id === approved.id), approvedBefore, "unchanged approval remains valid");

// An older raw source still present in another workspace cannot override the user's active queue.
const stale = source("101", "legacy-tab", { shortageQuantity: 12, vendorName: "수정 전 거래처", memo: "오래된 메모", imageUrl: "https://example.test/stale.jpg", createdAt: "2026-08-01T00:00:00.000Z" });
addSaved(store, stale);
consolidateVendorOrders(store, "old-tab-reconsolidation", [], latest);
current = store.vendorOrderLines.find(line => line.waveId === queueId && line.skuId === "101");
assert.deepEqual(current, currentBefore);
assert.equal(store.vendorOrderDrafts.find(draft => draft.id === approved.id).status, "approved");
assert.equal(store.vendorQueueConsumedLineIds[stale.id], queueId);

// New actual demand expands the same queue and requires review of the affected approved vendor.
consolidateVendorOrders(store, "new-weekly-demand", [source("102", "weekly-second")], latest);
assert.equal(store.activeVendorQueueId, queueId);
const changedDraft = store.vendorOrderDrafts.find(draft => draft.id === approved.id);
assert.equal(changedDraft.status, "resend_needed");
assert.equal(changedDraft.approvedAt, later, "prior approval evidence remains available");
assert.equal(changedDraft.updatedAt, latest);
assert.deepEqual(store.vendorOrderLines.find(line => line.skuId === "101"), currentBefore);
assert.equal(store.vendorOrderLines.filter(line => line.waveId === queueId).length, 2);

// Sent history alone requires a new batch; the current unsent edits still win over earlier sources.
const sentLine = source("999", queueId, { id: queueId + "::999", draftId: queueId + "::이미 전송한 거래처", vendorName: "이미 전송한 거래처", receivedQuantity: 3, memo: "발송 원본 보존" });
addSaved(store, sentLine, "sent");
const sentBefore = structuredClone(sentLine);
const oldSource = source("101", "another-legacy", { shortageQuantity: 12, memo: "되살아나면 안 되는 메모", createdAt: "2026-07-01T00:00:00.000Z" });
addSaved(store, oldSource);
consolidateVendorOrders(store, "after-actual-send", [], latest);
assert.notEqual(store.activeVendorQueueId, queueId);
assert.deepEqual(store.vendorOrderLines.find(line => line.id === sentLine.id), sentBefore, "sent and received source is immutable");
const moved = store.vendorOrderLines.find(line => line.waveId === store.activeVendorQueueId && line.skuId === "101");
assert.equal(moved.shortageQuantity, currentBefore.shortageQuantity);
assert.equal(moved.memo, currentBefore.memo);
assert.equal(moved.imageUrl, currentBefore.imageUrl);
assert.equal(moved.vendorName, currentBefore.vendorName);
assert.equal(store.vendorQueueConsumedLineIds[currentBefore.id], store.activeVendorQueueId);
const receipt = store.vendorQueueReceipts["after-actual-send"];
assert(receipt.sourceLines.some(line => line.id === oldSource.id));
assert(receipt.sourceLines.some(line => line.id === currentBefore.id && line.memo === currentBefore.memo));

// Excluded originals remain immutable and cannot force a different queue when a fresh demand arrives.
const excludedQueue = emptyPickingWaveStoreSnapshot();
consolidateVendorOrders(excludedQueue, "exclude-start", [source("201")], now);
const excludedId = excludedQueue.activeVendorQueueId;
const excludedLine = excludedQueue.vendorOrderLines[0];
excludedLine.orderExclusion = { reason: "weekly_completed", completedAt: later, evidenceIds: ["weekly-done"] };
const excludedBefore = structuredClone(excludedLine);
consolidateVendorOrders(excludedQueue, "new-independent-demand", [source("201", "brand-new")], latest);
assert.equal(excludedQueue.activeVendorQueueId, excludedId);
assert.deepEqual(excludedQueue.vendorOrderLines.find(line => line.id === excludedBefore.id), excludedBefore);
const fresh = excludedQueue.vendorOrderLines.find(line => !line.orderExclusion);
assert(fresh.id.includes("::new-"));
assert.notEqual(fresh.id, excludedBefore.id);
consolidateVendorOrders(excludedQueue, "repeat-new-demand", [], latest);
assert.equal(excludedQueue.vendorOrderLines.find(line => !line.orderExclusion).id, fresh.id);
assert.equal(excludedQueue.vendorQueueConsumedLineIds[fresh.id], undefined);
console.log("PASS: approved and resend queues keep one URL; unchanged rows keep revision timestamps; current edits outrank old tabs; added demand requires approval; sent history stays immutable; exclusions keep distinct fresh demand IDs.");
