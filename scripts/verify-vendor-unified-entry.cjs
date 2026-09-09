const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (m, p) => m._compile(ts.transpileModule(fs.readFileSync(p, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, p);
const { consolidateVendorOrders } = require('../lib/wms/vendor-order/consolidate.ts');
const { emptyPickingWaveStoreSnapshot } = require('../lib/wms/picking-wave/shared-store-types.ts');
const { requestVendorJson } = require('../lib/wms/vendor-order/request-json.ts');

(async () => {
  const store = emptyPickingWaveStoreSnapshot();
  const now = '2026-09-09T00:00:00.000Z';
  function source(vendorName, skuId, waveId, extra = {}) {
    const draftId = `${waveId}::${vendorName}`;
    return { id: `${draftId}::${skuId}`, draftId, waveId, vendorName, skuId, modelName: 'model', productName: 'product', optionLabel: '', imageUrl: '', barcode: '', actualShortageQuantity: 2, shortageQuantity: 12, currentStock: '', relatedPurchaseOrderNumbers: [], memo: 'preserve', isManuallyAdded: true, createdAt: now, updatedAt: now, ...extra };
  }
  const a = source('A', '1001', 'legacy-a'), b = source('B', '1001', 'legacy-b');
  consolidateVendorOrders(store, 'first', [a, b], now);
  assert.equal(store.vendorOrderLines.length, 2);
  assert.equal(new Set(store.vendorOrderLines.map(line => line.id)).size, 2);
  const before = structuredClone(store.vendorOrderLines);
  consolidateVendorOrders(store, 'repeat', [a, b], now);
  assert.deepEqual(store.vendorOrderLines, before);
  consolidateVendorOrders(store, 'new-source', [source('C', '1002', 'weekly')], now);
  assert.equal(store.vendorOrderLines.length, 3);
  assert(before.every(line => JSON.stringify(store.vendorOrderLines.find(saved => saved.id === line.id)) === JSON.stringify(line)));

  const originalFetch = global.fetch;
  try {
    global.fetch = async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    await assert.rejects(requestVendorJson('/test', {}, 5), /연결이 지연/);
    global.fetch = async (_url, init) => ({ json: () => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('body aborted')), { once: true })) });
    await assert.rejects(requestVendorJson('/test', {}, 5), /연결이 지연/);
    global.fetch = async () => ({ ok: true, json: async () => ({ success: true }) });
    assert.equal((await requestVendorJson('/test', {}, 50)).data.success, true);
  } finally { global.fetch = originalFetch; }
  const manage = fs.readFileSync('app/wms/vendor-orders/manage/page.tsx', 'utf8');
  assert(!manage.includes('기존 발주대기 함께 취합'));
  assert(!manage.includes('웨이브 없이 새 거래처 발주서 만들기'));
  assert(fs.readFileSync('app/wms/vendor-orders/page.tsx', 'utf8').includes('redirect("/wms/vendor-orders/manage")'));
  assert(fs.readFileSync('app/wms/picking/waves/[waveId]/vendor-orders/page.tsx', 'utf8').includes('window.location.replace("/wms/vendor-orders/manage")'));
  console.log('PASS: common entry routes, no manual consolidation, cross-vendor same-SKU preservation, repeated transfer idempotency, new arrival preserves edits, request and response-body timeouts.');
})().catch(error => { console.error(error); process.exitCode = 1; });
