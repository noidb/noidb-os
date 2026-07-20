const LAURA_WEBHOOK_SECRET = '여기에_임의의_긴_영문_비밀번호를_입력';

const PRODUCT_INPUT_HEADERS = [
  '등록여부','거래처','성별','카테고리','모델명/품번','상품명','색상목록','사이즈목록',
  '원가(부가세포함)','쿠팡 판매가','치수','창고번호'
];
const LEGACY_PRODUCT_DB_HEADERS = [
  '거래처','성별','카테고리','모델명/품번','모델SKU','이미지','상품명','색상','주얼리사이즈','치수',
  '원가(부가세포함)','쿠팡 판매가','공급가','권장소비자가격','SKU ID','발주가능상태','제품링크',
  '마진','바코드','현재고','누적입고','총입고','반출누계','누적발주','미입고','최근발주수량',
  '최근입고일','이전쿠팡공급가','최근쿠팡공급가','공급가차이','공급가확인',
  '창고번호','SKU매칭상태','SKU매칭점수','SKU최초발견일','쿠팡 노출가','기본순서','노출상품ID','옵션ID'
];
const PRODUCT_DB_HEADERS = [
  'SKU매칭상태','거래처','성별','카테고리','모델명/품번','모델SKU','창고번호','SKU ID','이미지','상품명','색상',
  '주얼리사이즈','치수','원가(부가세포함)','쿠팡 판매가','공급가','발주가능상태','제품링크',
  '마진','바코드','현재고','누적입고','총입고','반출누계','누적발주','미입고','최근발주수량',
  '최근입고일','이전쿠팡공급가','최근쿠팡공급가','공급가차이','공급가확인',
  'SKU매칭점수','SKU최초발견일','쿠팡 노출가','기본순서','노출상품ID','옵션ID'
];
const PO_HISTORY_SHEET = '_발주이력';
const INBOUND_HISTORY_SHEET = '_입고요약';
const SKU_MASTER_SHEET = '_SKU마스터';
const SKU_MATCH_SHEET = 'SKU매칭확인';
const PO_PICKING_SHEET = '발주서 출력';
const PO_SHIPMENT_SHEET = '쉽먼트전송';
const COUPON_ISSUE_SHEET = '쿠폰발행';
const QUOTE_QUEUE_SHEET = '견적서대기';
const SKU_REPLACEMENT_SHEET = '_SKU교체이력';
const PO_HISTORY_HEADERS = ['고유키','발주번호','SKU ID','물류센터','발주현황','상품명','바코드','입고예정일','발주일','발주수량','확정수량','입고수량','매입가','공급가','부가세','반영일'];
const INBOUND_HISTORY_HEADERS = ['데이터세트','SKU ID','상품명','총입고','반출','순누적입고','최근입고일','이전공급가일','이전공급가','최근공급가일','최근공급가','반영일'];
const SKU_MASTER_HEADERS = ['SKU ID','상품명','바코드','발주가능상태','최초발견일','최근확인일'];
const SKU_MATCH_HEADERS = ['처리상태','SKU ID','SKU명','바코드','후보 모델SKU','후보 모델명','점수','발견일','안내'];
const PO_PICKING_HEADERS = ['물류센터','발주서 번호','발주일시','입고예정일','창고번호','상품코드(SKU ID)','상품명','바코드','원가','매입가','발주수량','업체납품가능수량','거래처'];
const PO_SHIPMENT_HEADERS = ['합배송묶음','발주서 NO','물류센터','입고예정일','상품코드(SKU ID)','상품명','발주수량','납품가능수량','입고수량','공급가','전송확인'];
const COUPON_ISSUE_HEADERS = ['입고예정일','상품코드(SKU ID)','상품명'];
const QUOTE_QUEUE_HEADERS = ['모델명','성별','카테고리','SKU행수','저장일시','견적서정보'];
const SKU_REPLACEMENT_HEADERS = ['처리일시','이전모델명','새모델명','이전 SKU ID','이전 바코드','창고번호','처리상태','연결묶음','기존행전체정보'];

function setupProductDbSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const legacyPicking = ss.getSheetByName('발주피킹');
  if (legacyPicking && !ss.getSheetByName(PO_PICKING_SHEET)) legacyPicking.setName(PO_PICKING_SHEET);
  try { ss.rename('LAURA 상품DB'); } catch (error) { /* keep current name if rename is unavailable */ }
  const input = getOrCreateSheet_(ss, '상품입력');
  const db = getOrCreateSheet_(ss, '제품DB');
  const poHistory = getOrCreateSheet_(ss, PO_HISTORY_SHEET);
  const inboundHistory = getOrCreateSheet_(ss, INBOUND_HISTORY_SHEET);
  const skuMaster = getOrCreateSheet_(ss, SKU_MASTER_SHEET);
  const skuMatch = getOrCreateSheet_(ss, SKU_MATCH_SHEET);
  const poPicking = getOrCreateSheet_(ss, PO_PICKING_SHEET);
  const poShipment = getOrCreateSheet_(ss, PO_SHIPMENT_SHEET);
  const couponIssue = getOrCreateSheet_(ss, COUPON_ISSUE_SHEET);
  const quoteQueue = getOrCreateSheet_(ss, QUOTE_QUEUE_SHEET);
  const replacementHistory = getOrCreateSheet_(ss, SKU_REPLACEMENT_SHEET);
  syncHeaders_(input, PRODUCT_INPUT_HEADERS);
  syncProductDbHeaders_(db);
  syncHeaders_(poHistory, PO_HISTORY_HEADERS);
  syncHeaders_(inboundHistory, INBOUND_HISTORY_HEADERS);
  syncHeaders_(skuMaster, SKU_MASTER_HEADERS);
  syncHeaders_(skuMatch, SKU_MATCH_HEADERS);
  syncHeaders_(poPicking, PO_PICKING_HEADERS);
  syncHeaders_(poShipment, PO_SHIPMENT_HEADERS);
  syncHeaders_(couponIssue, COUPON_ISSUE_HEADERS);
  syncHeaders_(quoteQueue, QUOTE_QUEUE_HEADERS);
  syncHeaders_(replacementHistory, SKU_REPLACEMENT_HEADERS);
  poHistory.hideSheet();
  inboundHistory.hideSheet();
  skuMaster.hideSheet();
  quoteQueue.hideSheet();
  replacementHistory.hideSheet();
  purgeNonRocketSkus_(db, skuMaster);
  normalizeTextColumn_(db, dbColumn_('상품명') + 1);
  normalizeTextColumn_(input, 6);
  normalizeTextColumn_(skuMaster, 2);
  normalizeTextColumn_(poHistory, 6);
  normalizeTextColumn_(skuMatch, 3);
  normalizeTextColumn_(poPicking, 7);
  normalizeTextColumn_(poShipment, 6);
  normalizeQuoteQueuePayloads_(quoteQueue);
  normalizeStoredDrafts_();
  normalizeSuppliers_(input, db);
  normalizePendingRegistrationStatuses_(ss, db);
  promoteReplacementPendingRows_(ss, db);
  const retiredRemoved = purgeRetiredProductRows_(ss, db);
  const replacementRepair = repairReplacementDataFromHistory_(ss, db);
  const duplicateRemoved = dedupeProductDbUniqueKeys_(db);
  normalizeCatalogIdColumns_(db);
  formatProductDb_(db);
  ensureProductDbDefaultOrder_(db);
  sortProductDbDefault_(db);
  refreshPurchasePrintProductLinks_(ss, db);
  normalizeRecentInboundDates_(db);
  formatCouponIssueSheet_(couponIssue);
  ensureWeeklyCouponTrigger_(ss);
  getImageFolder_();
  ss.getSheets().forEach(sheet => {
    if (!['상품입력','제품DB',PO_HISTORY_SHEET,INBOUND_HISTORY_SHEET,SKU_MASTER_SHEET,SKU_MATCH_SHEET,PO_PICKING_SHEET,PO_SHIPMENT_SHEET,COUPON_ISSUE_SHEET,QUOTE_QUEUE_SHEET,SKU_REPLACEMENT_SHEET].includes(sheet.getName())) ss.deleteSheet(sheet);
  });
  SpreadsheetApp.getUi().alert('상품DB 설정 완료\n구 SKU 정리: ' + retiredRemoved + '행\n교체이력 정보 복구: ' + replacementRepair.restoredFields + '칸\n사라진 기존행 복구: ' + replacementRepair.restoredRows + '행\n중복 정리: ' + duplicateRemoved + '행');
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents || '{}');
    if (LAURA_WEBHOOK_SECRET && data.secret !== LAURA_WEBHOOK_SECRET) {
      return json_({ ok: false, error: 'unauthorized' });
    }

    if (data.action === 'cloudDraftSave') return saveCloudDraft_(data.record);
    if (data.action === 'cloudDraftList') return listCloudDrafts_();
    if (data.action === 'cloudDraftDelete') return deleteCloudDraft_(String(data.model || ''));
    if (data.action === 'quoteQueueList') return listQuoteQueue_();
    if (data.action === 'quoteQueueClear') return clearQuoteQueue_(String(data.gender || ''), String(data.category || ''));
    if (data.action === 'quoteQueueDeleteModel') return deleteQuoteQueueModel_(String(data.model || ''));
    if (data.action === 'supplierList') return listSuppliers_();

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const input = getOrCreateSheet_(ss, '상품입력');
    const db = getOrCreateSheet_(ss, '제품DB');
    syncHeaders_(input, PRODUCT_INPUT_HEADERS);
    syncProductDbHeaders_(db);

    if (data.action === 'linkReplacementExisting') {
      return linkExistingReplacement_(ss, input, db, String(data.model || ''), String(data.replacementSku || ''), Boolean(data.forceLegacyOptions), data.productDbRows || []);
    }
    if (data.action === 'deleteReplacementLegacyRows') {
      return deleteReplacementLegacyRows_(ss, input, db, String(data.model || ''), String(data.replacementSku || ''));
    }
    if (data.action === 'normalizeCatalogIds') {
      return json_({ ok: true, normalized: normalizeCatalogIdColumns_(db) });
    }

    if (data.action === 'importSkuMaster') return importSkuMaster_(ss, db, data.items || []);
    if (data.action === 'importLegacyProducts') return importLegacyProducts_(ss, db, data.items || []);
    if (data.action === 'importVerifiedCatalog') return importVerifiedCatalog_(db, data.items || []);
    if (data.action === 'importInboundSummary') return importInboundSummary_(ss, db, data);
    if (data.action === 'importPurchaseOrders') return importPurchaseOrders_(ss, db, data.items || []);

    if (data.action === 'checkModel') {
      return json_({ ok: true, duplicate: modelExists_(input, db, String(data.model || '')) });
    }

    const model = Array.isArray(data.productInputRow) ? String(data.productInputRow[4] || '').trim() : '';
    const duplicate = model && modelExists_(input, db, model);
    if (duplicate && data.syncMode === 'skipDuplicate') {
      return json_({ ok: true, duplicate: true, skipped: true });
    }

    const imageFormulas = saveProductImages_(data.productImages || []);
    let rows = Array.isArray(data.productDbRows) ? data.productDbRows.map(row => {
      const next = row.slice(0, PRODUCT_DB_HEADERS.length);
      const imageColumn = dbColumn_('이미지');
      const filename = String(next[imageColumn] || '');
      if (imageFormulas[filename]) next[imageColumn] = imageFormulas[filename];
      return next;
    }) : [];

    const replacementSku = String(data.replacementSku || '').trim();
    if (replacementSku) rows = prepareReplacementRows_(ss, input, db, replacementSku, model, rows);
    else rows.forEach(row => {
      if (!String(row[dbColumn_('SKU ID')] || '').trim()) row[dbColumn_('SKU매칭상태')] = '등록대기';
    });

    const replacementSummary = rows && rows.replacementSummary ? rows.replacementSummary : null;
    upsertProduct_(input, db, data.productInputRow, rows);
    finalizeReplacementCleanup_(input, db, model, replacementSummary);
    if (data.quoteRecord) saveQuoteQueue_(ss, data.quoteRecord);
    return json_({ ok: true, duplicate: false, updated: Boolean(duplicate), quoteQueued: Boolean(data.quoteRecord) });
  } catch (error) {
    return json_({ ok: false, error: String(error) });
  }
}

/** 상품입력 시트를 직접 수정하면 같은 모델의 제품DB SKU 행도 즉시 다시 계산합니다. */
function onEdit(e) {
  try {
    const range = e && e.range;
    if (!range) return;
    if (range.getSheet().getName() === SKU_MATCH_SHEET) {
      handleSkuMatchApproval_(range);
      return;
    }
    if (range.getSheet().getName() === '제품DB') {
      const watched = ['창고번호','SKU ID','상품명','바코드','원가(부가세포함)','거래처']
        .map(name => dbColumn_(name) + 1);
      const editedColumns = [];
      for (let column = range.getColumn(); column <= range.getLastColumn(); column++) editedColumns.push(column);
      if (editedColumns.some(column => watched.indexOf(column) >= 0)) {
        refreshPurchasePrintProductLinks_(range.getSheet().getParent(), range.getSheet());
      }
      return;
    }
    if (range.getSheet().getName() !== '상품입력' || range.getRow() < 2) return;
    if (range.getColumn() > PRODUCT_INPUT_HEADERS.length || range.getLastColumn() < 2) return;
    const ss = range.getSheet().getParent();
    const db = ss.getSheetByName('제품DB');
    if (!db) return;

    if (range.getColumn() <= 5 && range.getLastColumn() >= 5 && e.oldValue) {
      const oldModel = String(e.oldValue || '').trim();
      const newModel = String(range.getSheet().getRange(range.getRow(), 5).getValue() || '').trim();
      if (oldModel && oldModel !== newModel) removeDbRowsByModel_(db, oldModel);
    }

    for (let rowNumber = range.getRow(); rowNumber <= range.getLastRow(); rowNumber++) {
      const inputRow = range.getSheet().getRange(rowNumber, 1, 1, PRODUCT_INPUT_HEADERS.length).getValues()[0];
      const model = String(inputRow[4] || '').trim();
      if (!model) continue;
      replaceDbRowsForModel_(db, model, buildDbRowsFromInput_(inputRow));
    }
  } catch (error) {
    console.error(error);
  }
}

function handleSkuMatchApproval_(range) {
  if (range.getRow() < 2) return;
  const sheet = range.getSheet();
  const status = String(sheet.getRange(range.getRow(), 1).getValue() || '').trim();
  if (status !== '연결승인') return;
  const sku = String(sheet.getRange(range.getRow(), 2).getDisplayValue() || '').trim();
  const modelSku = String(sheet.getRange(range.getRow(), 5).getDisplayValue() || '').trim();
  if (!sku || !modelSku) {
    sheet.getRange(range.getRow(), 9).setValue('SKU ID와 후보 모델SKU를 확인해주세요.');
    return;
  }
  const ss = sheet.getParent();
  const db = ss.getSheetByName('제품DB');
  if (!db || db.getLastRow() < 2) return;
  const values = dbMatrix_(db);
  const skuColumn = dbColumn_('SKU ID');
  const modelSkuColumn = dbColumn_('모델SKU');
  const duplicate = values.findIndex(row => String(row[skuColumn] || '').trim() === sku);
  const target = values.findIndex(row => String(row[modelSkuColumn] || '').trim() === modelSku);
  if (target < 0) {
    sheet.getRange(range.getRow(), 9).setValue('후보 모델SKU를 제품DB에서 찾지 못했습니다.');
    return;
  }
  const targetRow = values[target];
  const targetRegistrationStatus = String(targetRow[dbColumn_('SKU매칭상태')] || '').indexOf('재등록') >= 0
    ? '재등록대기' : '등록대기';
  const duplicateRow = duplicate >= 0 && duplicate !== target ? values[duplicate] : null;
  targetRow[skuColumn] = sku;
  targetRow[dbColumn_('바코드')] = sheet.getRange(range.getRow(), 4).getDisplayValue() || (duplicateRow && duplicateRow[dbColumn_('바코드')]) || '';
  targetRow[dbColumn_('발주가능상태')] = (duplicateRow && duplicateRow[dbColumn_('발주가능상태')]) || targetRow[dbColumn_('발주가능상태')] || '';
  targetRow[dbColumn_('SKU매칭상태')] = targetRegistrationStatus;
  targetRow[dbColumn_('SKU매칭점수')] = 100;
  targetRow[dbColumn_('SKU최초발견일')] = new Date();
  const output = values.filter((row, index) => index !== duplicate || duplicate === target);
  writeDbMatrix_(db, dedupeProductDbRows_(output).rows);
  refreshPurchasePrintProductLinks_(ss, db);
  sheet.getRange(range.getRow(), 1).setValue('연결완료');
  sheet.getRange(range.getRow(), 9).setValue('제품DB 연결 완료');
}

function upsertProduct_(input, db, productInputRow, productDbRows) {
  if (!Array.isArray(productInputRow) || !productInputRow.length) return;
  const row = productInputRow.slice(0, PRODUCT_INPUT_HEADERS.length);
  const model = String(row[4] || '').trim();
  if (!model) throw new Error('모델명이 없습니다.');
  const inputRowNumber = findModelRow_(input, 5, model);
  if (inputRowNumber) input.getRange(inputRowNumber, 1, 1, row.length).setValues([row]);
  else input.appendRow(row);
  replaceDbRowsForModel_(db, model, productDbRows);
}

function replaceDbRowsForModel_(db, model, newRows) {
  assertUniqueProductKeys_(newRows, '새 등록 옵션');
  const isReplacement = Boolean(newRows && newRows.replacementSummary);
  const preserved = {};
  const matches = [];
  if (db.getLastRow() > 1) {
    db.setRowHeights(2, db.getLastRow() - 1, 82);
    db.getRange(2, 1, db.getLastRow() - 1, PRODUCT_DB_HEADERS.length).setVerticalAlignment('middle');
    const range = db.getRange(2, 1, db.getLastRow() - 1, PRODUCT_DB_HEADERS.length);
    const values = range.getValues();
    const formulas = range.getFormulas();
    values.forEach((row, index) => {
      if (String(row[dbColumn_('모델명/품번')] || '').trim() !== model) return;
      const sku = String(row[dbColumn_('모델SKU')] || '').trim();
      preserved[sku] = { values: row, imageFormula: formulas[index][dbColumn_('이미지')] || '' };
      matches.push(index + 2);
    });
  }

  for (let i = matches.length - 1; i >= 0; i--) db.deleteRow(matches[i]);
  if (!Array.isArray(newRows) || !newRows.length) return;

  // 방금 저장한 모델은 항상 제품DB 2행부터 보이도록 가장 높은 안전 정렬값을 부여합니다.
  const newOrder = 8000000000000000 + Date.now();
  const orderColumn = dbColumn_('기본순서');
  const rows = newRows.map(source => {
    const row = source.slice(0, PRODUCT_DB_HEADERS.length);
    while (row.length < PRODUCT_DB_HEADERS.length) row.push('');
    const old = preserved[String(row[dbColumn_('모델SKU')] || '').trim()];
    const replacementPending = isReplacement || String(row[dbColumn_('SKU매칭상태')] || '').indexOf('재등록대기') >= 0;
    if (old) {
      const imageColumn = dbColumn_('이미지');
      if ((!row[imageColumn] || !String(row[imageColumn]).startsWith('=')) && old.imageFormula) row[imageColumn] = old.imageFormula;
      if (!replacementPending) {
        ['창고번호','SKU ID','발주가능상태','제품링크','바코드','현재고','누적입고','총입고','반출누계',
          '누적발주','미입고','최근발주수량','최근입고일','이전쿠팡공급가','최근쿠팡공급가','공급가차이',
          '공급가확인','SKU매칭상태','SKU매칭점수','SKU최초발견일','쿠팡 노출가','기본순서','노출상품ID','옵션ID']
          .forEach(name => { const column = dbColumn_(name); row[column] = old.values[column]; });
      }
    }
    if (!String(row[dbColumn_('SKU ID')] || '').trim() && !String(row[dbColumn_('SKU매칭상태')] || '').trim()) {
      row[dbColumn_('SKU매칭상태')] = replacementPending ? '재등록대기' : '등록대기';
    }
    if (replacementPending) row[orderColumn] = newOrder;
    else if (!number_(row[orderColumn])) row[orderColumn] = old && number_(old.values[orderColumn])
      ? number_(old.values[orderColumn]) : newOrder;
    row[dbColumn_('마진')] = number_(row[dbColumn_('공급가')]) - number_(row[dbColumn_('원가(부가세포함)')]);
    return row;
  });

  const startRow = db.getLastRow() + 1;
  db.getRange(startRow, 1, rows.length, PRODUCT_DB_HEADERS.length).setValues(rows);
  db.getRange(startRow, dbColumn_('원가(부가세포함)') + 1, rows.length, 4).setNumberFormat('#,##0');
  db.getRange(startRow, dbColumn_('마진') + 1, rows.length, 1).setNumberFormat('#,##0');
  for (let row = startRow; row < startRow + rows.length; row++) db.setRowHeight(row, 82);
  formatProductDb_(db);
  dedupeProductDbUniqueKeys_(db);
  sortProductDbDefault_(db);
}

function removeDbRowsByModel_(db, model) {
  if (!model || db.getLastRow() < 2) return;
  const models = db.getRange(2, 4, db.getLastRow() - 1, 1).getDisplayValues().flat();
  for (let i = models.length - 1; i >= 0; i--) {
    if (String(models[i]).trim() === model) db.deleteRow(i + 2);
  }
}

function replacementOptionKey_(row) {
  return normalizeSkuMatchText_(row[dbColumn_('색상')]) + '|' + normalizeSkuMatchText_(row[dbColumn_('주얼리사이즈')]);
}

function replacementSkuSuffix_(row) {
  const model = normalizeSkuMatchText_(row[dbColumn_('모델명/품번')]);
  const modelSku = normalizeSkuMatchText_(row[dbColumn_('모델SKU')]);
  return model && modelSku.indexOf(model) === 0 ? modelSku.slice(model.length) : modelSku.replace(/^.*?-/, '');
}

function replacementDigits_(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

/** 숫자/문자/쉼표 형식이 달라도 같은 SKU ID로 비교합니다. */
function normalizeSkuId_(value) {
  const text = String(value == null ? '' : value).trim().replace(/^'/, '').replace(/[\s,]/g, '');
  return text.replace(/\.0+$/, '');
}

function replacementColorCode_(value) {
  const text = normalizeSkuMatchText_(value);
  if (text.indexOf('로즈') >= 0 || /rg/.test(text)) return 'RG';
  if (text.indexOf('골드') >= 0 || /gold|go/.test(text)) return 'GO';
  if (text.indexOf('실버') >= 0 || /silver|si/.test(text)) return 'SI';
  if (text.indexOf('블랙') >= 0 || /black|bk/.test(text)) return 'BK';
  if (text.indexOf('화이트') >= 0 || /white|wh/.test(text)) return 'WH';
  return '';
}

function mergeReplacementRows_(newRows, oldRows, forceSequentialFallback) {
  const available = oldRows.slice();
  const allowSequentialFallback = Boolean(forceSequentialFallback) || available.length === newRows.length;
  let matchedOptions = 0;
  let forcedMatches = 0;
  const prepared = (Array.isArray(newRows) ? newRows : []).map(source => {
    const row = source.slice(0, PRODUCT_DB_HEADERS.length);
    while (row.length < PRODUCT_DB_HEADERS.length) row.push('');
    const newColor = normalizeSkuMatchText_(row[dbColumn_('색상')]);
    const newSize = normalizeSkuMatchText_(row[dbColumn_('주얼리사이즈')]);
    const newSuffix = replacementSkuSuffix_(row);
    let bestIndex = -1;
    let bestScore = -1;
    available.forEach((old, index) => {
      const oldColor = normalizeSkuMatchText_(old[dbColumn_('색상')]);
      const oldSize = normalizeSkuMatchText_(old[dbColumn_('주얼리사이즈')]);
      const oldSuffix = replacementSkuSuffix_(old);
      let score = 0;
      if (newSuffix && oldSuffix && newSuffix === oldSuffix) score += 120;
      if (newColor && oldColor && newColor === oldColor) score += 45;
      else if (newColor && oldColor && (newColor.indexOf(oldColor) >= 0 || oldColor.indexOf(newColor) >= 0)) score += 30;
      const newColorCode = replacementColorCode_(newColor + newSuffix);
      const oldColorCode = replacementColorCode_(oldColor + oldSuffix);
      if (newColorCode && oldColorCode && newColorCode === oldColorCode) score += 35;
      if (newSize && oldSize && newSize === oldSize) score += 45;
      else {
        const newSizeNumber = replacementDigits_(newSize || newSuffix);
        const oldSizeNumber = replacementDigits_(oldSize || oldSuffix);
        if (newSizeNumber && oldSizeNumber && newSizeNumber === oldSizeNumber) score += 40;
      }
      if (score > bestScore) { bestScore = score; bestIndex = index; }
    });
    if (bestScore <= 0 && !allowSequentialFallback) bestIndex = -1;
    if (bestScore <= 0 && allowSequentialFallback && available.length) { bestIndex = 0; forcedMatches++; }
    const old = bestIndex >= 0 ? available.splice(bestIndex, 1)[0] : null;
    if (old) {
      matchedOptions++;
      ['현재고','누적입고','총입고','반출누계','누적발주','창고번호','SKU매칭상태'].forEach(name => {
        const column = dbColumn_(name);
        if (String(old[column] == null ? '' : old[column]).trim()) row[column] = old[column];
      });
    }
    row[dbColumn_('SKU ID')] = '';
    row[dbColumn_('바코드')] = '';
    row[dbColumn_('노출상품ID')] = '';
    row[dbColumn_('옵션ID')] = '';
    row[dbColumn_('쿠팡 노출가')] = '';
    row[dbColumn_('발주가능상태')] = '';
    row[dbColumn_('SKU매칭상태')] = '재등록대기';
    row[dbColumn_('SKU매칭점수')] = '';
    row[dbColumn_('SKU최초발견일')] = '';
    return row;
  });
  return { rows: prepared, matchedOptions: matchedOptions, forcedMatches: forcedMatches,
    unmatchedNew: Math.max(0, prepared.length - matchedOptions), unmatchedOld: Math.max(0, oldRows.length - matchedOptions) };
}

/** 과거/현재 열 순서로 보관된 SKU 교체이력을 현재 제품DB 열 순서로 복원합니다. */
function archivedProductDbRow_(parsed) {
  let headers = null;
  let values = null;
  if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.headers) && Array.isArray(parsed.values)) {
    headers = parsed.headers;
    values = parsed.values;
  } else if (Array.isArray(parsed)) {
    headers = LEGACY_PRODUCT_DB_HEADERS;
    values = parsed;
  }
  if (!headers || !values) return null;
  const map = {};
  headers.forEach((header, index) => { map[String(header || '')] = values[index]; });
  return PRODUCT_DB_HEADERS.map(header => map[header] == null ? '' : map[header]);
}

function replacementRowsFromHistory_(ss, legacySku, newModel) {
  const sheet = ss.getSheetByName(SKU_REPLACEMENT_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.min(sheet.getLastColumn(), SKU_REPLACEMENT_HEADERS.length)).getValues();
  let anchor = -1;
  for (let index = values.length - 1; index >= 0; index--) {
    if (normalizeSkuId_(values[index][3]) === normalizeSkuId_(legacySku) && String(values[index][2] || '').trim() === String(newModel || '').trim()) { anchor = index; break; }
  }
  if (anchor < 0) {
    for (let index = values.length - 1; index >= 0; index--) {
      if (normalizeSkuId_(values[index][3]) === normalizeSkuId_(legacySku)) { anchor = index; break; }
    }
  }
  if (anchor < 0) return [];
  const batch = String(values[anchor][7] || '').trim();
  const oldModel = String(values[anchor][1] || '').trim();
  const archivedNewModel = String(values[anchor][2] || '').trim();
  let selected = [];
  if (batch) selected = values.filter(row => String(row[7] || '').trim() === batch);
  else {
    let start = anchor;
    let end = anchor;
    while (start > 0 && String(values[start - 1][1] || '').trim() === oldModel && String(values[start - 1][2] || '').trim() === archivedNewModel) start--;
    while (end + 1 < values.length && String(values[end + 1][1] || '').trim() === oldModel && String(values[end + 1][2] || '').trim() === archivedNewModel) end++;
    selected = values.slice(start, end + 1);
  }
  return selected.map(historyRow => {
    if (historyRow[8]) {
      try {
        const parsed = JSON.parse(String(historyRow[8]));
        const restored = archivedProductDbRow_(parsed);
        if (restored) return restored;
      } catch (error) { /* legacy history below */ }
    }
    const row = new Array(PRODUCT_DB_HEADERS.length).fill('');
    row[dbColumn_('모델명/품번')] = oldModel;
    row[dbColumn_('SKU ID')] = String(historyRow[3] || '');
    row[dbColumn_('바코드')] = String(historyRow[4] || '');
    row[dbColumn_('창고번호')] = String(historyRow[5] || '');
    return row;
  });
}

/** 구 SKU는 조회·이력용으로만 보관하고 활성 제품DB에서는 제거합니다. */
function prepareReplacementRows_(ss, input, db, legacySku, newModel, newRows, forceLegacyOptions) {
  const wantedSku = normalizeSkuId_(legacySku);
  if (!wantedSku) return newRows;
  const rowCount = Math.max(0, db.getLastRow() - 1);
  if (!rowCount) throw new Error('기존 SKU ID를 제품DB에서 찾을 수 없습니다: ' + wantedSku);
  const range = db.getRange(2, 1, rowCount, PRODUCT_DB_HEADERS.length);
  const values = range.getValues();
  const formulas = range.getFormulas();
  const displays = range.getDisplayValues();
  const skuColumn = dbColumn_('SKU ID');
  const barcodeColumn = dbColumn_('바코드');
  const warehouseColumn = dbColumn_('창고번호');
  const anchorIndex = displays.findIndex(row => normalizeSkuId_(row[skuColumn]) === wantedSku);
  if (anchorIndex < 0) {
    const historyRows = replacementRowsFromHistory_(ss, wantedSku, newModel);
    if (!historyRows.length) throw new Error('기존 SKU ID를 제품DB와 SKU교체이력에서 찾을 수 없습니다: ' + wantedSku);
    const recovered = mergeReplacementRows_(newRows, historyRows, forceLegacyOptions);
    if (!recovered.matchedOptions) throw new Error('SKU교체이력은 찾았지만 새 옵션과 연결할 수 없습니다. [기존 ' + historyRows.length + '개 / 새 ' + newRows.length + '개]');
    recovered.rows.replacementSummary = { oldModel: String(historyRows[0][dbColumn_('모델명/품번')] || ''), matchedOptions: recovered.matchedOptions, totalOld: historyRows.length, recoveredFromHistory: true,
      forcedFallback: recovered.forcedMatches > 0, unmatchedNew: recovered.unmatchedNew, unmatchedOld: recovered.unmatchedOld,
      warehouses: [...new Set(recovered.rows.map(row => String(row[dbColumn_('창고번호')] || '').trim()).filter(Boolean))] };
    return recovered.rows;
  }
  const oldModel = String(values[anchorIndex][dbColumn_('모델명/품번')] || '').trim();
  if (!oldModel) throw new Error('기존 SKU의 모델명을 확인할 수 없습니다.');

  const oldRows = [];
  values.forEach((valueRow, index) => {
    if (String(valueRow[dbColumn_('모델명/품번')] || '').trim() !== oldModel) return;
    if (!String(displays[index][skuColumn] || '').trim()) return;
    const row = valueRow.map((value, column) => formulas[index][column] || value);
    row[skuColumn] = displays[index][skuColumn];
    row[barcodeColumn] = displays[index][barcodeColumn];
    row[warehouseColumn] = displays[index][warehouseColumn];
    oldRows.push(row);
  });

  const merged = mergeReplacementRows_(newRows, oldRows, forceLegacyOptions);
  const prepared = merged.rows;
  const matchedOptions = merged.matchedOptions;
  if (!matchedOptions) throw new Error('기존 SKU는 찾았지만 색상·사이즈 옵션을 연결하지 못했습니다. 기존 행은 변경하지 않았습니다. [기존 ' + oldRows.length + '개 / 새 ' + newRows.length + '개]');

  const history = getOrCreateSheet_(ss, SKU_REPLACEMENT_SHEET);
  syncHeaders_(history, SKU_REPLACEMENT_HEADERS);
  history.hideSheet();
  const replacementBatch = Utilities.getUuid();
  const historyRows = oldRows.map(row => [new Date(),oldModel,newModel,String(row[skuColumn] || ''),String(row[barcodeColumn] || ''),String(row[warehouseColumn] || ''),'구 SKU 사용금지 · 새 SKU 대기',replacementBatch,JSON.stringify({ headers: PRODUCT_DB_HEADERS, values: row })]);
  if (historyRows.length) history.getRange(history.getLastRow() + 1, 1, historyRows.length, SKU_REPLACEMENT_HEADERS.length).setValues(historyRows);
  prepared.replacementSummary = { oldModel: oldModel, matchedOptions: matchedOptions, totalOld: oldRows.length,
    activeOldRows: true,
    forcedFallback: merged.forcedMatches > 0, unmatchedNew: merged.unmatchedNew, unmatchedOld: merged.unmatchedOld,
    warehouses: [...new Set(prepared.map(row => String(row[dbColumn_('창고번호')] || '').trim()).filter(Boolean))] };
  return prepared;
}

/** 새 행 저장이 성공한 뒤에만 구 모델의 활성 행을 제거합니다. */
function finalizeReplacementCleanup_(input, db, newModel, summary) {
  if (!summary || !summary.activeOldRows) return;
  const oldModel = String(summary.oldModel || '').trim();
  const currentModel = String(newModel || '').trim();
  if (!oldModel || oldModel === currentModel) return;
  removeDbRowsByModel_(db, oldModel);
  const oldInputRow = findModelRow_(input, 5, oldModel);
  if (oldInputRow) input.deleteRow(oldInputRow);
}

function linkExistingReplacement_(ss, input, db, newModel, legacySku, forceLegacyOptions, requestedRows) {
  const model = String(newModel || '').trim();
  if (!model) return json_({ ok: false, error: '현재 새 모델명을 입력해주세요.' });
  if (!String(legacySku || '').trim()) return json_({ ok: false, error: '기존 대표 SKU ID를 입력해주세요.' });
  const currentRows = Array.isArray(requestedRows) && requestedRows.length
    ? requestedRows.map(row => row.slice(0, PRODUCT_DB_HEADERS.length)) : [];
  if (!currentRows.length) {
    const rowCount = Math.max(0, db.getLastRow() - 1);
    if (!rowCount) return json_({ ok: false, error: '제품DB에 연결할 새 모델 행이 없습니다.' });
    const range = db.getRange(2, 1, rowCount, PRODUCT_DB_HEADERS.length);
    const values = range.getValues();
    const formulas = range.getFormulas();
    values.forEach((row, index) => {
      if (String(row[dbColumn_('모델명/품번')] || '').trim() !== model) return;
      const sku = String(row[dbColumn_('SKU ID')] || '').trim();
      const status = String(row[dbColumn_('SKU매칭상태')] || '').trim();
      if (sku && status !== '재등록대기') return;
      currentRows.push(row.map((value, column) => formulas[index][column] || value));
    });
  }
  if (!currentRows.length) return json_({ ok: false, error: model + '의 새 등록행을 제품DB에서 찾을 수 없습니다.' });
  const prepared = prepareReplacementRows_(ss, input, db, legacySku, model, currentRows, forceLegacyOptions);
  const summary = prepared.replacementSummary || {};
  replaceDbRowsForModel_(db, model, prepared);
  refreshPurchasePrintProductLinks_(ss, db);
  return json_({ ok: true, linked: true, model: model, matchedOptions: summary.matchedOptions || 0, oldRows: summary.totalOld || 0,
    warehouses: summary.warehouses || [], recoveredFromHistory: Boolean(summary.recoveredFromHistory),
    forcedFallback: Boolean(summary.forcedFallback), unmatchedNew: summary.unmatchedNew || 0, unmatchedOld: summary.unmatchedOld || 0,
    cleanupAvailable: Boolean(summary.activeOldRows), oldModel: String(summary.oldModel || '') });
}

/** 이관 결과를 사용자가 확인한 뒤 구 모델의 활성 행만 삭제합니다. */
function deleteReplacementLegacyRows_(ss, input, db, newModel, legacySku) {
  const model = String(newModel || '').trim();
  const wantedSku = normalizeSkuId_(legacySku);
  if (!model || !wantedSku) return json_({ ok: false, error: '새 모델명과 기존 대표 SKU ID가 필요합니다.' });
  const historyRows = replacementRowsFromHistory_(ss, wantedSku, model);
  if (!historyRows.length) return json_({ ok: false, error: '삭제할 기존 상품의 이관 이력을 찾지 못했습니다.' });
  const oldModel = String(historyRows[0][dbColumn_('모델명/품번')] || '').trim();
  if (!oldModel || oldModel === model) return json_({ ok: false, error: '기존 모델명을 확인할 수 없습니다.' });
  const before = Math.max(0, db.getLastRow() - 1);
  removeDbRowsByModel_(db, oldModel);
  const deleted = before - Math.max(0, db.getLastRow() - 1);
  const oldInputRow = findModelRow_(input, 5, oldModel);
  if (oldInputRow) input.deleteRow(oldInputRow);
  refreshPurchasePrintProductLinks_(ss, db);
  return json_({ ok: true, deleted: deleted, oldModel: oldModel });
}

function buildDbRowsFromInput_(inputRow) {
  const supplier = String(inputRow[1] || '');
  const gender = String(inputRow[2] || '');
  const category = String(inputRow[3] || '');
  const model = String(inputRow[4] || '');
  const title = String(inputRow[5] || '');
  const colors = [...new Set(splitList_(inputRow[6]))];
  const sizes = [...new Set(splitList_(inputRow[7]))];
  const cost = number_(inputRow[8]);
  const sale = number_(inputRow[9]);
  const dimension = String(inputRow[10] || '');
  const warehouse = String(inputRow[11] || '').trim();
  const supply = Math.round(sale * 0.58);
  const useSize = sizes.length >= 2 || category === '반지' || sizes.some(size => /\d/.test(size));
  const sizeCodes = sizeOptionCodes_(sizes);
  const rows = [];
  colors.forEach(color => {
    const code = colorCode_(color);
    const rowSizes = useSize && sizes.length ? sizes : [sizes[0] || 'Free'];
    rowSizes.forEach((size, sizeIndex) => {
      const sku = useSize ? `${model}-${code}${sizeCodes[sizeIndex]}` : `${model}-${code}`;
      const row = new Array(PRODUCT_DB_HEADERS.length).fill('');
      row[dbColumn_('거래처')] = supplier;
      row[dbColumn_('성별')] = gender;
      row[dbColumn_('카테고리')] = category;
      row[dbColumn_('모델명/품번')] = model;
      row[dbColumn_('모델SKU')] = sku;
      row[dbColumn_('상품명')] = title;
      row[dbColumn_('색상')] = color;
      row[dbColumn_('주얼리사이즈')] = size;
      row[dbColumn_('치수')] = dimension;
      row[dbColumn_('원가(부가세포함)')] = cost;
      row[dbColumn_('쿠팡 판매가')] = sale;
      row[dbColumn_('공급가')] = supply;
      row[dbColumn_('마진')] = supply - cost;
      row[dbColumn_('현재고')] = 0;
      row[dbColumn_('누적입고')] = 0;
      row[dbColumn_('창고번호')] = warehouse;
      rows.push(row);
    });
  });
  assertUniqueProductKeys_(rows, '상품입력 옵션');
  return rows;
}

function saveProductImages_(items) {
  const formulas = {};
  if (!Array.isArray(items) || !items.length) return formulas;
  const folder = getImageFolder_();
  items.forEach(item => {
    const filename = String(item.filename || '').trim();
    const dataUrl = String(item.dataUrl || '');
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!filename || !match) return;
    const existing = folder.getFilesByName(filename);
    while (existing.hasNext()) existing.next().setTrashed(true);
    const blob = Utilities.newBlob(Utilities.base64Decode(match[2]), match[1], filename);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const url = `https://drive.google.com/uc?export=view&id=${file.getId()}&v=${Date.now()}`;
    formulas[filename] = `=IMAGE("${url}",4,80,80)`;
  });
  return formulas;
}

function getImageFolder_() {
  const props = PropertiesService.getDocumentProperties();
  const storedId = props.getProperty('productDbImageFolderId');
  if (storedId) {
    try {
      const storedFolder = DriveApp.getFolderById(storedId);
      if (storedFolder.getName() !== 'LAURA 상품DB 이미지') storedFolder.setName('LAURA 상품DB 이미지');
      return storedFolder;
    } catch (error) { /* recreate below */ }
  }
  const folder = DriveApp.createFolder('LAURA 상품DB 이미지');
  props.setProperty('productDbImageFolderId', folder.getId());
  return folder;
}

function formatProductDb_(db) {
  db.setFrozenRows(1);
  try { db.showColumns(1, PRODUCT_DB_HEADERS.length); } catch (error) { /* keep visible state */ }
  db.setColumnWidth(dbColumn_('이미지') + 1, 110);
  const header = db.getRange(1, 1, 1, PRODUCT_DB_HEADERS.length);
  header.setFontWeight('bold').setFontColor('#ffffff').setBackground('#1f4e78')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  db.setRowHeight(1, 32);
  if (db.getFilter()) db.getFilter().remove();
  if (db.getLastRow() > 1) db.getRange(1, 1, db.getLastRow(), PRODUCT_DB_HEADERS.length).createFilter();
  if (db.getLastRow() > 1) {
    db.getRange(2, dbColumn_('SKU ID') + 1, db.getLastRow() - 1, 1).setNumberFormat('@');
    db.getRange(2, dbColumn_('바코드') + 1, db.getLastRow() - 1, 1).setNumberFormat('@');
    db.getRange(2, dbColumn_('현재고') + 1, db.getLastRow() - 1, 7).setNumberFormat('#,##0');
    db.getRange(2, dbColumn_('최근입고일') + 1, db.getLastRow() - 1, 1).setNumberFormat('yyyy/MM/dd');
    db.getRange(2, dbColumn_('이전쿠팡공급가') + 1, db.getLastRow() - 1, 3).setNumberFormat('#,##0');
    db.getRange(2, dbColumn_('쿠팡 노출가') + 1, db.getLastRow() - 1, 1).setNumberFormat('#,##0');
    db.getRange(2, dbColumn_('노출상품ID') + 1, db.getLastRow() - 1, 2).setNumberFormat('@');
  }
  try { db.hideColumns(dbColumn_('성별') + 1); } catch (error) { /* already hidden */ }
  try { db.hideColumns(dbColumn_('카테고리') + 1); } catch (error) { /* already hidden */ }
  try { db.hideColumns(dbColumn_('기본순서') + 1); } catch (error) { /* already hidden */ }
}

/** 노출상품ID와 옵션ID를 천 단위 쉼표가 없는 일반 텍스트 숫자로 통일합니다. */
function normalizeCatalogIdColumns_(db) {
  const rowCount = Math.max(0, db.getLastRow() - 1);
  if (!rowCount) return 0;
  ['노출상품ID','옵션ID'].forEach(name => {
    const range = db.getRange(2, dbColumn_(name) + 1, rowCount, 1);
    const values = range.getDisplayValues().map(row => [normalizeSkuId_(row[0])]);
    range.setNumberFormat('@');
    range.setValues(values);
  });
  return rowCount;
}

/** 새 등록 상품이 항상 위에 오도록 복원용 순서를 채웁니다. */
function ensureProductDbDefaultOrder_(db) {
  const rowCount = Math.max(0, db.getLastRow() - 1);
  if (!rowCount) return;
  const orderColumn = dbColumn_('기본순서');
  const skuColumn = dbColumn_('SKU ID');
  const modelColumn = dbColumn_('모델명/품번');
  const values = db.getRange(2, 1, rowCount, PRODUCT_DB_HEADERS.length).getValues();
  let changed = false;
  values.forEach((row, index) => {
    if (number_(row[orderColumn])) return;
    const pending = !String(row[skuColumn] || '').trim();
    const modelMatch = String(row[modelColumn] || '').match(/(\d+)/g);
    const modelNumber = modelMatch ? Number(modelMatch.join('').slice(-10)) || 0 : 0;
    row[orderColumn] = (pending ? 2000000000000000 : 1000000000000000) + modelNumber * 1000 + (rowCount - index);
    changed = true;
  });
  const modelOrders = {};
  values.forEach(row => {
    const model = String(row[modelColumn] || '').trim();
    if (!model) return;
    modelOrders[model] = Math.max(number_(modelOrders[model]), number_(row[orderColumn]));
  });
  values.forEach(row => {
    const model = String(row[modelColumn] || '').trim();
    if (!model || number_(row[orderColumn]) === modelOrders[model]) return;
    row[orderColumn] = modelOrders[model];
    changed = true;
  });
  if (changed) db.getRange(2, orderColumn + 1, rowCount, 1).setValues(values.map(row => [row[orderColumn]]));
}

/**
 * SKU가 아직 발급되지 않은 등록 행의 상태를 명확히 구분합니다.
 * 교체이력에 있는 모델은 재등록대기, 그 밖의 신규 등록 모델은 등록대기입니다.
 */
function normalizePendingRegistrationStatuses_(ss, db) {
  const rowCount = Math.max(0, db.getLastRow() - 1);
  if (!rowCount) return 0;
  const replacementModels = {};
  const history = ss.getSheetByName(SKU_REPLACEMENT_SHEET);
  if (history && history.getLastRow() > 1) {
    history.getRange(2, 3, history.getLastRow() - 1, 1).getDisplayValues().flat().forEach(value => {
      const alias = replacementModelAlias_(value);
      if (alias) replacementModels[alias] = true;
    });
  }
  const values = db.getRange(2, 1, rowCount, PRODUCT_DB_HEADERS.length).getValues();
  const skuColumn = dbColumn_('SKU ID');
  const modelColumn = dbColumn_('모델명/품번');
  const modelSkuColumn = dbColumn_('모델SKU');
  const matchColumn = dbColumn_('SKU매칭상태');
  let changed = 0;
  values.forEach(row => {
    if (!String(row[modelSkuColumn] || '').trim()) return;
    const current = String(row[matchColumn] || '').trim();
    const replacement = replacementModels[replacementModelAlias_(row[modelColumn])] || current.indexOf('재등록') >= 0;
    if (current === '이관 실패' && !replacement) return;
    const status = replacement
      ? '재등록대기' : '등록대기';
    if (String(row[matchColumn] || '').trim() !== status) {
      row[matchColumn] = status;
      changed++;
    }
  });
  if (changed) db.getRange(2, matchColumn + 1, rowCount, 1).setValues(values.map(row => [row[matchColumn]]));
  return changed;
}

/** 이미 아래쪽 기존 행에 덮어쓴 재등록 상품도 교체이력과 상태를 기준으로 맨 위에 복구합니다. */
function promoteReplacementPendingRows_(ss, db) {
  const rowCount = Math.max(0, db.getLastRow() - 1);
  if (!rowCount) return 0;
  const replacementModels = {};
  const history = ss.getSheetByName(SKU_REPLACEMENT_SHEET);
  if (history && history.getLastRow() > 1) {
    history.getRange(2, 3, history.getLastRow() - 1, 1).getDisplayValues().flat().forEach(value => {
      const model = String(value || '').trim();
      if (model) replacementModels[model] = true;
    });
  }
  const values = db.getRange(2, 1, rowCount, PRODUCT_DB_HEADERS.length).getValues();
  const modelColumn = dbColumn_('모델명/품번');
  const matchColumn = dbColumn_('SKU매칭상태');
  const skuColumn = dbColumn_('SKU ID');
  const orderColumn = dbColumn_('기본순서');
  const base = 7000000000000000 + Date.now();
  const modelOrders = {};
  let promoted = 0;
  values.forEach((row, index) => {
    const model = String(row[modelColumn] || '').trim();
    const pending = ['등록대기','재등록대기'].includes(String(row[matchColumn] || '').trim());
    const waitingForNewSku = !String(row[skuColumn] || '').trim();
    if (!model || (!pending && !(replacementModels[model] && waitingForNewSku))) return;
    if (!modelOrders[model]) modelOrders[model] = base - index;
    if (number_(row[orderColumn]) < 7000000000000000 && number_(row[orderColumn]) !== modelOrders[model]) {
      row[orderColumn] = modelOrders[model];
      promoted++;
    }
  });
  if (promoted) db.getRange(2, orderColumn + 1, rowCount, 1).setValues(values.map(row => [row[orderColumn]]));
  return promoted;
}

function sortProductDbDefault_(db) {
  const rowCount = Math.max(0, db.getLastRow() - 1);
  if (!rowCount) return;
  ensureProductDbDefaultOrder_(db);
  db.getRange(2, 1, rowCount, PRODUCT_DB_HEADERS.length)
    .sort([
      { column: dbColumn_('기본순서') + 1, ascending: false },
      { column: dbColumn_('모델명/품번') + 1, ascending: true },
      { column: dbColumn_('모델SKU') + 1, ascending: true },
    ]);
  applyProductDbCalculatedFormulas_(db);
}

/** 정렬 후에도 수식이 다른 행을 가리키지 않고 현재 행만 계산하게 합니다. */
function applyProductDbCalculatedFormulas_(db) {
  const rowCount = Math.max(0, db.getLastRow() - 1);
  if (!rowCount) return;
  const supplyFormulas = [];
  const marginFormulas = [];
  const saleOffsetFromSupply = dbColumn_('쿠팡 판매가') - dbColumn_('공급가');
  const supplyOffsetFromMargin = dbColumn_('공급가') - dbColumn_('마진');
  const costOffsetFromMargin = dbColumn_('원가(부가세포함)') - dbColumn_('마진');
  for (let row = 2; row < rowCount + 2; row++) {
    supplyFormulas.push([`=ROUND(RC[${saleOffsetFromSupply}]*0.58,0)`]);
    marginFormulas.push([`=RC[${supplyOffsetFromMargin}]-RC[${costOffsetFromMargin}]`]);
  }
  db.getRange(2, dbColumn_('공급가') + 1, rowCount, 1).setFormulasR1C1(supplyFormulas).setNumberFormat('#,##0');
  db.getRange(2, dbColumn_('마진') + 1, rowCount, 1).setFormulasR1C1(marginFormulas).setNumberFormat('#,##0');
}

function restoreProductDbDefaultOrder() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const db = getOrCreateSheet_(ss, '제품DB');
  syncProductDbHeaders_(db);
  const promoted = promoteReplacementPendingRows_(ss, db);
  sortProductDbDefault_(db);
  formatProductDb_(db);
  SpreadsheetApp.getUi().alert('제품DB를 기본순서로 복원했습니다. 최근 등록 상품과 기존상품 재등록 ' + promoted + '행이 위에 표시됩니다.');
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('LAURA')
    .addItem('제품DB 기본순서 복원', 'restoreProductDbDefaultOrder')
    .addToUi();
}

function normalizePickingCheckboxes_(sheet) {
  if (sheet.getLastRow() < 3) return;
  const rowCount = sheet.getLastRow() - 2;
  const skus = sheet.getRange(3, 6, rowCount, 1).getDisplayValues().flat();
  const checks = sheet.getRange(3, 14, rowCount, 1).getValues();
  skus.forEach((sku, index) => {
    if (!String(sku || '').trim()) return;
    const cell = sheet.getRange(index + 3, 14);
    const current = checks[index][0] === true;
    cell.clearDataValidations().setValue(current).insertCheckboxes();
  });
}

function syncHeaders_(sheet, headers) {
  ensureSheetSize_(sheet, 1, headers.length);
  const lastColumn = sheet.getLastColumn();
  if (lastColumn > headers.length) sheet.deleteColumns(headers.length + 1, lastColumn - headers.length);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
}

/** 제품DB는 기존 값을 헤더 이름에 맞춰 실제로 이동한 뒤 새 열 순서를 적용합니다. */
function syncProductDbHeaders_(sheet) {
  ensureSheetSize_(sheet, 1, PRODUCT_DB_HEADERS.length);
  const usedColumns = Math.max(sheet.getLastColumn(), PRODUCT_DB_HEADERS.length);
  const currentHeaders = sheet.getRange(1, 1, 1, usedColumns).getDisplayValues()[0].map(value => String(value || '').trim());
  const same = PRODUCT_DB_HEADERS.every((header, index) => currentHeaders[index] === header);
  if (same) return;
  const hasNamedHeaders = currentHeaders.some(header => PRODUCT_DB_HEADERS.includes(header));
  if (!hasNamedHeaders || sheet.getLastRow() < 2) {
    syncHeaders_(sheet, PRODUCT_DB_HEADERS);
    return;
  }
  const rowCount = sheet.getLastRow() - 1;
  const oldRange = sheet.getRange(2, 1, rowCount, usedColumns);
  const values = oldRange.getValues();
  const formulas = oldRange.getFormulas();
  const headerIndex = {};
  currentHeaders.forEach((header, index) => { if (header && headerIndex[header] === undefined) headerIndex[header] = index; });
  const reordered = values.map((row, rowIndex) => PRODUCT_DB_HEADERS.map(header => {
    const oldIndex = headerIndex[header];
    if (oldIndex === undefined) return '';
    return formulas[rowIndex][oldIndex] || row[oldIndex];
  }));
  oldRange.clearContent();
  syncHeaders_(sheet, PRODUCT_DB_HEADERS);
  sheet.getRange(2, 1, rowCount, PRODUCT_DB_HEADERS.length).setValues(reordered);
}

function ensureSheetSize_(sheet, rows, columns) {
  if (sheet.getMaxRows() < rows) sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows());
  if (sheet.getMaxColumns() < columns) sheet.insertColumnsAfter(sheet.getMaxColumns(), columns - sheet.getMaxColumns());
}

function findModelRow_(sheet, modelColumn, model) {
  if (!model || sheet.getLastRow() < 2) return 0;
  const values = sheet.getRange(2, modelColumn, sheet.getLastRow() - 1, 1).getDisplayValues().flat();
  const wanted = String(model).trim().toLowerCase();
  const index = values.findIndex(value => String(value).trim().toLowerCase() === wanted);
  return index < 0 ? 0 : index + 2;
}

function modelExists_(input, db, model) {
  return Boolean(findModelRow_(input, 5, model) || findModelRow_(db, 4, model));
}

function splitList_(value) {
  return String(value || '').split(/[,，]/).map(item => item.trim()).filter(Boolean);
}

function colorCode_(option) {
  const value = String(option || '').toLowerCase();
  const codes = [];
  if (value.includes('로즈') || value.includes('rose gold') || value.includes('rosegold')) codes.push('RG');
  else if (value.includes('골드') || value.includes('gold')) codes.push('GO');
  else if (value.includes('실버') || value.includes('silver')) codes.push('SI');
  if ((value.includes('화이트') || value.includes('white')) && codes.indexOf('WH') < 0) codes.push('WH');
  if ((value.includes('블랙') || value.includes('black')) && codes.indexOf('BK') < 0) codes.push('BK');
  if (codes.length) return codes.join('');
  return value.replace(/[^a-z0-9가-힣]/g, '').slice(0, 2).toUpperCase() || 'OP';
}

function sizeOptionCodes_(sizes) {
  const used = {};
  return (Array.isArray(sizes) ? sizes : []).map((size, index) => {
    const numeric = String(size || '').replace(/[^0-9]/g, '');
    const base = numeric || colorCode_(size) || ('SZ' + (index + 1));
    let code = base;
    let suffix = 2;
    while (used[code]) code = base + suffix++;
    used[code] = true;
    return code;
  });
}

function number_(value) {
  const number = Number(String(value || '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function cleanText_(value) {
  let text = String(value == null ? '' : value);
  text = text.replace(/&nbsp;/gi, ' ')
    .replace(/&#x([0-9a-f]+);/gi, function(_, code) { return String.fromCharCode(parseInt(code, 16)); })
    .replace(/&#(\d+);/g, function(_, code) { return String.fromCharCode(Number(code)); })
    .replace(/\u00a0/g, ' ')
    .replace(/\uB178\uC774\uB4DC\uBE44/gi, ' ');
  return text.replace(/[\t ]+/g, ' ').trim();
}

function normalizeTextColumn_(sheet, column) {
  const rowCount = Math.max(0, sheet.getLastRow() - 1);
  if (!rowCount || column < 1 || column > sheet.getLastColumn()) return 0;
  const range = sheet.getRange(2, column, rowCount, 1);
  const values = range.getValues();
  let changed = 0;
  values.forEach(row => {
    const cleaned = cleanText_(row[0]);
    if (String(row[0] == null ? '' : row[0]) !== cleaned) { row[0] = cleaned; changed++; }
  });
  if (changed) range.setValues(values);
  return changed;
}

function normalizeSupplierName_(value) {
  let supplier = String(value || '').trim();
  supplier = supplier.replace(/\s*\((?:여성|남성|여자|남자|남녀공용)\)\s*$/u, '').trim();
  if (!supplier || /^(?:부산|여성 거래처|남성 거래처|공용 거래처|공용거래처)$/u.test(supplier)) return '프리스타일';
  return supplier;
}

function normalizeSupplierColumn_(sheet, column) {
  const rowCount = Math.max(0, sheet.getLastRow() - 1);
  if (!rowCount) return 0;
  const range = sheet.getRange(2, column, rowCount, 1);
  const values = range.getValues();
  let changed = 0;
  values.forEach(row => {
    const normalized = normalizeSupplierName_(row[0]);
    if (String(row[0] || '').trim() !== normalized) { row[0] = normalized; changed++; }
  });
  if (changed) range.setValues(values);
  return changed;
}

function normalizeSuppliers_(input, db) {
  normalizeSupplierColumn_(input, 2);
  normalizeSupplierColumn_(db, dbColumn_('거래처') + 1);
}

function listSuppliers_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const input = getOrCreateSheet_(ss, '상품입력');
  const db = getOrCreateSheet_(ss, '제품DB');
  syncHeaders_(input, PRODUCT_INPUT_HEADERS);
  syncProductDbHeaders_(db);
  normalizeSuppliers_(input, db);
  const suppliers = ['프리스타일'];
  const add = value => {
    const normalized = normalizeSupplierName_(value);
    if (normalized && suppliers.indexOf(normalized) < 0) suppliers.push(normalized);
  };
  if (input.getLastRow() > 1) input.getRange(2, 2, input.getLastRow() - 1, 1).getDisplayValues().flat().forEach(add);
  if (db.getLastRow() > 1) db.getRange(2, dbColumn_('거래처') + 1, db.getLastRow() - 1, 1).getDisplayValues().flat().forEach(add);
  const rest = suppliers.filter(value => value !== '프리스타일').sort((a, b) => a.localeCompare(b));
  return json_({ ok: true, suppliers: ['프리스타일'].concat(rest) });
}

function normalizeQuoteQueuePayloads_(sheet) {
  const rowCount = Math.max(0, sheet.getLastRow() - 1);
  if (!rowCount) return;
  const range = sheet.getRange(2, 6, rowCount, 1);
  const values = range.getValues();
  let changed = false;
  values.forEach(row => {
    const before = String(row[0] || '');
    const after = before.replace(/\uB178\uC774\uB4DC\uBE44/gi, '').replace(/[\t ]+/g, ' ').trim();
    if (before !== after) { row[0] = after; changed = true; }
  });
  if (changed) range.setValues(values);
}

function normalizeStoredDrafts_() {
  const props = PropertiesService.getDocumentProperties();
  const values = props.getProperties();
  Object.keys(values).filter(key => key.indexOf('draft:') === 0).forEach(key => {
    const before = String(values[key] || '');
    const after = before.replace(/\uB178\uC774\uB4DC\uBE44/gi, '').replace(/[\t ]+/g, ' ');
    if (before !== after) props.setProperty(key, after);
  });
}

function purgeNonRocketSkus_(db, master) {
  const rows = dbMatrix_(db);
  const barcodeColumn = dbColumn_('바코드');
  const keptRows = rows.filter(row => !/^S/i.test(String(row[barcodeColumn] || '').trim()));
  const removedDb = rows.length - keptRows.length;
  if (removedDb) writeDbMatrix_(db, keptRows);

  const masterRows = master.getLastRow() > 1
    ? master.getRange(2, 1, master.getLastRow() - 1, SKU_MASTER_HEADERS.length).getValues() : [];
  const keptMaster = masterRows.filter(row => !/^S/i.test(String(row[2] || '').trim()));
  if (keptMaster.length) master.getRange(2, 1, keptMaster.length, SKU_MASTER_HEADERS.length).setValues(keptMaster);
  if (masterRows.length > keptMaster.length) {
    master.getRange(keptMaster.length + 2, 1, masterRows.length - keptMaster.length, SKU_MASTER_HEADERS.length).clearContent();
  }
  return { db: removedDb, master: masterRows.length - keptMaster.length };
}

function dbMatrix_(db) {
  if (db.getLastRow() < 2) return [];
  const range = db.getRange(2, 1, db.getLastRow() - 1, PRODUCT_DB_HEADERS.length);
  const values = range.getValues();
  const formulas = range.getFormulas();
  return values.map((row, rowIndex) => row.map((value, columnIndex) => formulas[rowIndex][columnIndex] || value));
}

function dbColumn_(name) {
  const index = PRODUCT_DB_HEADERS.indexOf(name);
  if (index < 0) throw new Error('제품DB 열을 찾을 수 없습니다: ' + name);
  return index;
}

function assertUniqueProductKeys_(rows, label) {
  const keys = ['모델SKU','SKU ID','옵션ID'];
  keys.forEach(name => {
    const column = dbColumn_(name);
    const seen = {};
    (Array.isArray(rows) ? rows : []).forEach(row => {
      const value = String(row[column] || '').trim();
      if (!value) return;
      if (seen[value]) throw new Error((label || '제품DB') + '의 ' + name + '가 중복됩니다: ' + value);
      seen[value] = true;
    });
  });
}

function dedupeProductDbRows_(sourceRows) {
  const rows = (Array.isArray(sourceRows) ? sourceRows : []).map(row => {
    const next = row.slice(0, PRODUCT_DB_HEADERS.length);
    while (next.length < PRODUCT_DB_HEADERS.length) next.push('');
    return next;
  });
  const removed = {};
  const maps = {};
  const priority = row => {
    let score = row.reduce((total, value) => total + (String(value == null ? '' : value).trim() ? 1 : 0), 0);
    if (String(row[dbColumn_('SKU매칭상태')] || '').indexOf('재등록대기') >= 0) score += 10000;
    if (String(row[dbColumn_('모델SKU')] || '').trim()) score += 1000;
    if (String(row[dbColumn_('SKU ID')] || '').trim()) score += 500;
    if (String(row[dbColumn_('옵션ID')] || '').trim()) score += 200;
    if (String(row[dbColumn_('창고번호')] || '').trim()) score += 50;
    return score;
  };
  ['모델SKU','SKU ID','옵션ID'].forEach(name => {
    const column = dbColumn_(name);
    maps[name] = {};
    rows.forEach((row, index) => {
      if (removed[index]) return;
      const value = String(row[column] || '').trim();
      if (!value) return;
      const keeperIndex = maps[name][value];
      if (keeperIndex === undefined) { maps[name][value] = index; return; }
      let keepIndex = keeperIndex;
      let dropIndex = index;
      if (priority(row) > priority(rows[keeperIndex])) { keepIndex = index; dropIndex = keeperIndex; maps[name][value] = index; }
      const keeper = rows[keepIndex];
      const dropped = rows[dropIndex];
      for (let field = 0; field < PRODUCT_DB_HEADERS.length; field++) {
        if (!String(keeper[field] == null ? '' : keeper[field]).trim() && String(dropped[field] == null ? '' : dropped[field]).trim()) keeper[field] = dropped[field];
      }
      removed[dropIndex] = true;
    });
  });
  return { rows: rows.filter((row, index) => !removed[index]), removed: Object.keys(removed).length };
}

function dedupeProductDbUniqueKeys_(db) {
  const result = dedupeProductDbRows_(dbMatrix_(db));
  if (result.removed) writeDbMatrix_(db, result.rows);
  return result.removed;
}

function retiredSkuSet_(ss) {
  const result = {};
  const history = ss.getSheetByName(SKU_REPLACEMENT_SHEET);
  if (!history || history.getLastRow() < 2) return result;
  history.getRange(2, 4, history.getLastRow() - 1, 1).getDisplayValues().flat().forEach(value => {
    const sku = String(value || '').trim();
    if (sku) result[sku] = true;
  });
  return result;
}

function replacementModelAlias_(value) {
  return String(value || '').trim().toLowerCase().replace(/^([a-z]+)0+(\d)/, '$1$2');
}

function purgeRetiredProductRows_(ss, db) {
  const retired = retiredSkuSet_(ss);
  const rows = dbMatrix_(db);
  const skuColumn = dbColumn_('SKU ID');
  const pendingModels = {};
  rows.forEach(row => {
    const model = replacementModelAlias_(row[dbColumn_('모델명/품번')]);
    const modelSku = String(row[dbColumn_('모델SKU')] || '').trim();
    const sku = String(row[skuColumn] || '').trim();
    if (model && modelSku && !sku) pendingModels[model] = true;
  });
  const replacementModelBySku = {};
  const history = ss.getSheetByName(SKU_REPLACEMENT_SHEET);
  if (history && history.getLastRow() > 1) {
    history.getRange(2, 1, history.getLastRow() - 1, Math.min(history.getLastColumn(), SKU_REPLACEMENT_HEADERS.length)).getDisplayValues().forEach(row => {
      const sku = String(row[3] || '').trim();
      if (sku) replacementModelBySku[sku] = replacementModelAlias_(row[2]);
    });
  }
  const kept = rows.filter(row => {
    const sku = String(row[skuColumn] || '').trim();
    return !retired[sku] || !pendingModels[replacementModelBySku[sku]];
  });
  const removed = rows.length - kept.length;
  if (removed) writeDbMatrix_(db, kept);
  return removed;
}

function repairReplacementDataFromHistory_(ss, db) {
  const history = ss.getSheetByName(SKU_REPLACEMENT_SHEET);
  if (!history || history.getLastRow() < 2) return { restoredFields: 0, restoredRows: 0 };
  const historyValues = history.getRange(2, 1, history.getLastRow() - 1, Math.min(history.getLastColumn(), SKU_REPLACEMENT_HEADERS.length)).getValues();
  const batches = {};
  historyValues.forEach((historyRow, index) => {
    const batchId = String(historyRow[7] || '').trim() || ('legacy:' + String(historyRow[1] || '') + '>' + String(historyRow[2] || ''));
    if (!batches[batchId]) batches[batchId] = { id: batchId, oldModel: String(historyRow[1] || ''), newModel: String(historyRow[2] || ''), lastIndex: index, rows: [] };
    batches[batchId].lastIndex = index;
    let parsed = null;
    if (historyRow[8]) {
      try { parsed = archivedProductDbRow_(JSON.parse(String(historyRow[8]))); } catch (error) { /* fallback below */ }
    }
    if (!parsed) {
      parsed = new Array(PRODUCT_DB_HEADERS.length).fill('');
      parsed[dbColumn_('모델명/품번')] = String(historyRow[1] || '');
      parsed[dbColumn_('SKU ID')] = String(historyRow[3] || '');
      parsed[dbColumn_('바코드')] = String(historyRow[4] || '');
      parsed[dbColumn_('창고번호')] = String(historyRow[5] || '');
    }
    batches[batchId].rows.push(parsed);
  });
  const latestByModel = {};
  Object.keys(batches).forEach(id => {
    const batch = batches[id];
    const alias = replacementModelAlias_(batch.newModel);
    if (!alias) return;
    if (!latestByModel[alias] || batch.lastIndex > latestByModel[alias].lastIndex) latestByModel[alias] = batch;
  });

  let rows = dbMatrix_(db);
  const skuColumn = dbColumn_('SKU ID');
  const modelColumn = dbColumn_('모델명/품번');
  const modelSkuColumn = dbColumn_('모델SKU');
  const activeModels = {};
  const pendingByModel = {};
  rows.forEach((row, index) => {
    const alias = replacementModelAlias_(row[modelColumn]);
    if (!alias) return;
    activeModels[alias] = true;
    if (!String(row[skuColumn] || '').trim() && String(row[modelSkuColumn] || '').trim()) {
      if (!pendingByModel[alias]) pendingByModel[alias] = [];
      pendingByModel[alias].push(index);
    }
  });

  let restoredFields = 0;
  Object.keys(pendingByModel).forEach(alias => {
    const batch = latestByModel[alias];
    if (!batch || !batch.rows.length) return;
    const indices = pendingByModel[alias];
    const current = indices.map(index => rows[index]);
    const merged = mergeReplacementRows_(current, batch.rows, false);
    merged.rows.forEach((mergedRow, position) => {
      const before = rows[indices[position]];
      ['현재고','누적입고','총입고','반출누계','누적발주','창고번호','SKU매칭상태'].forEach(name => {
        const column = dbColumn_(name);
        if (String(before[column] || '') !== String(mergedRow[column] || '') && String(mergedRow[column] || '').trim()) restoredFields++;
      });
      rows[indices[position]] = mergedRow;
    });
  });

  const existingSkus = {};
  rows.forEach(row => { const sku = String(row[skuColumn] || '').trim(); if (sku) existingSkus[sku] = true; });
  let restoredRows = 0;
  Object.keys(latestByModel).forEach(alias => {
    if (activeModels[alias]) return;
    latestByModel[alias].rows.forEach(oldRow => {
      const sku = String(oldRow[skuColumn] || '').trim();
      if (!sku || existingSkus[sku]) return;
      rows.push(oldRow.slice(0, PRODUCT_DB_HEADERS.length));
      existingSkus[sku] = true;
      restoredRows++;
    });
  });

  const result = dedupeProductDbRows_(rows);
  if (restoredFields || restoredRows || result.removed) writeDbMatrix_(db, result.rows);
  return { restoredFields: restoredFields, restoredRows: restoredRows, duplicatesRemoved: result.removed };
}

function removeRetiredSkuMatchRows_(ss, retired) {
  const sheet = ss.getSheetByName(SKU_MATCH_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, SKU_MATCH_HEADERS.length).getValues();
  const kept = values.filter(row => !retired[String(row[1] || '').trim()]);
  sheet.getRange(2, 1, sheet.getLastRow() - 1, SKU_MATCH_HEADERS.length).clearContent();
  if (kept.length) sheet.getRange(2, 1, kept.length, SKU_MATCH_HEADERS.length).setValues(kept);
}

function ensureDbRow_(rows, skuMap, sku, name) {
  let index = skuMap[String(sku || '').trim()];
  if (index !== undefined) return index;
  const row = Array(PRODUCT_DB_HEADERS.length).fill('');
  row[dbColumn_('SKU ID')] = String(sku || '').trim();
  row[dbColumn_('상품명')] = String(name || '');
  rows.push(row);
  index = rows.length - 1;
  skuMap[String(sku || '').trim()] = index;
  return index;
}

function writeDbMatrix_(db, rows) {
  const oldRows = Math.max(0, db.getLastRow() - 1);
  if (!rows.length) {
    if (oldRows) db.getRange(2, 1, oldRows, PRODUCT_DB_HEADERS.length).clearContent();
    return;
  }
  ensureSheetSize_(db, rows.length + 1, PRODUCT_DB_HEADERS.length);
  const normalizedRows = rows.map(source => {
    const row = source.slice(0, PRODUCT_DB_HEADERS.length);
    while (row.length < PRODUCT_DB_HEADERS.length) row.push('');
    row[dbColumn_('노출상품ID')] = normalizeSkuId_(row[dbColumn_('노출상품ID')]);
    row[dbColumn_('옵션ID')] = normalizeSkuId_(row[dbColumn_('옵션ID')]);
    return row;
  });
  db.getRange(2, dbColumn_('SKU ID') + 1, rows.length, 1).setNumberFormat('@');
  db.getRange(2, dbColumn_('바코드') + 1, rows.length, 1).setNumberFormat('@');
  db.getRange(2, dbColumn_('노출상품ID') + 1, rows.length, 2).setNumberFormat('@');
  db.getRange(2, 1, rows.length, PRODUCT_DB_HEADERS.length).setValues(normalizedRows);
  if (oldRows > rows.length) db.getRange(rows.length + 2, 1, oldRows - rows.length, PRODUCT_DB_HEADERS.length).clearContent();
  formatProductDb_(db);
  sortProductDbDefault_(db);
}

function normalizeSkuMatchText_(value) {
  return String(value || '').toLowerCase().replace(/\uB178\uC774\uB4DC\uBE44/g, '').replace(/[^0-9a-z가-힣]/g, '');
}

function scorePendingSkuMatch_(itemName, row) {
  const name = normalizeSkuMatchText_(itemName);
  const title = normalizeSkuMatchText_(row[dbColumn_('상품명')]);
  const color = normalizeSkuMatchText_(row[dbColumn_('색상')]);
  const size = normalizeSkuMatchText_(row[dbColumn_('주얼리사이즈')]);
  if (!name) return 0;
  const expected = normalizeSkuMatchText_([row[dbColumn_('상품명')], row[dbColumn_('색상')], row[dbColumn_('주얼리사이즈')]].join(' '));
  if (name === expected) return 100;
  let score = 0;
  if (title.length >= 5 && name.includes(title)) score = 82;
  else {
    const tokens = cleanText_(row[dbColumn_('상품명')]).toLowerCase().split(/[^0-9a-z가-힣]+/)
      .map(token => normalizeSkuMatchText_(token)).filter(token => token.length >= 2);
    const meaningful = [...new Set(tokens.filter(token => !['써지컬스틸','여성','남성','남녀공용'].includes(token)))];
    const matchedTokens = meaningful.filter(token => name.includes(token)).length;
    const ratio = meaningful.length ? matchedTokens / meaningful.length : 0;
    if (ratio < 0.5 || matchedTokens < 2) return 0;
    score = 55 + Math.round(ratio * 25);
  }
  if (color) score += name.includes(color) ? 12 : -10;
  if (size) {
    const sizeDigits = String(size).replace(/[^0-9]/g, '');
    if (sizeDigits) score += name.includes(sizeDigits) ? 12 : -8;
    else score += name.includes(size) ? 8 : 0;
  }
  return Math.max(0, Math.min(100, score));
}

function findPendingSkuMatch_(rows, itemName, candidateIndexes, availableCandidates) {
  const skuColumn = dbColumn_('SKU ID');
  const modelSkuColumn = dbColumn_('모델SKU');
  const matchColumn = dbColumn_('SKU매칭상태');
  const scored = [];
  const indexes = Array.isArray(candidateIndexes) ? candidateIndexes : rows.map((row, index) => index);
  indexes.forEach(index => {
    if (availableCandidates && !availableCandidates[index]) return;
    const row = rows[index];
    if (String(row[skuColumn] || '').trim() || !String(row[modelSkuColumn] || '').trim()) return;
    if (!['등록대기','재등록대기','이관 실패'].includes(String(row[matchColumn] || '').trim())) return;
    const score = scorePendingSkuMatch_(itemName, row);
    if (score >= 70) scored.push({ index: index, score: score });
  });
  scored.sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  const top = scored[0];
  const tied = scored.filter(item => item.score === top.score).length > 1;
  return { index: top.index, score: top.score, automatic: top.score >= 90 && !tied, tied: tied };
}

function writeSkuMatchLog_(ss, entries, resolvedSkus) {
  const sheet = getOrCreateSheet_(ss, SKU_MATCH_SHEET);
  syncHeaders_(sheet, SKU_MATCH_HEADERS);
  const existing = (sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, SKU_MATCH_HEADERS.length).getValues() : [])
    .filter(row => ['확인필요','미매칭','이관 실패'].includes(String(row[0] || '').trim()))
    .filter(row => !(resolvedSkus || {})[String(row[1] || '').trim()]);
  const map = {};
  existing.forEach((row, index) => { if (String(row[1] || '').trim()) map[String(row[1]).trim()] = index; });
  entries.filter(row => ['확인필요','미매칭','이관 실패'].includes(String(row[0] || '').trim())).forEach(row => {
    const sku = String(row[1] || '').trim();
    if (map[sku] === undefined) { map[sku] = existing.length; existing.push(row); }
    else existing[map[sku]] = row;
  });
  if (existing.length) {
    ensureSheetSize_(sheet, existing.length + 1, SKU_MATCH_HEADERS.length);
    sheet.getRange(2, 1, existing.length, SKU_MATCH_HEADERS.length).setValues(existing);
  }
  const oldCount = Math.max(0, sheet.getLastRow() - 1);
  if (oldCount > existing.length) sheet.getRange(existing.length + 2, 1, oldCount - existing.length, SKU_MATCH_HEADERS.length).clearContent();
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, SKU_MATCH_HEADERS.length).setFontWeight('bold').setFontColor('#ffffff').setBackground('#7f6000');
  sheet.autoResizeColumns(1, SKU_MATCH_HEADERS.length);
}

function importSkuMaster_(ss, db, items) {
  const master = getOrCreateSheet_(ss, SKU_MASTER_SHEET);
  syncHeaders_(master, SKU_MASTER_HEADERS);
  master.hideSheet();
  const originalMasterRows = master.getLastRow() > 1 ? master.getRange(2, 1, master.getLastRow() - 1, SKU_MASTER_HEADERS.length).getValues() : [];
  const masterRows = originalMasterRows.filter(row => !/^S/i.test(String(row[2] || '').trim()));
  const known = {};
  masterRows.forEach((row, index) => { const sku = String(row[0] || '').trim(); if (sku) known[sku] = index; });
  const bootstrap = masterRows.length === 0;
  const now = new Date();

  normalizePendingRegistrationStatuses_(ss, db);
  purgeRetiredProductRows_(ss, db);
  repairReplacementDataFromHistory_(ss, db);
  const originalRows = dbMatrix_(db);
  const retired = retiredSkuSet_(ss);
  const activeRows = originalRows.filter(row => {
    const nonRocket = /^S/i.test(String(row[dbColumn_('바코드')] || '').trim());
    return !nonRocket;
  });
  const dedupedActive = dedupeProductDbRows_(activeRows);
  const rows = dedupedActive.rows;
  const removedNonRocket = originalRows.length - activeRows.length;
  const duplicatesRemoved = dedupedActive.removed;
  const skuColumn = dbColumn_('SKU ID');
  const skuMap = {};
  rows.forEach((row, index) => { const sku = String(row[skuColumn] || '').trim(); if (sku) skuMap[sku] = index; });
  // 전체 제품DB를 SKU마다 반복 검색하지 않고 실제 연결대기 행만 한 번 색인합니다.
  const pendingCandidateIndexes = [];
  const availablePendingCandidates = {};
  rows.forEach((row, index) => {
    const waiting = !String(row[skuColumn] || '').trim()
      && String(row[dbColumn_('모델SKU')] || '').trim()
      && ['등록대기','재등록대기','이관 실패'].includes(String(row[dbColumn_('SKU매칭상태')] || '').trim());
    if (!waiting) return;
    pendingCandidateIndexes.push(index);
    availablePendingCandidates[index] = true;
  });
  const removed = {};
  const matchLog = [];
  const resolvedSkus = {};
  let inserted = 0;
  let updated = 0;
  let matched = 0;
  let review = 0;
  let newSkus = 0;
  let retiredSkipped = 0;

  (Array.isArray(items) ? items : []).filter(item => !/^S/i.test(String(item.barcode || '').trim())).forEach(item => {
    const sku = String(item.sku || '').trim();
    if (!sku) return;
    const itemName = cleanText_(item.name);
    const isNew = known[sku] === undefined;
    if (retired[sku]) {
      const masterRow = [sku,itemName,String(item.barcode || ''),String(item.status || ''),isNew ? now : masterRows[known[sku]][4],now];
      if (isNew) { known[sku] = masterRows.length; masterRows.push(masterRow); }
      else masterRows[known[sku]] = masterRow;
      retiredSkipped++;
      return;
    }
    if (isNew) newSkus++;
    const existingIndex = skuMap[sku];
    const existingHasModel = existingIndex !== undefined && String(rows[existingIndex][dbColumn_('모델SKU')] || '').trim();
    const candidate = !existingHasModel
      ? findPendingSkuMatch_(rows, itemName, pendingCandidateIndexes, availablePendingCandidates) : null;
    let targetIndex = existingIndex;

    if (candidate && candidate.automatic) {
      targetIndex = candidate.index;
      const registrationStatus = String(rows[targetIndex][dbColumn_('SKU매칭상태')] || '').indexOf('재등록') >= 0
        ? '재등록대기' : '등록대기';
      if (existingIndex !== undefined && existingIndex !== targetIndex) {
        ['창고번호','발주가능상태','제품링크','바코드','현재고','누적입고','총입고','반출누계','누적발주',
          '미입고','최근발주수량','최근입고일','이전쿠팡공급가','최근쿠팡공급가','공급가차이','공급가확인',
          '쿠팡 노출가','노출상품ID','옵션ID'].forEach(name => {
          const column = dbColumn_(name);
          if (!rows[targetIndex][column] && rows[existingIndex][column]) rows[targetIndex][column] = rows[existingIndex][column];
        });
        removed[existingIndex] = true;
      }
      rows[targetIndex][skuColumn] = sku;
      rows[targetIndex][dbColumn_('SKU매칭상태')] = registrationStatus;
      rows[targetIndex][dbColumn_('SKU매칭점수')] = candidate.score;
      rows[targetIndex][dbColumn_('SKU최초발견일')] = now;
      availablePendingCandidates[targetIndex] = false;
      skuMap[sku] = targetIndex;
      matched++;
      matchLog.push(['자동연결',sku,itemName,String(item.barcode || ''),String(rows[targetIndex][dbColumn_('모델SKU')] || ''),String(rows[targetIndex][dbColumn_('모델명/품번')] || ''),candidate.score,now,'상품명·옵션이 유일하게 일치']);
    } else if (candidate) {
      review++;
      availablePendingCandidates[candidate.index] = false;
      rows[candidate.index][dbColumn_('SKU매칭상태')] = '이관 실패';
      matchLog.push(['확인필요',sku,itemName,String(item.barcode || ''),String(rows[candidate.index][dbColumn_('모델SKU')] || ''),String(rows[candidate.index][dbColumn_('모델명/품번')] || ''),candidate.score,now,candidate.tied ? '동점 후보가 여러 개입니다.' : '유사하지만 자동연결 기준 미달']);
    } else if (isNew && !bootstrap) {
      matchLog.push(['이관 실패',sku,itemName,String(item.barcode || ''),'','',0,now,'등록대기 상품에서 후보를 찾지 못했습니다. 후보 모델SKU를 입력한 뒤 처리상태를 연결승인으로 바꾸세요.']);
    }

    if (candidate && !candidate.automatic) {
      const masterRow = [sku,itemName,String(item.barcode || ''),String(item.status || ''),isNew ? now : masterRows[known[sku]][4],now];
      if (isNew) { known[sku] = masterRows.length; masterRows.push(masterRow); }
      else masterRows[known[sku]] = masterRow;
      return;
    }
    if (targetIndex === undefined) {
      if (!isNew) matchLog.push(['이관 실패',sku,itemName,String(item.barcode || ''),'','',0,now,'제품DB 등록대기 행을 찾지 못했습니다. 후보 모델SKU를 입력한 뒤 처리상태를 연결승인으로 바꾸세요.']);
      const masterRow = [sku,itemName,String(item.barcode || ''),String(item.status || ''),isNew ? now : masterRows[known[sku]][4],now];
      if (isNew) { known[sku] = masterRows.length; masterRows.push(masterRow); }
      else masterRows[known[sku]] = masterRow;
      review++;
      return;
    }
    updated++;
    const row = rows[targetIndex];
    row[skuColumn] = sku;
    row[dbColumn_('상품명')] = itemName || cleanText_(row[dbColumn_('상품명')]);
    row[dbColumn_('바코드')] = String(item.barcode || '');
    row[dbColumn_('발주가능상태')] = String(item.status || '');
    if (!candidate) {
      row[dbColumn_('SKU매칭상태')] = String(row[dbColumn_('SKU매칭상태')] || '').indexOf('재등록') >= 0
        ? '재등록대기' : '등록대기';
      row[dbColumn_('SKU매칭점수')] = 100;
    }
    if (String(row[dbColumn_('모델SKU')] || '').trim() && !(candidate && !candidate.automatic)) resolvedSkus[sku] = true;

    const masterRow = [sku,itemName,String(item.barcode || ''),String(item.status || ''),isNew ? now : masterRows[known[sku]][4],now];
    if (isNew) { known[sku] = masterRows.length; masterRows.push(masterRow); }
    else masterRows[known[sku]] = masterRow;
  });

  const finalRows = dedupeProductDbRows_(rows.filter((row, index) => !removed[index])).rows;
  writeDbMatrix_(db, finalRows);
  refreshPurchasePrintProductLinks_(ss, db);
  if (masterRows.length) {
    ensureSheetSize_(master, masterRows.length + 1, SKU_MASTER_HEADERS.length);
    master.getRange(2, 1, masterRows.length, SKU_MASTER_HEADERS.length).setValues(masterRows);
  }
  if (originalMasterRows.length > masterRows.length) {
    master.getRange(masterRows.length + 2, 1, originalMasterRows.length - masterRows.length, SKU_MASTER_HEADERS.length).clearContent();
  }
  removeRetiredSkuMatchRows_(ss, retired);
  writeSkuMatchLog_(ss, matchLog, resolvedSkus);
  return json_({ ok: true, inserted: inserted, updated: updated, total: finalRows.length,
    baseline: bootstrap, newSkus: bootstrap ? 0 : newSkus, matched: matched, review: review,
    retiredSkipped: retiredSkipped,
    duplicatesRemoved: duplicatesRemoved,
    removedNonRocket: removedNonRocket + (originalMasterRows.length - masterRows.length) });
}

function normalizeLegacyGender_(value) {
  const text = String(value || '').trim();
  if (text === '여성용') return '여성';
  if (text === '남성용') return '남성';
  if (text === '남녀공용') return '남녀공용';
  return text;
}

function importLegacyProducts_(ss, db, items) {
  const retired = retiredSkuSet_(ss);
  const skuColumn = dbColumn_('SKU ID');
  const originalRows = dbMatrix_(db);
  const activeRows = originalRows.filter(row => !retired[String(row[skuColumn] || '').trim()]);
  const deduped = dedupeProductDbRows_(activeRows);
  const rows = deduped.rows;
  const removedRetired = originalRows.length - activeRows.length;
  const skuMap = {};
  rows.forEach((row, index) => {
    const sku = String(row[skuColumn] || '').trim();
    if (sku) skuMap[sku] = index;
  });

  const ensureRow = (sku) => {
    if (skuMap[sku] !== undefined) return skuMap[sku];
    const row = new Array(PRODUCT_DB_HEADERS.length).fill('');
    row[skuColumn] = sku;
    rows.push(row);
    skuMap[sku] = rows.length - 1;
    return rows.length - 1;
  };
  const setBlank = (row, columnName, value) => {
    const text = cleanText_(value);
    if (!text) return false;
    const column = dbColumn_(columnName);
    if (String(row[column] || '').trim()) return false;
    row[column] = text;
    return true;
  };

  let matched = 0;
  let inserted = 0;
  let fieldsFilled = 0;
  let retiredSkipped = 0;
  (Array.isArray(items) ? items : []).forEach(item => {
    const sku = String(item.sku || '').trim();
    if (!/^\d+$/.test(sku)) return;
    if (retired[sku]) { retiredSkipped++; return; }
    const existed = skuMap[sku] !== undefined;
    const index = ensureRow(sku);
    if (existed) matched++; else inserted++;
    const row = rows[index];
    fieldsFilled += setBlank(row, '거래처', item.supplier) ? 1 : 0;
    fieldsFilled += setBlank(row, '성별', normalizeLegacyGender_(item.gender)) ? 1 : 0;
    fieldsFilled += setBlank(row, '카테고리', item.category) ? 1 : 0;
    fieldsFilled += setBlank(row, '모델명/품번', item.model) ? 1 : 0;
    fieldsFilled += setBlank(row, '모델SKU', item.modelSku) ? 1 : 0;
    fieldsFilled += setBlank(row, '상품명', item.name) ? 1 : 0;
    fieldsFilled += setBlank(row, '색상', item.color) ? 1 : 0;
    fieldsFilled += setBlank(row, '치수', item.dimensions) ? 1 : 0;
    fieldsFilled += setBlank(row, '원가(부가세포함)', item.cost) ? 1 : 0;
    fieldsFilled += setBlank(row, '쿠팡 판매가', item.salePrice) ? 1 : 0;
    fieldsFilled += setBlank(row, '공급가', item.supplyPrice) ? 1 : 0;
    fieldsFilled += setBlank(row, '발주가능상태', item.status) ? 1 : 0;
    fieldsFilled += setBlank(row, '제품링크', item.productLink) ? 1 : 0;
    fieldsFilled += setBlank(row, '바코드', item.barcode) ? 1 : 0;
    const warehouse = String(item.warehouse || '').trim();
    if (warehouse && !String(row[dbColumn_('창고번호')] || '').trim()) { row[dbColumn_('창고번호')] = warehouse; fieldsFilled++; }
    const cost = number_(row[dbColumn_('원가(부가세포함)')]);
    const supply = number_(row[dbColumn_('공급가')]);
    if (!String(row[dbColumn_('마진')] || '').trim() && (cost || supply)) row[dbColumn_('마진')] = supply - cost;
  });

  const finalResult = dedupeProductDbRows_(rows);
  writeDbMatrix_(db, finalResult.rows);
  normalizeRecentInboundDates_(db);
  refreshPurchasePrintProductLinks_(ss, db);
  return json_({ ok: true, matched: matched, inserted: inserted, fieldsFilled: fieldsFilled, total: finalResult.rows.length,
    retiredSkipped: retiredSkipped, removedRetired: removedRetired,
    duplicatesRemoved: deduped.removed + finalResult.removed });
}

function importVerifiedCatalog_(db, items) {
  const rowCount = Math.max(0, db.getLastRow() - 1);
  if (!rowCount) return json_({ ok: true, matched: 0, imageUpdated: 0, exposurePriceUpdated: 0, missing: 0 });

  const skuColumn = dbColumn_('SKU ID');
  const imageColumn = dbColumn_('이미지');
  const exposurePriceColumn = dbColumn_('쿠팡 노출가');
  const productIdColumn = dbColumn_('노출상품ID');
  const optionIdColumn = dbColumn_('옵션ID');
  const skus = db.getRange(2, skuColumn + 1, rowCount, 1).getDisplayValues().flat();
  const imageRange = db.getRange(2, imageColumn + 1, rowCount, 1);
  const imageValues = imageRange.getValues();
  const imageFormulas = imageRange.getFormulas();
  const imageOutput = imageValues.map((row, index) => [imageFormulas[index][0] || row[0] || '']);
  const priceRange = db.getRange(2, exposurePriceColumn + 1, rowCount, 1);
  const priceValues = priceRange.getValues();
  const productIdRange = db.getRange(2, productIdColumn + 1, rowCount, 1);
  const optionIdRange = db.getRange(2, optionIdColumn + 1, rowCount, 1);
  const productIdValues = productIdRange.getDisplayValues();
  const optionIdValues = optionIdRange.getDisplayValues();
  const dbValues = db.getRange(2, 1, rowCount, PRODUCT_DB_HEADERS.length).getValues();
  const skuRows = {};
  skus.forEach((sku, index) => { const key = String(sku || '').trim(); if (key) skuRows[key] = index; });

  let matched = 0;
  let imageUpdated = 0;
  let exposurePriceUpdated = 0;
  let driveImagePreserved = 0;
  let productIdUpdated = 0;
  let optionIdUpdated = 0;
  let matchedByProductId = 0;
  let missing = 0;
  const handled = {};
  const applyItem = (item, index) => {
    if (index === undefined || index < 0) { missing++; return; }
    const sku = String(item.sku || '').trim();
    const handledKey = sku || ('row:' + index);
    if (!handled[handledKey]) { handled[handledKey] = true; matched++; }

    const productId = String(item.productId || '').trim();
    const optionId = String(item.optionId || '').trim();
    if (productId && String(productIdValues[index][0] || '').trim() !== productId) {
      productIdValues[index][0] = productId;
      productIdUpdated++;
    }
    if (optionId && String(optionIdValues[index][0] || '').trim() !== optionId) {
      optionIdValues[index][0] = optionId;
      optionIdUpdated++;
    }

    const imageUrl = String(item.imageUrl || '').trim();
    if (/^https:\/\//i.test(imageUrl)) {
      const currentFormula = String(imageFormulas[index][0] || '');
      if (/drive\.google\.com/i.test(currentFormula)) {
        imageOutput[index][0] = currentFormula;
        driveImagePreserved++;
      } else if (!currentFormula || /coupangcdn\.com/i.test(currentFormula)) {
        imageOutput[index][0] = '=IMAGE("' + imageUrl.replace(/"/g, '') + '",4,80,80)';
        imageUpdated++;
      } else {
        imageOutput[index][0] = currentFormula;
      }
    } else if (imageFormulas[index][0]) {
      imageOutput[index][0] = imageFormulas[index][0];
    }

    const exposurePrice = number_(item.exposurePrice);
    if (exposurePrice > 0) {
      if (number_(priceValues[index][0]) !== exposurePrice) exposurePriceUpdated++;
      priceValues[index][0] = exposurePrice;
    }
  };

  const incoming = Array.isArray(items) ? items : [];
  // SKU가 있는 행을 먼저 반영해 제품DB에 노출상품ID 묶음을 만든 뒤, SKU가 없는 옵션을 찾습니다.
  incoming.filter(item => String(item.sku || '').trim()).forEach(item => {
    const index = skuRows[String(item.sku || '').trim()];
    applyItem(item, index);
  });
  incoming.filter(item => !String(item.sku || '').trim()).forEach(item => {
    const productId = String(item.productId || '').trim();
    if (!productId) { missing++; return; }
    const candidates = [];
    productIdValues.forEach((value, index) => {
      if (String(value[0] || '').trim() !== productId) return;
      if (String(item.optionId || '').trim() && String(optionIdValues[index][0] || '').trim() === String(item.optionId).trim()) {
        candidates.push({ index: index, score: 10000 });
        return;
      }
      const score = scorePendingSkuMatch_(String(item.name || ''), dbValues[index]);
      candidates.push({ index: index, score: score });
    });
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const second = candidates[1];
    const uniqueBest = best && (best.score > 0 ? (!second || best.score > second.score) : candidates.length === 1);
    if (!uniqueBest) { missing++; return; }
    matchedByProductId++;
    applyItem(item, best.index);
  });

  imageRange.setValues(imageOutput);
  priceRange.setValues(priceValues).setNumberFormat('#,##0');
  productIdRange.setValues(productIdValues).setNumberFormat('@');
  optionIdRange.setValues(optionIdValues).setNumberFormat('@');
  normalizeCatalogIdColumns_(db);
  const duplicatesRemoved = dedupeProductDbUniqueKeys_(db);
  formatProductDb_(db);
  sortProductDbDefault_(db);
  return json_({ ok: true, matched: matched, imageUpdated: imageUpdated,
    exposurePriceUpdated: exposurePriceUpdated, driveImagePreserved: driveImagePreserved, missing: missing,
    productIdUpdated: productIdUpdated, optionIdUpdated: optionIdUpdated, matchedByProductId: matchedByProductId,
    duplicatesRemoved: duplicatesRemoved });
}

function importInboundSummary_(ss, db, data) {
  const history = getOrCreateSheet_(ss, INBOUND_HISTORY_SHEET);
  syncHeaders_(history, INBOUND_HISTORY_HEADERS);
  history.hideSheet();
  const datasets = Array.isArray(data.datasets) ? data.datasets : [{ fingerprint: data.fingerprint, items: data.items || [] }];
  const knownFingerprints = history.getLastRow() > 1
    ? history.getRange(2, 1, history.getLastRow() - 1, 1).getDisplayValues().flat().map(value => String(value || '').trim()) : [];
  const now = new Date();
  const incoming = [];
  let importedDatasets = 0;
  let skippedDatasets = 0;
  datasets.forEach(dataset => {
    const fingerprint = String(dataset.fingerprint || '').trim();
    if (!fingerprint) return;
    if (knownFingerprints.includes(fingerprint)) { skippedDatasets++; return; }
    importedDatasets++;
    knownFingerprints.push(fingerprint);
    (Array.isArray(dataset.items) ? dataset.items : []).forEach(item => {
      if (!String(item.sku || '').trim()) return;
      incoming.push([
        fingerprint, String(item.sku || ''), String(item.name || ''), number_(item.totalInbound), number_(item.outbound),
        number_(item.netInbound), String(item.lastDate || ''), String(item.previousSupplyDate || ''), number_(item.previousSupplyPrice),
        String(item.latestSupplyDate || item.lastDate || ''), number_(item.latestSupplyPrice), now
      ]);
    });
  });
  if (!importedDatasets) {
    normalizeRecentInboundDates_(db);
    return json_({ ok: true, skipped: true, importedDatasets: 0, skippedDatasets: skippedDatasets });
  }
  if (incoming.length) history.getRange(history.getLastRow() + 1, 1, incoming.length, INBOUND_HISTORY_HEADERS.length).setValues(incoming);

  const all = history.getLastRow() > 1 ? history.getRange(2, 1, history.getLastRow() - 1, INBOUND_HISTORY_HEADERS.length).getValues() : [];
  const totals = {};
  all.forEach(row => {
    const sku = String(row[1] || '').trim();
    if (!sku) return;
    const current = totals[sku] || { name: row[2], inbound: 0, outbound: 0, lastDate: '', prices: [] };
    current.inbound += number_(row[3]);
    current.outbound += number_(row[4]);
    const inboundDate = dateOnlyText_(row[6]);
    if (inboundDate > current.lastDate) current.lastDate = inboundDate;
    if (number_(row[8]) > 0) current.prices.push({ date: dateOnlyText_(row[7] || row[6]), price: number_(row[8]) });
    if (number_(row[10]) > 0) current.prices.push({ date: dateOnlyText_(row[9] || row[6]), price: number_(row[10]) });
    totals[sku] = current;
  });

  const rows = dbMatrix_(db);
  const skuColumn = dbColumn_('SKU ID');
  const skuMap = {};
  rows.forEach((row, index) => { const sku = String(row[skuColumn] || '').trim(); if (sku) skuMap[sku] = index; });
  Object.keys(totals).forEach(sku => {
    const item = totals[sku];
    const index = ensureDbRow_(rows, skuMap, sku, item.name);
    const row = rows[index];
    const prices = item.prices.sort((a, b) => a.date.localeCompare(b.date));
    const latest = prices.length ? prices[prices.length - 1].price : 0;
    const previous = prices.length > 1 ? prices[prices.length - 2].price : 0;
    row[dbColumn_('총입고')] = item.inbound;
    row[dbColumn_('반출누계')] = item.outbound;
    row[dbColumn_('누적입고')] = item.inbound - item.outbound;
    row[dbColumn_('최근입고일')] = dateOnlyText_(item.lastDate);
    row[dbColumn_('이전쿠팡공급가')] = previous || '';
    row[dbColumn_('최근쿠팡공급가')] = latest || '';
    row[dbColumn_('공급가차이')] = latest && previous ? latest - previous : '';
    row[dbColumn_('공급가확인')] = latest && previous ? (latest === previous ? '일치' : '확인필요') : '기준없음';
  });
  writeDbMatrix_(db, rows);
  normalizeRecentInboundDates_(db);
  return json_({ ok: true, skipped: false, imported: incoming.length, importedDatasets: importedDatasets, skippedDatasets: skippedDatasets });
}

function dateOnlyText_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || 'Asia/Seoul', 'yyyy/MM/dd');
  }
  const text = String(value || '').trim();
  const match = text.match(/(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/);
  if (match) return match[1] + '/' + String(match[2]).padStart(2, '0') + '/' + String(match[3]).padStart(2, '0');
  const parsed = new Date(text);
  if (text && !isNaN(parsed.getTime())) return Utilities.formatDate(parsed, Session.getScriptTimeZone() || 'Asia/Seoul', 'yyyy/MM/dd');
  return text;
}

function normalizeRecentInboundDates_(db) {
  const rowCount = Math.max(0, db.getLastRow() - 1);
  if (!rowCount) return;
  const column = dbColumn_('최근입고일') + 1;
  const range = db.getRange(2, column, rowCount, 1);
  const values = range.getValues().map(row => [dateOnlyText_(row[0])]);
  range.setValues(values).setNumberFormat('yyyy/MM/dd');
}

function purchaseDateOnly_(value) {
  const text = String(value || '').trim();
  const match = text.match(/\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2}/);
  return match ? match[0].replace(/[.\-]/g, '/') : (text || '날짜미확인');
}

function purchaseDateNumber_(value) {
  const text = purchaseDateOnly_(value);
  const match = String(text).match(/(20\d{2})\D+(\d{1,2})\D+(\d{1,2})/);
  return match ? Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3]) : 99999999;
}

function purchaseDateTimeNumber_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value.getTime();
  const text = String(value || '');
  const match = text.match(/(20\d{2})\D+(\d{1,2})\D+(\d{1,2})(?:\D+(\d{1,2}))?(?:\D+(\d{1,2}))?/);
  if (!match) return 0;
  let hour = Number(match[4] || 0);
  if (/오후/.test(text) && hour < 12) hour += 12;
  if (/오전/.test(text) && hour === 12) hour = 0;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, Number(match[5] || 0)).getTime();
}

function formatCouponIssueSheet_(sheet) {
  syncHeaders_(sheet, COUPON_ISSUE_HEADERS);
  sheet.setFrozenRows(1);
  sheet.setHiddenGridlines(true);
  sheet.getRange(1, 1, 1, COUPON_ISSUE_HEADERS.length)
    .setFontWeight('bold').setFontColor('#ffffff').setBackground('#4f6258').setHorizontalAlignment('center');
  sheet.setColumnWidth(1, 120);
  sheet.setColumnWidth(2, 145);
  sheet.setColumnWidth(3, 420);
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).setNumberFormat('yyyy/MM/dd');
    sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).setNumberFormat('@');
    sheet.getRange(2, 1, sheet.getLastRow() - 1, COUPON_ISSUE_HEADERS.length).setVerticalAlignment('middle').setWrap(true);
    sheet.setRowHeights(2, sheet.getLastRow() - 1, 30);
  }
}

function ensureWeeklyCouponTrigger_(ss) {
  PropertiesService.getDocumentProperties().setProperty('couponSpreadsheetId', ss.getId());
  const handler = 'updateWeeklyCouponIssue';
  const exists = ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === handler);
  if (!exists) {
    ScriptApp.newTrigger(handler).timeBased().onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(9).create();
  }
}

/** 매주 금요일 오전 9시에 실행됩니다. 수동 실행해도 이번 주 자료를 즉시 갱신합니다. */
function updateWeeklyCouponIssue() {
  const props = PropertiesService.getDocumentProperties();
  const spreadsheetId = props.getProperty('couponSpreadsheetId');
  const ss = spreadsheetId ? SpreadsheetApp.openById(spreadsheetId) : SpreadsheetApp.getActiveSpreadsheet();
  return updateWeeklyCouponIssue_(ss, new Date());
}

function updateWeeklyCouponIssue_(ss, referenceDate) {
  if (!ss) throw new Error('쿠폰발행 대상 Google 시트를 찾을 수 없습니다.');
  const history = ss.getSheetByName(PO_HISTORY_SHEET);
  const sheet = getOrCreateSheet_(ss, COUPON_ISSUE_SHEET);
  formatCouponIssueSheet_(sheet);
  if (!history || history.getLastRow() < 2) return { added: 0, updated: 0, total: Math.max(0, sheet.getLastRow() - 1) };

  const now = referenceDate instanceof Date ? new Date(referenceDate.getTime()) : new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  const dateNumber = date => Number(Utilities.formatDate(date, Session.getScriptTimeZone() || 'Asia/Seoul', 'yyyyMMdd'));
  const start = dateNumber(monday);
  const end = dateNumber(sunday);

  const existing = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, COUPON_ISSUE_HEADERS.length).getValues() : [];
  const rows = [];
  const skuMap = {};
  existing.forEach(row => {
    const sku = String(row[1] || '').trim();
    if (!sku) return;
    const normalized = [dateOnlyText_(row[0]), sku, cleanText_(row[2])];
    if (skuMap[sku] === undefined) { skuMap[sku] = rows.length; rows.push(normalized); }
    else if (purchaseDateNumber_(normalized[0]) > purchaseDateNumber_(rows[skuMap[sku]][0])) rows[skuMap[sku]] = normalized;
  });

  let added = 0;
  let updated = 0;
  const historyRows = history.getRange(2, 1, history.getLastRow() - 1, PO_HISTORY_HEADERS.length).getValues();
  historyRows.forEach(row => {
    const expectedDate = dateOnlyText_(row[7]);
    const expectedNumber = purchaseDateNumber_(expectedDate);
    const sku = String(row[2] || '').trim();
    if (!sku || expectedNumber < start || expectedNumber > end) return;
    const next = [expectedDate, sku, cleanText_(row[5])];
    const index = skuMap[sku];
    if (index === undefined) { skuMap[sku] = rows.length; rows.push(next); added++; }
    else {
      const before = rows[index];
      if (String(before[0]) !== expectedDate || String(before[2]) !== String(next[2])) { rows[index] = next; updated++; }
    }
  });

  rows.sort((a, b) => purchaseDateNumber_(b[0]) - purchaseDateNumber_(a[0]) || String(a[1]).localeCompare(String(b[1])));
  const oldCount = Math.max(0, sheet.getLastRow() - 1);
  if (oldCount) sheet.getRange(2, 1, oldCount, COUPON_ISSUE_HEADERS.length).clearContent();
  if (rows.length) sheet.getRange(2, 1, rows.length, COUPON_ISSUE_HEADERS.length).setValues(rows);
  formatCouponIssueSheet_(sheet);
  return { added: added, updated: updated, total: rows.length, weekStart: dateOnlyText_(monday), weekEnd: dateOnlyText_(sunday) };
}

function productDisplayName_(row, fallback) {
  if (!row) return String(fallback || '');
  const title = String(row[dbColumn_('상품명')] || '').trim();
  const titleNormalized = normalizeSkuMatchText_(title);
  const extras = [row[dbColumn_('색상')], row[dbColumn_('주얼리사이즈')]].map(value => String(value || '').trim())
    .filter(value => value && !titleNormalized.includes(normalizeSkuMatchText_(value)));
  return [title].concat(extras).filter(Boolean).join(' · ');
}

function purchaseProductMap_(db) {
  const productMap = {};
  const rowCount = Math.max(0, db.getLastRow() - 1);
  if (!rowCount) return productMap;
  const rows = dbMatrix_(db);
  const skuValues = db.getRange(2, dbColumn_('SKU ID') + 1, rowCount, 1).getDisplayValues();
  const warehouseValues = db.getRange(2, dbColumn_('창고번호') + 1, rowCount, 1).getDisplayValues();
  const barcodeValues = db.getRange(2, dbColumn_('바코드') + 1, rowCount, 1).getDisplayValues();
  rows.forEach((row, index) => {
    const sku = String(skuValues[index][0] || '').trim();
    row[dbColumn_('SKU ID')] = sku;
    row[dbColumn_('창고번호')] = warehouseValues[index][0];
    row[dbColumn_('바코드')] = barcodeValues[index][0];
    if (sku) productMap[sku] = row;
  });
  return productMap;
}

/** 제품DB의 최신 SKU 연결값을 기존 발주서 출력행에 즉시 다시 반영합니다. */
function refreshPurchasePrintProductLinks_(ss, db) {
  const sheet = ss.getSheetByName(PO_PICKING_SHEET);
  if (!sheet || sheet.getLastRow() < 3) return 0;
  const productMap = purchaseProductMap_(db);
  const rowCount = sheet.getLastRow() - 2;
  const dataRange = sheet.getRange(3, 1, rowCount, PO_PICKING_HEADERS.length);
  const values = dataRange.getValues();
  const displays = dataRange.getDisplayValues();
  const runs = [];
  let currentRun = null;
  const registeredCells = [];
  const missingCells = [];
  let updated = 0;
  displays.forEach((displayRow, index) => {
    const sku = String(displayRow[5] || '').trim();
    if (!sku) { currentRun = null; return; }
    if (!currentRun || currentRun.end !== index - 1) {
      currentRun = { start: index, end: index };
      runs.push(currentRun);
    } else currentRun.end = index;
    const product = productMap[sku];
    const rowNumber = index + 3;
    const warehouse = product ? String(product[dbColumn_('창고번호')] || '').trim() : '';
    values[index][4] = warehouse || '미등록';
    (warehouse ? registeredCells : missingCells).push('E' + rowNumber);
    if (product) {
      values[index][6] = productDisplayName_(product, displayRow[6]);
      values[index][7] = String(product[dbColumn_('바코드')] || '');
      values[index][8] = number_(product[dbColumn_('원가(부가세포함)')]);
      values[index][12] = String(product[dbColumn_('거래처')] || '');
      updated++;
    }
  });
  // 합배송 제목행은 병합되어 있으므로 실제 SKU 데이터행 묶음만 일괄 기록합니다.
  runs.forEach(run => {
    const startRow = run.start + 3;
    const length = run.end - run.start + 1;
    const rows = values.slice(run.start, run.end + 1);
    sheet.getRange(startRow, 5, length, 1).setValues(rows.map(row => [row[4]]));
    sheet.getRange(startRow, 7, length, 3).setValues(rows.map(row => row.slice(6, 9)));
    sheet.getRange(startRow, 13, length, 1).setValues(rows.map(row => [row[12]]));
  });
  if (registeredCells.length) sheet.getRangeList(registeredCells).setBackground(null);
  if (missingCells.length) sheet.getRangeList(missingCells).setBackground('#f4cccc');
  return updated;
}

function applyPurchaseAggregates_(db, aggregates) {
  const rowCount = Math.max(0, db.getLastRow() - 1);
  const skuValues = rowCount ? db.getRange(2, dbColumn_('SKU ID') + 1, rowCount, 1).getDisplayValues() : [];
  const titleValues = rowCount ? db.getRange(2, dbColumn_('상품명') + 1, rowCount, 1).getValues() : [];
  const barcodeValues = rowCount ? db.getRange(2, dbColumn_('바코드') + 1, rowCount, 1).getValues() : [];
  const trackingStart = dbColumn_('누적발주') + 1;
  const trackingWidth = dbColumn_('공급가확인') - dbColumn_('누적발주') + 1;
  const trackingValues = rowCount ? db.getRange(2, trackingStart, rowCount, trackingWidth).getValues() : [];
  const skuMap = {};
  skuValues.forEach((row, index) => { const sku = String(row[0] || '').trim(); if (sku) skuMap[sku] = index; });
  const newRows = [];

  Object.keys(aggregates).forEach(sku => {
    const item = aggregates[sku];
    const latestDate = Object.keys(item.dates).sort().pop() || '';
    const prices = item.prices.sort((a, b) => a.date.localeCompare(b.date));
    const latest = prices.length ? prices[prices.length - 1].price : 0;
    const index = skuMap[sku];
    if (index === undefined) {
      const row = new Array(PRODUCT_DB_HEADERS.length).fill('');
      row[dbColumn_('상품명')] = item.name;
      row[dbColumn_('SKU ID')] = sku;
      row[dbColumn_('바코드')] = item.barcode;
      row[dbColumn_('누적발주')] = item.order;
      row[dbColumn_('미입고')] = item.missing;
      row[dbColumn_('최근발주수량')] = number_(item.dates[latestDate]);
      row[dbColumn_('최근쿠팡공급가')] = latest || '';
      row[dbColumn_('공급가확인')] = '기준없음';
      newRows.push(row);
      return;
    }
    if (!String(titleValues[index][0] || '').trim()) titleValues[index][0] = item.name;
    if (!String(barcodeValues[index][0] || '').trim()) barcodeValues[index][0] = item.barcode;
    const tracking = trackingValues[index];
    const existingLatest = number_(tracking[5]);
    const existingPrevious = number_(tracking[4]);
    const previous = prices.length > 1 ? prices[prices.length - 2].price : (latest !== existingLatest ? existingLatest : existingPrevious);
    tracking[0] = item.order;
    tracking[1] = item.missing;
    tracking[2] = number_(item.dates[latestDate]);
    tracking[4] = previous || '';
    tracking[5] = latest || existingLatest || '';
    tracking[6] = latest && previous ? latest - previous : '';
    tracking[7] = latest && previous ? (latest === previous ? '일치' : '확인필요') : '기준없음';
  });

  if (rowCount) {
    db.getRange(2, dbColumn_('상품명') + 1, rowCount, 1).setValues(titleValues);
    db.getRange(2, dbColumn_('바코드') + 1, rowCount, 1).setValues(barcodeValues);
    db.getRange(2, trackingStart, rowCount, trackingWidth).setValues(trackingValues);
  }
  if (newRows.length) {
    const startRow = db.getLastRow() + 1;
    ensureSheetSize_(db, startRow + newRows.length - 1, PRODUCT_DB_HEADERS.length);
    db.getRange(startRow, 1, newRows.length, PRODUCT_DB_HEADERS.length).setValues(newRows);
  }
  return purchaseProductMap_(db);
}

function createPurchasePrint_(ss, productMap, items) {
  const groups = {};
  (Array.isArray(items) ? items : []).forEach(item => {
    const date = purchaseDateOnly_(item.expectedDate);
    const center = String(item.center || '').trim() || '센터미확인';
    const key = date + '|' + center;
    if (!groups[key]) groups[key] = { date: date, center: center, items: [] };
    groups[key].items.push(item);
  });

  const legacyPicking = ss.getSheetByName('발주피킹');
  if (legacyPicking && !ss.getSheetByName(PO_PICKING_SHEET)) legacyPicking.setName(PO_PICKING_SHEET);
  const pickingSheet = getOrCreateSheet_(ss, PO_PICKING_SHEET);
  pickingSheet.getDataRange().breakApart();
  pickingSheet.clear();
  pickingSheet.getRange(1, 1, 1, PO_PICKING_HEADERS.length).merge().setValue('발주서 출력 · 오늘 이후 입고예정일 빠른순')
    .setFontSize(15).setFontWeight('bold').setFontColor('#ffffff').setBackground('#1f4e78').setHorizontalAlignment('center');
  pickingSheet.getRange(2, 1, 1, PO_PICKING_HEADERS.length).setValues([PO_PICKING_HEADERS])
    .setFontWeight('bold').setFontColor('#ffffff').setBackground('#4472c4').setHorizontalAlignment('center').setWrap(true);

  const pickingValues = [];
  const pickingGroupRows = [];
  const pickingTotalRows = [];
  const pickingDataRows = [];
  const missingWarehouseRanges = [];
  let missingWarehouse = 0;
  const today = Number(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd'));
  const sortedGroupKeys = Object.keys(groups).sort((left, right) => {
    const leftDate = purchaseDateNumber_(groups[left].date);
    const rightDate = purchaseDateNumber_(groups[right].date);
    const leftUnknown = leftDate >= 99999999;
    const rightUnknown = rightDate >= 99999999;
    if (leftUnknown !== rightUnknown) return leftUnknown ? 1 : -1;
    const leftUpcoming = leftDate >= today;
    const rightUpcoming = rightDate >= today;
    if (leftUpcoming !== rightUpcoming) return leftUpcoming ? -1 : 1;
    if (leftDate !== rightDate) return leftUpcoming ? leftDate - rightDate : rightDate - leftDate;
    return String(groups[left].center).localeCompare(String(groups[right].center));
  });
  sortedGroupKeys.forEach(key => {
    const group = groups[key];
    const groupLabel = group.date + ' · ' + group.center;
    pickingGroupRows.push(pickingValues.length + 3);
    pickingValues.push(['합배송 묶음: ' + groupLabel,'','','','','','','','','','','','']);
    let orderTotal = 0;
    let confirmedTotal = 0;
    group.items.sort((a, b) => purchaseDateTimeNumber_(b.orderDate) - purchaseDateTimeNumber_(a.orderDate)
      || String(b.po || '').localeCompare(String(a.po || '')) || String(a.sku || '').localeCompare(String(b.sku || ''))).forEach(item => {
      const sku = String(item.sku || '').trim();
      const product = productMap[sku];
      const warehouse = product ? String(product[dbColumn_('창고번호')] || '') : '';
      if (!warehouse) missingWarehouse++;
      const orderQuantity = number_(item.orderQty);
      const availableQuantity = number_(item.confirmedQty);
      orderTotal += orderQuantity;
      confirmedTotal += availableQuantity;
      const sheetRow = pickingValues.length + 3;
      pickingDataRows.push(sheetRow);
      if (!warehouse) missingWarehouseRanges.push('E' + sheetRow);
      pickingValues.push([
        group.center,String(item.po || ''),String(item.orderDate || ''),group.date,warehouse || '미등록',sku,
        productDisplayName_(product, item.name),String(item.barcode || (product ? product[dbColumn_('바코드')] : '') || ''),
        product ? number_(product[dbColumn_('원가(부가세포함)')]) : 0,number_(item.purchasePrice),orderQuantity,availableQuantity,
        product ? String(product[dbColumn_('거래처')] || '') : ''
      ]);
    });
    pickingTotalRows.push(pickingValues.length + 3);
    pickingValues.push([groupLabel + ' 합계','','','','','','','','','',orderTotal,confirmedTotal,'']);
  });

  if (pickingValues.length) {
    ensureSheetSize_(pickingSheet, pickingValues.length + 2, PO_PICKING_HEADERS.length);
    pickingSheet.getRange(3, 1, pickingValues.length, PO_PICKING_HEADERS.length).setValues(pickingValues);
    pickingSheet.setRowHeights(3, pickingValues.length, 28);
  }
  pickingGroupRows.forEach(row => {
    pickingSheet.getRange(row, 1, 1, PO_PICKING_HEADERS.length).merge().setBackground('#d9eaf7').setFontWeight('bold').setFontSize(12);
    pickingSheet.setRowHeight(row, 28);
  });
  pickingTotalRows.forEach(row => {
    pickingSheet.getRange(row, 1, 1, PO_PICKING_HEADERS.length).setBackground('#e2f0d9').setFontWeight('bold');
    pickingSheet.setRowHeight(row, 28);
  });
  if (missingWarehouseRanges.length) pickingSheet.getRangeList(missingWarehouseRanges).setBackground('#f4cccc');
  pickingSheet.setFrozenRows(2);
  pickingSheet.setHiddenGridlines(true);
  [95,105,125,95,85,115,330,120,80,80,75,115,95].forEach((width, index) => pickingSheet.setColumnWidth(index + 1, width));
  if (pickingValues.length) {
    const printRange = pickingSheet.getRange(3, 1, pickingValues.length, PO_PICKING_HEADERS.length);
    printRange.setVerticalAlignment('middle').setWrap(true).setFontSize(9)
      .setBorder(true,true,true,true,true,true,'#b7b7b7',SpreadsheetApp.BorderStyle.SOLID);
    pickingSheet.getRange(3, 1, pickingValues.length, 6).setHorizontalAlignment('center');
    pickingSheet.getRange(3, 8, pickingValues.length, 6).setHorizontalAlignment('center');
    pickingSheet.getRange(3, 7, pickingValues.length, 1).setHorizontalAlignment('left');
    pickingSheet.getRange(3, 6, pickingValues.length, 1).setNumberFormat('@');
    pickingSheet.getRange(3, 8, pickingValues.length, 1).setNumberFormat('@');
    pickingSheet.getRange(3, 9, pickingValues.length, 4).setNumberFormat('#,##0');
  }

  const shipmentSheet = getOrCreateSheet_(ss, PO_SHIPMENT_SHEET);
  shipmentSheet.getDataRange().breakApart();
  shipmentSheet.clear();
  shipmentSheet.getRange(1, 1, 1, PO_SHIPMENT_HEADERS.length).merge().setValue('쉽먼트전송 · 오늘 이후 입고예정일 빠른순')
    .setFontSize(15).setFontWeight('bold').setFontColor('#ffffff').setBackground('#7f6000').setHorizontalAlignment('center');
  shipmentSheet.getRange(2, 1, 1, PO_SHIPMENT_HEADERS.length).setValues([PO_SHIPMENT_HEADERS])
    .setFontWeight('bold').setFontColor('#ffffff').setBackground('#bf9000').setHorizontalAlignment('center').setWrap(true);
  const shipmentValues = [];
  sortedGroupKeys.forEach(key => {
    const group = groups[key];
    const groupLabel = group.date + ' · ' + group.center;
    group.items.sort((a, b) => String(a.po || '').localeCompare(String(b.po || '')) || String(a.sku || '').localeCompare(String(b.sku || ''))).forEach(item => {
      shipmentValues.push([groupLabel,String(item.po || ''),group.center,group.date,String(item.sku || ''),String(item.name || ''),
        number_(item.orderQty),number_(item.confirmedQty),number_(item.receivedQty),number_(item.supplyPrice),false]);
    });
  });
  if (shipmentValues.length) {
    ensureSheetSize_(shipmentSheet, shipmentValues.length + 2, PO_SHIPMENT_HEADERS.length);
    shipmentSheet.getRange(3, 1, shipmentValues.length, PO_SHIPMENT_HEADERS.length).setValues(shipmentValues).setVerticalAlignment('middle').setWrap(true);
    shipmentSheet.getRange(3, 7, shipmentValues.length, 4).setNumberFormat('#,##0');
    shipmentSheet.getRange(3, 11, shipmentValues.length, 1).insertCheckboxes();
  }
  shipmentSheet.setFrozenRows(2);
  shipmentSheet.setHiddenGridlines(true);
  [150,100,90,95,105,330,75,90,75,75,65].forEach((width, index) => shipmentSheet.setColumnWidth(index + 1, width));
  return { groups: Object.keys(groups).length, pickingRows: pickingDataRows.length, shipmentRows: shipmentValues.length, missingWarehouse: missingWarehouse, missingImage: 0 };
}

function importPurchaseOrders_(ss, db, items) {
  const history = getOrCreateSheet_(ss, PO_HISTORY_SHEET);
  syncHeaders_(history, PO_HISTORY_HEADERS);
  history.hideSheet();
  const rawExisting = history.getLastRow() > 1 ? history.getRange(2, 1, history.getLastRow() - 1, PO_HISTORY_HEADERS.length).getValues() : [];
  const centersByPo = {};
  const registerCenter = (po, center) => {
    const poText = String(po || '').trim();
    const centerText = String(center || '').trim();
    if (!poText || !centerText) return;
    if (!centersByPo[poText]) centersByPo[poText] = {};
    centersByPo[poText][centerText] = true;
  };
  rawExisting.forEach(row => registerCenter(row[1], row[3]));
  (Array.isArray(items) ? items : []).forEach(item => registerCenter(item.po, item.center));
  const uniqueCenterForPo = po => {
    const centers = Object.keys(centersByPo[String(po || '').trim()] || {});
    return centers.length === 1 ? centers[0] : '';
  };
  const existing = [];
  const keyMap = {};
  rawExisting.forEach(row => {
    const po = String(row[1] || '').trim();
    const sku = String(row[2] || '').trim();
    const center = String(row[3] || '').trim() || uniqueCenterForPo(po);
    const key = [po, sku, center].join('|');
    row[0] = key;
    row[3] = center;
    if (keyMap[key] === undefined) { keyMap[key] = existing.length; existing.push(row); }
    else existing[keyMap[key]] = row;
  });
  let inserted = 0;
  let updated = 0;
  (Array.isArray(items) ? items : []).forEach(item => {
    const po = String(item.po || '').trim();
    const sku = String(item.sku || '').trim();
    const center = String(item.center || '').trim() || uniqueCenterForPo(po);
    const key = [po, sku, center].join('|');
    if (!po || !sku) return;
    const row = [key, po, sku, center, String(item.status || ''),
      String(item.name || ''), String(item.barcode || ''), String(item.expectedDate || ''), String(item.orderDate || ''),
      number_(item.orderQty), number_(item.confirmedQty), number_(item.receivedQty), number_(item.purchasePrice),
      number_(item.supplyPrice), number_(item.tax), new Date()];
    if (keyMap[key] === undefined) { keyMap[key] = existing.length; existing.push(row); inserted++; }
    else { existing[keyMap[key]] = row; updated++; }
  });
  if (existing.length) history.getRange(2, 1, existing.length, PO_HISTORY_HEADERS.length).setValues(existing);
  if (rawExisting.length > existing.length) {
    history.getRange(existing.length + 2, 1, rawExisting.length - existing.length, PO_HISTORY_HEADERS.length).clearContent();
  }

  const aggregates = {};
  existing.forEach(row => {
    const sku = String(row[2] || '').trim();
    if (!sku) return;
    const current = aggregates[sku] || { name: row[5], barcode: row[6], order: 0, missing: 0, dates: {}, prices: [] };
    const orderQty = number_(row[9]);
    const confirmed = number_(row[10]) || orderQty;
    const received = number_(row[11]);
    const date = String(row[8] || '');
    current.order += orderQty;
    current.missing += Math.max(0, confirmed - received);
    current.dates[date] = (current.dates[date] || 0) + orderQty;
    if (number_(row[13]) > 0) current.prices.push({ date: date, price: number_(row[13]) });
    aggregates[sku] = current;
  });

  const productMap = applyPurchaseAggregates_(db, aggregates);
  const printSummary = createPurchasePrint_(ss, productMap, items);
  const couponSummary = updateWeeklyCouponIssue_(ss, new Date());
  return json_({ ok: true, inserted: inserted, updated: updated, total: existing.length,
    shippingGroups: printSummary.groups, pickingRows: printSummary.pickingRows, shipmentRows: printSummary.shipmentRows,
    missingWarehouse: printSummary.missingWarehouse, missingImage: printSummary.missingImage,
    couponAdded: couponSummary.added, couponUpdated: couponSummary.updated, couponTotal: couponSummary.total });
}

function saveCloudDraft_(record) {
  if (!record || !record.model) return json_({ ok: false, error: 'model required' });
  const props = PropertiesService.getDocumentProperties();
  props.setProperty('draft:' + record.model, JSON.stringify(record));
  const rows = Object.keys(props.getProperties()).filter(key => key.indexOf('draft:') === 0)
    .map(key => ({ key: key, record: JSON.parse(props.getProperty(key)) }))
    .sort((a, b) => Number(b.record.savedAt || 0) - Number(a.record.savedAt || 0));
  rows.slice(20).forEach(item => props.deleteProperty(item.key));
  return json_({ ok: true });
}

function listCloudDrafts_() {
  const props = PropertiesService.getDocumentProperties();
  const drafts = Object.keys(props.getProperties()).filter(key => key.indexOf('draft:') === 0)
    .map(key => JSON.parse(props.getProperty(key)))
    .sort((a, b) => Number(b.savedAt || 0) - Number(a.savedAt || 0));
  return json_({ ok: true, drafts: drafts });
}

function deleteCloudDraft_(model) {
  PropertiesService.getDocumentProperties().deleteProperty('draft:' + model);
  return json_({ ok: true });
}

function saveQuoteQueue_(ss, record) {
  if (!record || !record.model || !record.payload) return;
  const sheet = getOrCreateSheet_(ss, QUOTE_QUEUE_SHEET);
  syncHeaders_(sheet, QUOTE_QUEUE_HEADERS);
  sheet.hideSheet();
  const model = String(record.model || '').trim();
  const row = [
    model,
    String(record.gender || '').trim(),
    String(record.category || '').trim(),
    Math.max(0, number_(record.skuCount)),
    new Date(),
    JSON.stringify(record.payload),
  ];
  // 같은 모델이 예전 오류로 여러 줄 남아 있어도 전부 제거한 뒤 최신 한 줄만 남깁니다.
  if (sheet.getLastRow() > 1) {
    const oldRows = sheet.getRange(2, 1, sheet.getLastRow() - 1, QUOTE_QUEUE_HEADERS.length).getValues();
    const kept = oldRows.filter(oldRow => String(oldRow[0] || '').trim() !== model);
    sheet.getRange(2, 1, oldRows.length, QUOTE_QUEUE_HEADERS.length).clearContent();
    if (kept.length) sheet.getRange(2, 1, kept.length, QUOTE_QUEUE_HEADERS.length).setValues(kept);
    sheet.getRange(kept.length + 2, 1, 1, QUOTE_QUEUE_HEADERS.length).setValues([row]);
  } else {
    sheet.getRange(2, 1, 1, QUOTE_QUEUE_HEADERS.length).setValues([row]);
  }
  sheet.getRange(2, 5, Math.max(1, sheet.getLastRow() - 1), 1).setNumberFormat('yyyy/MM/dd HH:mm');
}

function listQuoteQueue_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet_(ss, QUOTE_QUEUE_SHEET);
  syncHeaders_(sheet, QUOTE_QUEUE_HEADERS);
  sheet.hideSheet();
  const rows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, QUOTE_QUEUE_HEADERS.length).getValues() : [];
  const parsed = rows.map(row => {
    try {
      return { model: String(row[0] || ''), gender: String(row[1] || ''), category: String(row[2] || ''),
        skuCount: number_(row[3]), savedAt: row[4] instanceof Date ? row[4].getTime() : String(row[4] || ''),
        payload: JSON.parse(String(row[5] || '{}')) };
    } catch (error) { return null; }
  }).filter(Boolean);
  // 중복 데이터가 남아 있는 기존 시트도 가장 최근 저장본 하나만 반환합니다.
  const newestByModel = {};
  parsed.forEach(record => {
    const key = String(record.model || '').trim();
    const previous = newestByModel[key];
    if (!previous || Number(record.savedAt || 0) >= Number(previous.savedAt || 0)) newestByModel[key] = record;
  });
  const records = Object.keys(newestByModel).map(key => newestByModel[key]);
  return json_({ ok: true, records: records });
}

function clearQuoteQueue_(gender, category) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet_(ss, QUOTE_QUEUE_SHEET);
  syncHeaders_(sheet, QUOTE_QUEUE_HEADERS);
  if (sheet.getLastRow() < 2) return json_({ ok: true, cleared: 0 });
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, QUOTE_QUEUE_HEADERS.length).getValues();
  const kept = rows.filter(row => !(String(row[1] || '') === gender && String(row[2] || '') === category));
  const cleared = rows.length - kept.length;
  sheet.getRange(2, 1, rows.length, QUOTE_QUEUE_HEADERS.length).clearContent();
  if (kept.length) sheet.getRange(2, 1, kept.length, QUOTE_QUEUE_HEADERS.length).setValues(kept);
  sheet.hideSheet();
  return json_({ ok: true, cleared: cleared });
}

function deleteQuoteQueueModel_(model) {
  const target = String(model || '').trim();
  if (!target) return json_({ ok: false, error: '삭제할 모델명이 없습니다.' });
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet_(ss, QUOTE_QUEUE_SHEET);
  syncHeaders_(sheet, QUOTE_QUEUE_HEADERS);
  if (sheet.getLastRow() < 2) return json_({ ok: true, deleted: 0 });
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, QUOTE_QUEUE_HEADERS.length).getValues();
  const kept = rows.filter(row => String(row[0] || '').trim() !== target);
  const deleted = rows.length - kept.length;
  sheet.getRange(2, 1, rows.length, QUOTE_QUEUE_HEADERS.length).clearContent();
  if (kept.length) sheet.getRange(2, 1, kept.length, QUOTE_QUEUE_HEADERS.length).setValues(kept);
  sheet.hideSheet();
  return json_({ ok: true, deleted: deleted });
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}
