// Explicit one-time operational import. Default is a read-only plan; --apply writes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const batchId = 'ASIDE-VENDOR-20260917';
const inputPath = '.tmp/aside-vendor-source.json';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const text = value => String(value ?? '').trim();
const table = (book, name) => {
  const rows = book.sheets.find(sheet => sheet.name === name)?.rows;
  assert(rows, `Missing sheet ${name}`);
  return rows.slice(1).filter(row => row.some(value => value !== null && value !== '')).map((values, index) => ({ rowNumber: index + 2, ...Object.fromEntries(rows[0].map((key, index) => [key, values[index]])) }));
};
function buildImport(source, at) {
  const pending = table(source[0], '진행중');
  const adjustment = table(source[1], '주문조절');
  const receipts = table(source[2], '미입고SKU');
  assert.equal(pending.length, 19, 'Review a changed source before importing');
  assert.equal(pending.filter(row => row['거래처답변 분류'] === '입고지연').length, 10);
  const drafts = [], lines = [];
  for (const row of pending) {
    const skuId = text(row['SKU ID']), vendorName = text(row['거래처']);
    const sourcePairs = [...text(row['미입고 발주번호(수량)']).matchAll(/(\d+)\((\d+)\)/g)].map(match => ({ po: match[1], quantity: Number(match[2]) }));
    assert(sourcePairs.length && new Set(sourcePairs.map(pair => pair.po)).size === sourcePairs.length);
    const matches = adjustment.filter(item => text(item['SKU ID']) === skuId && text(item['거래처']) === vendorName);
    assert.equal(matches.length, 1, `Ambiguous product card ${skuId}`);
    const card = matches[0];
    assert(!text(card['이미지교체(URL 또는 파일경로)']), `Review image override ${skuId}`);
    const details = sourcePairs.map(pair => {
      const found = receipts.filter(item => text(item['SKU ID']) === skuId && text(item['발주번호']) === pair.po && text(item['분류(단종/거래처발주/미납분재발주요청/미납분재발주완료)']) === '거래처발주');
      assert.equal(found.length, 1, `Ambiguous receipt ${skuId}/${pair.po}`);
      const record = found[0];
      const confirmedQuantity = Number(record['납품수량']), receivedQuantity = Number(record['입고수량']);
      assert(Number.isSafeInteger(confirmedQuantity) && Number.isSafeInteger(receivedQuantity) && receivedQuantity >= 0);
      assert.equal(confirmedQuantity - receivedQuantity, pair.quantity);
      return { purchaseOrderNumber: pair.po, confirmedQuantity, receivedQuantity, shortageQuantity: pair.quantity };
    });
    const shortage = details.reduce((sum, detail) => sum + detail.shortageQuantity, 0);
    assert.equal(shortage, Number(row['미입고수량']));
    const quantity = Number(row['주문수량']);
    assert(Number.isSafeInteger(quantity) && quantity > 0);
    assert(['', '입고지연'].includes(text(row['거래처답변 분류'])));
    const draftId = `${batchId}::${vendorName}`;
    const sourceDate = text(row['발주요청일']).slice(0, 10);
    assert(/^\d{4}-\d{2}-\d{2}$/.test(sourceDate));
    const recordedAt = new Date(`${sourceDate}T00:00:00+09:00`).toISOString();
    if (!drafts.some(draft => draft.id === draftId)) drafts.push({ id: draftId, waveId: batchId, vendorName, status: 'sent', createdAt: recordedAt, updatedAt: at, sentAt: recordedAt });
    const record = receipts.find(item => text(item['SKU ID']) === skuId && text(item['발주번호']) === details[0].purchaseOrderNumber);
    const line = {
      id: `${draftId}::${skuId}`, draftId, waveId: batchId, vendorName, skuId,
      modelName: text(row['모델SKU'] || card['모델SKU']), category: text(card['카테고리']),
      productName: text(row['상품명']), optionLabel: text(row['상품명']).split(',').slice(1).map(text).join(', '),
      imageUrl: text(card['현재 이미지URL']), barcode: text(record['바코드']),
      actualShortageQuantity: shortage, shortageQuantity: quantity, currentStock: '',
      relatedPurchaseOrderNumbers: details.map(detail => detail.purchaseOrderNumber),
      memo: [text(row['메모']), text(card['메모(카드에 표시)'])].filter(Boolean).filter((value,index,all) => all.indexOf(value) === index).join(' · '),
      isManuallyAdded: true, manualListGroup: batchId, sourceType: 'actual-inbound-shortage',
      actualInboundDetails: details, coupangConfirmedQuantity: details.reduce((sum, detail) => sum + detail.confirmedQuantity, 0), coupangReceivedQuantity: details.reduce((sum, detail) => sum + detail.receivedQuantity, 0),
      importedVendorSource: { kind: 'aside-vendor-pending', batchId, fileName: '거래처발주_진행관리.xlsx', sheetName: '진행중', rowNumber: row.rowNumber, recordedAt, skuId, details },
      createdAt: recordedAt, updatedAt: at,
    };
    if (row['거래처답변 분류'] === '입고지연') {
      line.receivingDelayedAt = new Date(`${text(row['최종수정일']).slice(0,10)}T00:00:00+09:00`).toISOString();
      line.receivingDelayMemo = [text(row['입고예정(입고지연)']) && `입고예정 ${text(row['입고예정(입고지연)'])}`, text(row['메모'])].filter(Boolean).join(' · ') || 'Aside 입고지연 기록';
    }
    lines.push(line);
  }
  assert.equal(drafts.length, 4);
  assert.equal(new Set(lines.map(line => line.skuId)).size, 19);
  return { drafts, lines };
}

async function main() {
  const target = process.argv.includes('--production') ? 'production' : 'local';
  const base = target === 'production' ? 'https://noidb-os.vercel.app' : 'http://127.0.0.1:3111';
  const apply = process.argv.includes('--apply');
  const source = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const at = new Date().toISOString();
  const incoming = buildImport(source, at);
  const call = async body => {
    const response = await fetch(base + '/api/wms/picking-waves', body ? { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) } : undefined);
    assert(response.headers.get('content-type')?.includes('application/json'), `Non-JSON ${target} response ${response.status}`);
    const data = await response.json();
    assert(response.ok && data.ok, data.error || `${target} HTTP ${response.status}`);
    return data.snapshot;
  };
  const before = await call();
  const existingIds = new Set(before.vendorOrderLines.map(line => line.id));
  for (const line of incoming.lines) assert(!before.deletedVendorLineIds[line.id], `Previously removed import ${line.id}`);
  const newLines = incoming.lines.filter(line => !existingIds.has(line.id));
  assert([0,19].includes(newLines.length), 'Partial prior import requires review');
  const duplicates = before.vendorOrderLines.filter(line => line.waveId !== batchId && !before.deletedVendorLineIds[line.id] && !line.orderExclusion && !line.sentResolution && !line.vendorTransfer && incoming.lines.some(imported => imported.skuId === line.skuId && imported.vendorName === line.vendorName && imported.relatedPurchaseOrderNumbers.some(po => line.relatedPurchaseOrderNumbers.includes(po))));
  // Explicitly approved legacy overlaps only; never broaden retirement on a later run.
  assert(duplicates.every(line => ['78491559','78491560'].includes(line.skuId)), 'Additional legacy overlap requires review');
  const plan = { target, base, apply, sourceHashes: source.map(book => ({ path: book.path, sha256: hash(fs.readFileSync(book.path)) })), draftCount: incoming.drafts.length, lineCount: incoming.lines.length, delayedCount: 10, unansweredCount: 9, added: newLines.length, superseded: duplicates.map(line => ({ id: line.id, skuId: line.skuId, beforeQuantity: line.shortageQuantity, asideQuantity: incoming.lines.find(item => item.skuId === line.skuId).shortageQuantity })) };
  const directory = path.join('.tmp','aside-vendor-import',target,at.replaceAll(':','-'));
  fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,'before.json'),JSON.stringify(before));
  fs.writeFileSync(path.join(directory,'plan.json'),JSON.stringify(plan,null,2));
  fs.writeFileSync(path.join(directory,'incoming.json'),JSON.stringify(incoming,null,2));
  if (!apply) { console.log(JSON.stringify({...plan,directory})); return; }
  let saved = before;
  if (newLines.length) saved = await call({ action: 'migrate', snapshot: { vendorOrderDrafts: incoming.drafts, vendorOrderLines: incoming.lines } });
  assert(incoming.lines.every(line => saved.vendorOrderLines.some(item => item.id === line.id && item.importedVendorSource?.batchId === batchId)), 'Import response incomplete');
  for (const waveId of new Set(duplicates.map(line => line.waveId))) {
    const rows = duplicates.filter(line => line.waveId === waveId);
    saved = await call({ action: 'deleteVendorLines', waveId, lineIds: rows.map(line => line.id), expectedUpdatedAtByLineId: Object.fromEntries(rows.map(line => [line.id,line.updatedAt])), deletedAt: at });
  }
  const after = await call();
  const imported = after.vendorOrderLines.filter(line => line.waveId === batchId);
  assert.equal(imported.length,19);
  assert.equal(imported.filter(line => line.receivingDelayedAt && !line.receivingDelayReleasedAt).length,10);
  assert(duplicates.every(line => !after.vendorOrderLines.some(row => row.id === line.id) && JSON.stringify(after.discardedVendorLines?.[line.id]?.line) === JSON.stringify(line)), 'Legacy history not preserved');
  const duplicateIds = new Set(duplicates.map(line => line.id));
  assert(before.vendorOrderLines.filter(line => !duplicateIds.has(line.id)).every(line => JSON.stringify(after.vendorOrderLines.find(row => row.id === line.id)) === JSON.stringify(line)), 'Unrelated vendor line changed');
  assert(before.vendorOrderDrafts.every(draft => JSON.stringify(after.vendorOrderDrafts.find(row => row.id === draft.id)) === JSON.stringify(draft)), 'Existing draft changed');
  for (const key of Object.keys(before).filter(key => !['revision','updatedAt','vendorOrderDrafts','vendorOrderLines','deletedVendorLineIds','discardedVendorLines'].includes(key))) assert.deepEqual(after[key],before[key],`Unrelated ${key} changed`);
  fs.writeFileSync(path.join(directory,'after.json'),JSON.stringify(after));
  console.log(JSON.stringify({ target, imported:19, vendors:4, delayed:10, unanswered:9, newlyAdded:newLines.length, archivedDuplicates:duplicates.length, unchangedOtherData:true, directory }));
}
module.exports = { buildImport, batchId };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
