const assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const { emptyPickingWaveStoreSnapshot } = require('../lib/wms/picking-wave/shared-store-types.ts');
const { transferSentVendorLine, targetVendorVersion } = require('../lib/wms/vendor-order/sent-vendor-transfer.ts');
const { vendorLineClassification } = require('../lib/wms/vendor-order/receiving-state.ts');
const { orderVendorDrafts } = require('../lib/wms/vendor-order/order-list.ts');
const now = '2026-09-20T01:00:00.000Z', later = '2026-09-20T02:00:00.000Z';
function fixture(targetStatus) {
  const store = emptyPickingWaveStoreSnapshot(); store.activeVendorQueueId = 'VENDOR-QUEUE-test';
  const draft = { id: 'draft-A', waveId: store.activeVendorQueueId, vendorName: '거래처A', status: 'sent', createdAt: now, updatedAt: now, sentAt: now };
  const detail = { lineKey: 'shipment-A::box::100::200', shipmentNumber: 'shipment-A', boxId: 'box', purchaseOrderNumber: '100', skuId: '200', deliveredQuantity: 3, receivedQuantity: 1, shortageQuantity: 2 };
  const line = { id: 'line-A', draftId: draft.id, waveId: draft.waveId, vendorName: draft.vendorName, skuId: '200', modelName: '', category: '', optionLabel: '', productName: '테스트 상품', imageUrl: '', barcode: '', actualShortageQuantity: 2, shortageQuantity: 12, currentStock: '', relatedPurchaseOrderNumbers: ['100'], memo: '보존', isManuallyAdded: true, sourceType: 'actual-inbound-shortage', shipmentReceiptDetails: [detail], actualInboundDetails: [{ purchaseOrderNumber: '100', confirmedQuantity: 3, receivedQuantity: 1, shortageQuantity: 2 }], createdAt: now, updatedAt: now };
  store.vendorOrderDrafts = [draft]; store.vendorOrderLines = [line];
  if (targetStatus) store.vendorOrderDrafts.push({ ...draft, id: 'draft-B', vendorName: '거래처B', status: targetStatus, sentAt: targetStatus === 'sent' ? now : undefined });
  return store;
}
function move(store, operationId = 'move-1') { return transferSentVendorLine(store, { lineId: 'line-A', vendorName: '거래처B', operationId, now: later, expectedUpdatedAt: now, expectedQueueId: store.activeVendorQueueId, expectedTargetVersion: targetVendorVersion(store, '거래처B') }); }
for (const targetStatus of [undefined, 'draft', 'approved', 'sent']) {
  const store = fixture(targetStatus), before = structuredClone(store);
  const result = move(store), source = result.vendorOrderLines.find(l => l.id === 'line-A'), target = result.vendorOrderLines.find(l => l.id !== 'line-A');
  assert.equal(JSON.stringify(store), JSON.stringify(before), 'pure transfer preserves input');
  assert.deepEqual(target.shipmentReceiptDetails, before.vendorOrderLines[0].shipmentReceiptDetails);
  assert.deepEqual(target.actualInboundDetails, before.vendorOrderLines[0].actualInboundDetails);
  assert.equal(target.shortageQuantity, 12); assert.equal(source.shortageQuantity, 12);
  assert.equal(vendorLineClassification(source), 'resolved'); assert.equal(vendorLineClassification(target), 'pending');
  assert.equal(result.vendorOrderDrafts.find(d => d.id === 'draft-A').status, 'sent');
  assert.equal(move(result), result, 'retry does not append a line');
  if (targetStatus === 'draft' || targetStatus === 'approved') assert.equal(target.draftId, 'draft-B');
  if (targetStatus === 'approved') assert.equal(result.vendorOrderDrafts.find(d => d.id === 'draft-B').status, 'resend_needed');
  if (targetStatus === 'sent') {
    assert.notEqual(target.draftId, 'draft-B');
    assert.equal(result.vendorOrderDrafts.find(d => d.id === 'draft-B').sentAt, now);
    const targetEntries = result.vendorOrderDrafts.filter(d => d.vendorName === '거래처B').map(d => ({ id: d.id, vendorName: d.vendorName, draft: d }));
    assert.deepEqual(orderVendorDrafts(targetEntries).map(d => d.label), ['거래처B', '거래처B-1']);
    assert.deepEqual(orderVendorDrafts(targetEntries.filter(entry => entry.draft.status !== 'sent'), targetEntries).map(d => d.label), ['거래처B-1']);
    const otherQueueHistory = { id: 'draft-history', vendorName: '거래처B', draft: { ...targetEntries[0].draft, id: 'draft-history', waveId: 'VENDOR-QUEUE-history', createdAt: '2026-09-19T01:00:00.000Z', updatedAt: '2026-09-19T01:00:00.000Z', sentAt: '2026-09-19T01:00:00.000Z' } };
    assert.deepEqual(orderVendorDrafts([otherQueueHistory, targetEntries[1]], [otherQueueHistory, ...targetEntries]).map(d => d.label), ['거래처B', '거래처B-2']);
  }
}
const store = fixture('draft');
const destination = { ...structuredClone(store.vendorOrderLines[0]), id: 'line-B', draftId: 'draft-B', vendorName: '거래처B', memo: '수정한 메모', shortageQuantity: 24,
  shipmentReceiptDetails: [{ ...store.vendorOrderLines[0].shipmentReceiptDetails[0], lineKey: 'shipment-B::box::100::200', shipmentNumber: 'shipment-B', deliveredQuantity: 4, shortageQuantity: 3 }] };
store.vendorOrderLines.push(destination);
const result = move(store), target = result.vendorOrderLines.find(l => l.id === 'line-B');
assert.equal(result.vendorOrderLines.length, 2); assert.equal(target.shortageQuantity, 36); assert.equal(target.actualShortageQuantity, 5);
assert.equal(target.actualInboundDetails[0].shortageQuantity, 5); assert.equal(target.shipmentReceiptDetails.length, 2); assert.equal(target.memo, '수정한 메모');
assert.equal(result.vendorOrderLines[0].vendorTransfer.targetLineId, 'line-B');
destination.shipmentReceiptDetails = structuredClone(store.vendorOrderLines[0].shipmentReceiptDetails);
assert.throws(() => move(store), /중복 수량/);
console.log('PASS: sent source history, shipment/PO lineage, draft reuse, approved draft re-review, sent-only suffix, same SKU distinct shipment merge, overlap block, idempotent retry. External writes: 0.');
