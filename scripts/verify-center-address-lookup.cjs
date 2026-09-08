const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const JSZip = require('jszip');
const { SaxesParser } = require('saxes');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { safelyMatchesAddress, verifyAddressCandidates, addressLedgerKey, normalizeAddress } = require('../lib/wms/center-address/address-normalize.ts');
const oldAddress = '광주광역시 광산구 연산동 1250';
const newAddress = '전남광주통합특별시 광산구 연산동 1250';
const roadAddress = '전남광주통합특별시 광산구 평동산단7번로 16-8';
assert.equal(safelyMatchesAddress(oldAddress, newAddress), true);
assert.equal(safelyMatchesAddress(newAddress, oldAddress), true);
assert.equal(safelyMatchesAddress(oldAddress, newAddress.replace('1250', '1251')), false);
assert.equal(safelyMatchesAddress(oldAddress, newAddress.replace('광산구', '남구')), false);
assert.equal(safelyMatchesAddress(oldAddress, '전라남도 화순군 연산동 1250'), false);
assert.equal(safelyMatchesAddress(oldAddress, '전남광주통합특별시 화순군 연산동 1250'), false);
assert.equal(safelyMatchesAddress(oldAddress, '경기도 광주시 연산동 1250'), false);
assert.equal(safelyMatchesAddress('광주광역시 광산구 평동산단7번로 16-8', roadAddress), true);
assert.equal(safelyMatchesAddress('광주광역시 광산구 평동산단7번로 16-8', roadAddress.replace('16-8', '16-9')), false);
assert.equal(safelyMatchesAddress('서울특별시 강남구 강남대로 55', '서울특별시 서초구 강남대로 55'), false, 'A shared province does not validate a different district');
assert.equal(safelyMatchesAddress('경기도 고양시 일산동구 중앙로 55', '경기도 고양시 일산서구 중앙로 55'), false);
assert.equal(safelyMatchesAddress('알수없는시 광산구 연산동 1250', '알수없는시 광산구 연산동 1250'), false);
const candidate = { postalCode: '62466', roadAddress, jibunAddress: newAddress, source: 'kakao-postcode' };
assert.equal(verifyAddressCandidates(oldAddress, [candidate]).approved, true);
assert.equal(verifyAddressCandidates(oldAddress, [candidate, { ...candidate, postalCode: '99999' }]).approved, false, 'Conflicting postal codes remain unapproved');
require('./verify-center-address-rules.ts');

const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf(name); return i < 0 ? '' : args[i + 1]; };
const sourcePath = arg('--source-documents');
const responsePath = arg('--search-response');
const outputPath = arg('--output');
const publicHtml = responsePath ? fs.readFileSync(responsePath, 'utf8') : '<li class="list_post_item " data-addr_type="J" data-zonecode="62466" data-addr="' + newAddress + '"><span data-addr_type="R" data-addr="' + roadAddress + '"></span><span data-addr="' + newAddress + '"></span></li>';
const docs = sourcePath ? JSON.parse(fs.readFileSync(sourcePath, 'utf8')) : [{
  purchaseOrderNumber: 'POSTAL-FIXTURE', sourceContainerFile: 'fixture.zip', sourceEntryFile: 'fixture.xlsx', sourceSheet: '상품목록', sourceRow: 1,
  fulfillmentCenterName: '전라광주4', expectedArrivalDate: '2026-09-11', recipientName: '', phone: '07000000000', postalCode: '', address: oldAddress,
  records: [{ purchaseOrderNumber: 'POSTAL-FIXTURE', sourceRow: 2, fulfillmentCenterName: '전라광주4', expectedArrivalDate: '2026-09-11', skuId: 'POSTAL-SKU', barcode: 'POSTAL-BAR', productName: '검증 상품', optionName: '', orderedQuantity: 3, address: oldAddress, phone: '07000000000', postalCode: '' }],
}];
const index = { byPurchaseOrderNumber: new Map(docs.map(doc => [doc.purchaseOrderNumber, doc])), duplicateFiles: [], identicalDuplicates: [], conflicts: [], parseErrors: [], sourceContainerCount: 1, sourceEntryCount: docs.length };
const ledgerStore = require('../lib/wms/center-address/ledger-store.ts');
const cachedPath = arg('--cached-resolutions');
const cached = cachedPath ? JSON.parse(fs.readFileSync(cachedPath, 'utf8')).filter(row => row.status === 'approved') : [];
let memoryLedger = { schemaVersion: 1, updatedAt: '', entries: cached.map(row => ({
  key: addressLedgerKey(row.fulfillmentCenterName, row.sourceAddress), fulfillmentCenterName: row.fulfillmentCenterName, sourceAddress: row.sourceAddress,
  normalizedSourceAddress: normalizeAddress(row.sourceAddress), postalCode: row.postalCode, matchedAddress: row.matchedAddress,
  verificationSource: row.source === 'center-address-ledger' ? 'kakao-postcode' : row.source, verifiedAt: '2026-09-08T00:00:00Z', updatedAt: '2026-09-08T00:00:00Z',
})) };
let memorySaves = 0;
ledgerStore.loadCenterAddressLedger = async () => structuredClone(memoryLedger);
ledgerStore.saveCenterAddressLedgerEntries = async entries => {
  memorySaves += entries.length;
  const merged = new Map(memoryLedger.entries.map(row => [row.key, row]));
  entries.forEach(row => merged.set(row.key, row));
  memoryLedger = { ...memoryLedger, entries: [...merged.values()] };
};
const sourceIndex = require('../lib/wms/purchase-order-source/index.ts');
sourceIndex.buildPurchaseOrderIndex = async () => index;
let fetches = 0;
// Both services and all ledger writes are mocked. An accidental unrelated network call fails the test.
delete process.env.JUSO_API_CONFM_KEY;
global.fetch = async (url, init) => {
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://postcode.map.daum.net');
  assert.equal(parsed.pathname, '/search');
  assert.equal(parsed.searchParams.get('region_name'), oldAddress, 'Only the base public address is queried');
  assert.ok(!init?.method || init.method === 'GET');
  fetches++;
  return new Response(publicHtml, { status: 200 });
};
const { searchAndVerifyPostalCode } = require('../lib/wms/center-address/address-search.ts');
const { buildShipmentOutputContext } = require('../lib/wms/shipment-output-context.ts');
const { buildHanjinUploadFile } = require('../lib/wms/hanjin-upload.ts');
function sheetRows(xml) {
  const rows = []; const parser = new SaxesParser(); let cells = null, ref = '', value = '', inValue = false;
  parser.on('opentag', node => {
    if (node.name === 'x:row') cells = {};
    if (node.name === 'x:c') { ref = node.attributes.r; value = ''; }
    if (node.name === 'x:v') { inValue = true; value = ''; }
  });
  parser.on('text', text => { if (inValue) value += text; });
  parser.on('closetag', node => {
    if (node.name === 'x:v') { inValue = false; if (cells) cells[ref.replace(/\d+$/, '')] = value; }
    if (node.name === 'x:row') { rows.push(cells); cells = null; }
  });
  parser.write(xml).close(); return rows;
}
(async () => {
  const verified = await searchAndVerifyPostalCode(oldAddress);
  assert.equal(verified.approved, true, 'The actual postcode HTML parser accepts the renamed district');
  assert.equal(verified.candidate.postalCode, '62466');
  assert.equal(verified.candidate.jibunAddress, newAddress);
  const context = await buildShipmentOutputContext(docs.map(doc => doc.purchaseOrderNumber));
  assert.equal(context.preview.canGenerate, true, context.preview.blockingReasons.join(', '));
  assert.deepEqual(context.preview.missingPostalCodeCenters, []);
  assert.equal(context.groups.find(group => group.fulfillmentCenterName === '전라광주4').postalCode, '62466');
  assert.equal(memorySaves, 1, 'One verified new address is persisted only to the in-memory mock');
  const searchesBeforeGenerate = fetches;
  const generated = await buildHanjinUploadFile(docs.map(doc => doc.purchaseOrderNumber));
  assert.equal(fetches, searchesBeforeGenerate, 'The generated workbook reuses the verified address cache');
  const zip = await JSZip.loadAsync(generated.buffer);
  const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
  const rows = sheetRows(xml).slice(1);
  assert.equal(rows.length, context.preview.expectedInvoiceRowCount);
  assert.equal(rows.filter(row => row.AB === '로켓배송*전라광주4').length, 1);
  assert.equal(rows.find(row => row.AB === '로켓배송*전라광주4').AD, '62466', 'Actual Hanjin workbook column AD contains the verified postal code');
  assert.deepEqual([...generated.addedPurchaseOrderNumbers].sort(), docs.map(doc => doc.purchaseOrderNumber).sort());
  if (sourcePath) {
    assert.equal(context.preview.requestedPurchaseOrderCount, 10);
    assert.equal(context.preview.expectedInvoiceRowCount, 9);
    assert.equal(context.preview.totalOrderedQuantity, 152);
    assert.ok(rows.find(row => row.AB === '로켓배송*전라광주4').K.includes('141581404'));
  }
  if (outputPath) { fs.mkdirSync(path.dirname(outputPath), { recursive: true }); fs.writeFileSync(outputPath, generated.buffer); }
  console.log(JSON.stringify({ result: 'PASS', requestedPOs: context.preview.requestedPurchaseOrderCount, invoiceRows: rows.length, quantity: context.preview.totalOrderedQuantity, postalCode: '62466', memoryOnlyNewAddresses: memorySaves, externalWrites: 0, networkCalls: 0, outputPath: outputPath || undefined }));
})().catch(error => { console.error(error); process.exitCode = 1; });
