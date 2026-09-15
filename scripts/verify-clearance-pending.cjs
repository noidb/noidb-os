const fs = require('fs'), assert = require('node:assert/strict'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const { completedShortagePairs } = require('../lib/wms/weekly-completion-summary.ts');
const line = (purchaseOrderNumber, skuId) => ({ purchaseOrderNumber, skuId, shortageQuantity: 3 });
const completed = completedShortagePairs([
  { snapshot: { period: { startDate: '2025-01-01', endDate: '2025-01-02' } }, reorderRequestedAt: '2025-01-03', reorderRequestedLines: [line('OLD-PO', 'SKU')] },
  { reorderRequestedLines: [line('PENDING-PO', 'SKU')] },
  { reorderQueuePartialRequestedAt: '2026-09-15', reorderRequestedLines: [line('PARTIAL-PO', 'OTHER')] },
]);
assert.deepEqual(new Set(completed), new Set([JSON.stringify(['OLD-PO', 'SKU']), JSON.stringify(['PARTIAL-PO', 'OTHER'])]));
assert(!completed.includes(JSON.stringify(['PENDING-PO', 'SKU'])));
assert(!completed.includes(JSON.stringify(['OTHER-PO', 'SKU'])));
const page = fs.readFileSync('app/wms/vendor-orders/page.tsx', 'utf8');
const { historicalShortageEvidence } = require('../lib/wms/historical-shortage-clearance.ts');
const evidence = historicalShortageEvidence({ runs: [] }, { vendorOrderDrafts: [], vendorOrderLines: [
  { skuId: 'A', relatedPurchaseOrderNumbers: ['100', '101'], receivingCompletedAt: 'done', receivedQuantity: 3, shortageQuantity: 3 },
  { skuId: 'B', relatedPurchaseOrderNumbers: ['102'], receivingCompletedAt: 'done', receivedQuantity: 1, shortageQuantity: 3 },
  { skuId: 'C', relatedPurchaseOrderNumbers: ['103'], sentResolution: { kind: 'discontinue' } },
] });
assert.equal(evidence.filter(item => item.status === 'already_resolved').length, 2);
assert(!evidence.some(item => item.skuId === 'B'));
assert(evidence.some(item => item.skuId === 'C' && item.status === 'discontinued'));
assert.match(page, /WeeklyWork clearanceMode/);
assert.match(page, /ActualInboundShortage pendingOnly/);
for (const route of ['/wms/vendor-orders/status-requests', '/wms/vendor-orders/manage', '/wms/inbound/reorder', '/wms/vendor-orders/receiving']) assert(page.includes(route));
console.log('PASS date-independent explicit completion, partial completion, same-SKU different-PO isolation, pending screen and four routes');
