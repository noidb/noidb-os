const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Execute the real Apps Script in memory. No network, Drive, or live Sheet is used.
const sourcePath = path.resolve(__dirname, "../templates/구글시트_상품DB_연동.gs");
const source = fs.readFileSync(sourcePath, "utf8");
const clone = value => JSON.parse(JSON.stringify(value));
const context = vm.createContext({ console, Date, Error });
vm.runInContext(`${source}\n;globalThis.__headers = PRODUCT_DB_HEADERS;`, context, { filename: sourcePath });
const headers = Array.from(context.__headers);
const actualImageSaver = context.saveProductImages_;
const actualDbWriter = context.writeDbMatrix_;
const actualRefreshProductLinks = context.refreshPurchasePrintProductLinks_;
const actualNormalizeStatuses = context.normalizeCurrentStatusLabels_;
const historyHeaders = Array.from(vm.runInContext("SKU_REPLACEMENT_HEADERS", context));
const col = name => {
  const index = headers.indexOf(name);
  assert.notEqual(index, -1, `Unknown product DB column: ${name}`);
  return index;
};

class MockRange {
  constructor(sheet, row, column, rowCount = 1, columnCount = 1) {
    Object.assign(this, { sheet, row, column, rowCount, columnCount });
    assert.ok(row >= 1 && column >= 1 && rowCount >= 1 && columnCount >= 1, "Valid 1-based Sheet range");
  }
  each(callback) {
    for (let r = 0; r < this.rowCount; r++) {
      for (let c = 0; c < this.columnCount; c++) callback(this.sheet.cell(this.row + r, this.column + c), r, c);
    }
    return this;
  }
  matrix(callback) {
    return Array.from({ length: this.rowCount }, (_, r) => Array.from({ length: this.columnCount }, (_, c) => callback(this.sheet.cell(this.row + r, this.column + c))));
  }
  getValues() { return this.matrix(cell => cell.value); }
  getDisplayValues() { return this.matrix(cell => String(cell.value ?? "")); }
  getFormulas() { return this.matrix(cell => cell.formula); }
  getValue() { return this.getValues()[0][0]; }
  getFormula() { return this.getFormulas()[0][0]; }
  getRow() { return this.row; }
  getColumn() { return this.column; }
  getNumRows() { return this.rowCount; }
  getNumColumns() { return this.columnCount; }
  getSheet() { return this.sheet; }
  setValue(value) { return this.setValues(Array.from({ length: this.rowCount }, () => Array(this.columnCount).fill(value))); }
  setValues(values) {
    assert.equal(values.length, this.rowCount);
    values.forEach(row => assert.equal(row.length, this.columnCount));
    this.sheet.mutate("write", { row: this.row, column: this.column, rowCount: this.rowCount, columnCount: this.columnCount });
    return this.each((cell, r, c) => {
      const value = values[r][c] ?? "";
      cell.formula = typeof value === "string" && value.startsWith("=") ? value : "";
      cell.value = cell.formula ? "mock formula result" : value;
    });
  }
  setFormula(value) { return this.setValue(value); }
  setFormulas(values) { return this.setValues(values); }
  setNumberFormat(value) { return this.each(cell => { cell.format = value; }); }
  setNumberFormats(values) { return this.each((cell, r, c) => { cell.format = values[r][c]; }); }
  getNumberFormats() { return this.matrix(cell => cell.format); }
  clearContent() { this.sheet.clearCalls++; return this.setValue(""); }
}

class MockSheet {
  constructor(rows, name = "제품DB", sheetId = 100) {
    this.name = name;
    this.sheetId = sheetId;
    this.rows = rows.map((values, index) => ({
      id: index ? `original-row-${index + 1}` : "header",
      height: 64 + index,
      cells: values.map((value, column) => ({ value, formula: "", format: `format-${index}-${column}`, note: `note-${index}-${column}`, validation: `validation-${column}` })),
    }));
    this.writes = [];
    this.moves = [];
    this.clearCalls = 0;
    this.deleteCalls = 0;
    this.failure = null;
  }
  cell(row, column) {
    if (row > this.rows.length && this.name !== "제품DB") {
      while (this.rows.length < row) this.rows.push({ id: `history-row-${this.rows.length + 1}`, height: 21, cells: [] });
    }
    assert.ok(row <= this.rows.length, `Unexpected new product row ${row}; re-registration must reuse existing rows`);
    while (this.rows[row - 1].cells.length < column) this.rows[row - 1].cells.push({ value: "", formula: "", format: "", note: "", validation: "" });
    return this.rows[row - 1].cells[column - 1];
  }
  getRange(...args) { return new MockRange(this, ...args); }
  getDataRange() { return this.getRange(1, 1, this.getLastRow(), this.getLastColumn()); }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return Math.max(0, ...this.rows.map(row => row.cells.length)); }
  getMaxRows() { return Math.max(1000, this.rows.length); }
  getMaxColumns() { return Math.max(100, this.getLastColumn()); }
  getName() { return this.name; }
  getSheetId() { return this.sheetId; }
  getParent() { return this.parent; }
  getFilter() { return null; }
  hideSheet() { return this; }
  snapshot() { return clone(this.rows); }
  mutate(kind, details) {
    if (this.failure?.kind === kind && --this.failure.remaining === 0) {
      this.failure = null; // Transient failure; restoration calls are allowed.
      throw new Error(`Injected ${kind} failure`);
    }
    (kind === "move" ? this.moves : this.writes).push(clone(details));
  }
  moveRows(range, destinationIndex) {
    const start = range.getRow();
    const count = range.getNumRows();
    assert.ok(start > 1 && destinationIndex > 1, "Header must never move");
    this.mutate("move", { start, count, destinationIndex });
    if (destinationIndex >= start && destinationIndex <= start + count) return this;
    const moved = this.rows.splice(start - 1, count);
    const adjusted = destinationIndex > start ? destinationIndex - count : destinationIndex;
    this.rows.splice(adjusted - 1, 0, ...moved);
    return this;
  }
  deleteRow() { this.deleteCalls++; throw new Error("Row deletion is forbidden"); }
  deleteRows() { this.deleteCalls++; throw new Error("Row deletion is forbidden"); }
  insertRowsBefore() { throw new Error("Row creation is forbidden"); }
  insertRowsAfter() { throw new Error("Row creation is forbidden"); }
  clear() { throw new Error("Whole-sheet clearing is forbidden"); }
}

function row(model, modelSku, overrides = {}) {
  const values = headers.map(name => `existing:${modelSku}:${name}`);
  const defaults = {
    "현재상태": "판매중지", "모델명/품번": model, "모델SKU": modelSku,
    "상품명": `기존 상품 ${modelSku}`, "색상": modelSku.endsWith("GO") ? "골드" : "실버",
    "주얼리사이즈": "Free", "패키지": "", "SKU ID": `old-sku-${modelSku}`,
    "바코드": `old-barcode-${modelSku}`, "발주가능상태": "발주중지", "기본순서": 12,
    "창고번호": `A-${modelSku}`, "누적입고": 175, "현재고": 23, "미입고": 9,
    "원가(부가세포함)": 1000, "쿠팡 판매가": 10000, "공급가": 5800, "마진": 4800,
  };
  Object.entries({ ...defaults, ...overrides }).forEach(([name, value]) => { values[col(name)] = value; });
  return [...values, `user-extra:${modelSku}`, `user-extra-formula:${modelSku}`];
}

function incoming(modelSku, overrides = {}) {
  const values = headers.map(() => "");
  Object.entries({
    "모델명/품번": "WR0001", "모델SKU": modelSku, "상품명": `새 상품 ${modelSku}`,
    "색상": modelSku.endsWith("GO") ? "골드" : "실버", "주얼리사이즈": "Free", ...overrides,
  }).forEach(([name, value]) => { values[col(name)] = value; });
  return values;
}

function fixture(customRows) {
  context.writeDbMatrix_ = actualDbWriter;
  context.refreshPurchasePrintProductLinks_ = actualRefreshProductLinks;
  context.normalizeCurrentStatusLabels_ = actualNormalizeStatuses;
  const db = new MockSheet([
    [...headers, "사용자추가열", "사용자수식열"],
    ...(customRows || [
      row("OTHER-A", "OTHER-A-SI", { "현재상태": "완료" }),
      row("WR0001", "WR0001-SI"),
      row("WR0001-재등록", "WR0001-재등록-SI", { "현재상태": "등록파일생성" }),
      row("WR0001", "WR0001-GO"),
      row("OTHER-B", "OTHER-B-GO", { "현재상태": "완료" }),
    ]),
  ]);
  const cache = new Map();
  const calls = { backups: [], quoteRecords: [], imageSaves: 0, locks: 0, releases: 0, flushes: 0, batches: [], rejectBatch: false };
  const sheets = new Map([["제품DB", db]]);
  const ss = {
    getId: () => "mock-spreadsheet",
    getSheetByName: name => sheets.get(name) || null,
    insertSheet(name) { assert.ok(!sheets.has(name)); const sheet = new MockSheet([], name, 100 + sheets.size); sheet.parent = ss; sheets.set(name, sheet); return sheet; },
  };
  db.parent = ss;
  const lock = { waitLock() { calls.locks++; }, releaseLock() { calls.releases++; } };
  context.SpreadsheetApp = { getActiveSpreadsheet: () => ss, flush() { calls.flushes++; } };
  context.LockService = { getScriptLock: () => lock, getDocumentLock: () => lock };
  context.CacheService = { getScriptCache: () => ({ get: key => cache.get(key) || null, put: (key, value) => cache.set(key, value) }) };
  context.Session = { getScriptTimeZone: () => "Asia/Seoul" };
  context.Utilities = { formatDate: () => "2026-09-08 15:00:00", getUuid: () => "mock-reregistration-id" };
  context.ScriptApp = { getOAuthToken: () => "mock-local-token" };
  context.UrlFetchApp = {
    fetch(url, options) {
      assert.equal(url, "https://sheets.googleapis.com/v4/spreadsheets/mock-spreadsheet:batchUpdate", "Only mocked Sheets API endpoint is allowed");
      assert.equal(String(options.method).toLowerCase(), "post");
      const payload = JSON.parse(options.payload);
      assert.ok(Array.isArray(payload.requests) && payload.requests.length > 0);
      calls.batches.push(clone(payload.requests));
      if (calls.rejectBatch) return { getResponseCode: () => 400, getContentText: () => JSON.stringify({ error: { message: "Injected atomic batch rejection" } }) };
      // Sheets validates and applies all requests atomically. Restore the memory
      // fixture if any simulated request cannot be applied.
      const snapshots = new Map([...sheets.values()].map(sheet => [sheet.sheetId, sheet.snapshot()]));
      const resolveSheet = id => {
        const sheet = [...sheets.values()].find(item => item.sheetId === id);
        assert.ok(sheet, `Known sheet ID ${id}`);
        return sheet;
      };
      const nativeValue = cell => {
        const entered = cell.userEnteredValue || {};
        if (Object.hasOwn(entered, "formulaValue")) return { value: "mock formula result", formula: entered.formulaValue };
        if (Object.hasOwn(entered, "stringValue")) return { value: entered.stringValue, formula: "" };
        if (Object.hasOwn(entered, "numberValue")) return { value: entered.numberValue, formula: "" };
        if (Object.hasOwn(entered, "boolValue")) return { value: entered.boolValue, formula: "" };
        return { value: "", formula: "" };
      };
      try {
        payload.requests.forEach(request => {
          if (request.updateCells) {
            const update = request.updateCells;
            assert.equal(update.fields, "userEnteredValue", "Cell updates must preserve format, notes, and validation");
            const start = update.start || update.range;
            const sheet = resolveSheet(start.sheetId);
            const startRow = start.rowIndex ?? start.startRowIndex;
            const startColumn = start.columnIndex ?? start.startColumnIndex;
            (update.rows || []).forEach((data, r) => (data.values || []).forEach((cell, c) => {
              const target = sheet.cell(startRow + r + 1, startColumn + c + 1);
              sheet.mutate("write", { row: startRow + r + 1, column: startColumn + c + 1, rowCount: 1, columnCount: 1 });
              Object.assign(target, nativeValue(cell));
            }));
          } else if (request.moveDimension) {
            const move = request.moveDimension;
            assert.equal(move.source.dimension, "ROWS");
            const sheet = resolveSheet(move.source.sheetId);
            sheet.moveRows(sheet.getRange(move.source.startIndex + 1, 1, move.source.endIndex - move.source.startIndex, sheet.getLastColumn()), move.destinationIndex + 1);
          } else if (request.appendCells) {
            const append = request.appendCells;
            const sheet = resolveSheet(append.sheetId);
            assert.notEqual(sheet, db, "Re-registration cannot append a product DB row");
            append.rows.forEach(data => {
              const position = sheet.getLastRow() + 1;
              data.values.forEach((cell, c) => Object.assign(sheet.cell(position, c + 1), nativeValue(cell)));
            });
          } else throw new Error(`Unsupported Sheets batch request: ${Object.keys(request)}`);
        });
      } catch (error) {
        [...sheets.values()].forEach(sheet => { sheet.rows = clone(snapshots.get(sheet.sheetId)); });
        throw error;
      }
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ spreadsheetId: ss.getId(), replies: payload.requests.map(() => ({})) }) };
    },
  };
  // Isolate external I/O, while retaining the real validation, planning, mutation,
  // row-moving, and doPost idempotency logic under test.
  context.getOrCreateSheet_ = (_ss, name) => sheets.get(name) || ss.insertSheet(name);
  context.removeObsoleteProductInputSheet_ = () => {};
  context.syncProductDbHeaders_ = () => {};
  context.syncHeaders_ = (sheet, names) => sheet.getRange(1, 1, 1, names.length).setValues([names]);
  context.backupProductDbSheet_ = (_ss, _db, reason) => { calls.backups.push({ reason, rows: db.snapshot() }); return "mock-backup"; };
  context.saveProductImages_ = () => { calls.imageSaves++; return {}; };
  context.saveQuoteQueue_ = (_ss, record) => { calls.quoteRecords.push(clone(record)); };
  context.json_ = value => value;
  return { db, ss, calls, cache };
}

function findRow(db, sku) {
  const match = db.rows.filter(item => item.cells[col("모델SKU")].value === sku);
  assert.equal(match.length, 1, `Exactly one original row for ${sku}`);
  return match[0];
}
function value(item, name) { return item.cells[col(name)].value; }
function register(state, rows, operationId = "registration-test-0001", extra = {}) {
  return context.doPost({ postData: { contents: JSON.stringify({
    secret: "여기에_임의의_긴_영문_비밀번호를_입력", syncMode: "reregisterStopped",
    operationId, productInputRow: ["", "", "", "", "WR0001"], productDbRows: rows,
    quoteRecord: { model: "WR0001" }, ...extra,
  }) } });
}

const scenarios = [];
const failures = [];
function test(name, callback) {
  try { callback(); scenarios.push(name); } catch (error) { failures.push({ name, error: error.stack || String(error) }); }
}

function defaultOptions() { return [incoming("WR0001-GO"), incoming("WR0001-SI")]; }
function assertProtected(state, before, allowedNames) {
  const allowed = new Set(allowedNames.map(col));
  before.slice(1).forEach(original => {
    const current = state.db.rows.find(item => item.id === original.id);
    assert.ok(current, `Original row still exists: ${original.id}`);
    assert.equal(current.height, original.height, "Native row height is preserved");
    original.cells.forEach((cell, column) => {
      if (!allowed.has(column) || value(original, "모델명/품번") !== "WR0001") assert.deepEqual(current.cells[column], cell, `Unchanged cell ${original.id}/${headers[column] || column}`);
      else {
        assert.equal(current.cells[column].format, cell.format);
        assert.equal(current.cells[column].note, cell.note);
        assert.equal(current.cells[column].validation, cell.validation);
      }
    });
  });
  assert.deepEqual(state.db.rows[0], before[0], "Header content, formatting and position are preserved");
  assert.equal(state.db.rows.length, before.length, "No product row creation or deletion");
  assert.equal(state.db.clearCalls, 0);
  assert.equal(state.db.deleteCalls, 0);
}

test("read-only eligibility accepts exact discontinued model and rejects renamed/case variant", () => {
  const state = fixture();
  const before = state.db.snapshot();
  const eligible = context.reregistrationEligibility_(state.db, "WR0001");
  assert.equal(eligible.reregisterable, true);
  assert.equal(eligible.rowCount, 2);
  assert.equal(context.reregistrationEligibility_(state.db, "WR0001-재등록").reregisterable, false);
  assert.equal(context.reregistrationEligibility_(state.db, "wr0001").reregisterable, false);
  assert.equal(context.reregistrationEligibility_(state.db, "MISSING").duplicate, false);
  assert.deepEqual(state.db.snapshot(), before);
  assert.equal(state.db.writes.length, 0);
});

test("noncontiguous options move to rows 2-3 in incoming option order while every other row is preserved", () => {
  const state = fixture();
  const silver = findRow(state.db, "WR0001-SI");
  silver.cells[col("이미지")].formula = '=IMAGE("https://example.invalid/old.jpg")';
  silver.cells[col("공급가")].formula = '=ROUND(10000*0.58,0)';
  silver.cells[headers.length + 1].formula = '=SUM(1,2)';
  const before = state.db.snapshot();
  const options = [incoming("WR0001-GO", { "거래처": "새 거래처", "원가(부가세포함)": 0, "쿠팡 판매가": 12000, "제조국명": "대한민국", "누적입고": 0, "현재고": 0, "제품링크": "https://example.invalid/new-input-must-clear", "노출상품ID": "bad-new-product", "옵션ID": "bad-new-option", "SKU ID": "bad-new-sku", "바코드": "bad-new-barcode", "발주가능상태": "bad-new-state" }), incoming("WR0001-SI", { "거래처": "   ", "원가(부가세포함)": null, "창고번호": "", "이미지": "" })];
  const result = context.reregisterModel_(state.ss, state.db, "WR0001", options, "direct-test-0001");
  assert.equal(result.updatedRows, 2);
  assert.deepEqual(state.db.rows.slice(1, 3).map(item => value(item, "모델SKU")), ["WR0001-GO", "WR0001-SI"]);
  assert.deepEqual(state.db.rows.slice(3).map(item => value(item, "모델SKU")), ["OTHER-A-SI", "WR0001-재등록-SI", "OTHER-B-GO"]);
  const gold = findRow(state.db, "WR0001-GO");
  assert.equal(value(gold, "거래처"), "새 거래처");
  assert.equal(value(gold, "원가(부가세포함)"), 0, "Explicit numeric zero is a supplied value");
  assert.equal(value(gold, "쿠팡 판매가"), 12000);
  assert.equal(value(gold, "제조국명"), "대한민국");
  assert.equal(value(gold, "누적입고"), 175);
  assert.equal(value(gold, "현재고"), 23);
  for (const sku of ["WR0001-SI", "WR0001-GO"]) {
    const current = findRow(state.db, sku);
    assert.equal(value(current, "현재상태"), "재등록파일생성");
    for (const name of ["SKU ID", "바코드", "발주가능상태", "제품링크", "노출상품ID", "옵션ID"]) assert.equal(value(current, name), "", name);
  }
  assertProtected(state, before, ["현재상태", "상품명", "SKU ID", "바코드", "발주가능상태", "제품링크", "노출상품ID", "옵션ID", "기본순서", "거래처", "원가(부가세포함)", "쿠팡 판매가", "제조국명"]);
  assert.equal(state.calls.batches.length, 1, "One atomic write/move/history transaction");
  assert.equal(state.calls.backups.length, 1);
  const history = state.ss.getSheetByName("_SKU교체이력");
  assert.equal(history.getLastRow(), 3);
  const archived = JSON.parse(history.getRange(2, 9).getValue());
  assert.deepEqual(archived.headers, [...headers, "사용자추가열", "사용자수식열"]);
  assert.equal(context.archivedProductDbRow_(archived)[col("SKU ID")], "old-sku-WR0001-GO", "Archive is compatible with the existing header-aware decoder");
  const retired = context.retiredSkuSet_(state.ss);
  assert.equal(retired["old-sku-WR0001-GO"], true);
  assert.equal(retired["old-sku-WR0001-SI"], true);
});

test("explicit warehouse input updates only that option and blank warehouse retains the other", () => {
  const state = fixture();
  context.reregisterModel_(state.ss, state.db, "WR0001", [incoming("WR0001-SI", { "창고번호": "NEW-42" }), incoming("WR0001-GO")], "warehouse-test-0001");
  assert.equal(value(findRow(state.db, "WR0001-SI"), "창고번호"), "NEW-42");
  assert.equal(value(findRow(state.db, "WR0001-GO"), "창고번호"), "A-WR0001-GO");
});

for (const status of ["완료", "신상승인대기", "기존상품승인대기", "등록파일생성", "판매중", ""]) {
  test(`status ${status || "blank"} cannot be re-registered`, () => {
    const state = fixture([row("WR0001", "WR0001-SI", { "현재상태": status })]);
    const before = state.db.snapshot();
    assert.equal(context.reregistrationEligibility_(state.db, "WR0001").reregisterable, false);
    const result = register(state, [incoming("WR0001-SI")]);
    assert.equal(result.ok, false);
    assert.deepEqual(state.db.snapshot(), before);
    assert.equal(state.calls.imageSaves, 0);
    assert.equal(state.calls.batches.length, 0);
  });
}

for (const [name, options] of [
  ["missing option", [incoming("WR0001-SI")]],
  ["additional option", [...defaultOptions(), incoming("WR0001-BK")]],
  ["unknown option", [incoming("WR0001-SI"), incoming("WR0001-BK")]],
  ["duplicate option", [incoming("WR0001-SI"), incoming("WR0001-SI")]],
  ["case-folded duplicate option", [incoming("WR0001-SI"), incoming("wr0001-si")]],
  ["blank option identity", [incoming("WR0001-SI"), incoming("")]],
  ["different input model", [incoming("WR0001-SI"), incoming("WR0001-GO", { "모델명/품번": "WR0001-재등록" })]],
  ["incoming package", [incoming("WR0001-SI"), incoming("WR0001-GO", { "패키지": "1" })]],
]) {
  test(`${name} is rejected before any product mutation`, () => {
    const state = fixture();
    const before = state.db.snapshot();
    assert.throws(() => context.planReregistration_(state.db, "WR0001", options));
    const result = register(state, options);
    assert.equal(result.ok, false);
    assert.deepEqual(state.db.snapshot(), before);
    assert.equal(state.calls.imageSaves, 0);
    assert.equal(state.calls.batches.length, 0);
  });
}

for (const [name, rows] of [
  ["existing duplicate modelSKU", [row("WR0001", "WR0001-SI"), row("WR0001", "WR0001-SI")]],
  ["existing case-folded duplicate modelSKU", [row("WR0001", "WR0001-SI"), row("WR0001", "wr0001-si")]],
  ["existing blank modelSKU", [row("WR0001", "")]],
  ["existing package row", [row("WR0001", "WR0001-SI", { "패키지": "패키지" })]],
  ["mixed stopped and approved options", [row("WR0001", "WR0001-SI"), row("WR0001", "WR0001-GO", { "현재상태": "완료" })]],
]) {
  test(`${name} blocks registration`, () => {
    const state = fixture(rows);
    const before = state.db.snapshot();
    assert.equal(context.reregistrationEligibility_(state.db, "WR0001").reregisterable, false);
    assert.equal(register(state, defaultOptions()).ok, false);
    assert.deepEqual(state.db.snapshot(), before);
  });
}

test("same operationId never repeats writes, moves, history, quote queue or image saves", () => {
  const state = fixture();
  const first = register(state, defaultOptions());
  assert.equal(first.ok, true, first.error);
  assert.equal(first.reregistered, true);
  const after = state.db.snapshot();
  const historyAfter = state.ss.getSheetByName("_SKU교체이력").snapshot();
  const second = register(state, [incoming("WR0001-GO", { "상품명": "must not replace" }), incoming("WR0001-SI")]);
  assert.deepEqual(clone(second), clone(first));
  assert.deepEqual(state.db.snapshot(), after);
  assert.deepEqual(state.ss.getSheetByName("_SKU교체이력").snapshot(), historyAfter);
  assert.equal(state.calls.batches.length, 1);
  assert.equal(state.calls.imageSaves, 1);
  assert.equal(state.calls.quoteRecords.length, 1);
  assert.equal(state.calls.locks, state.calls.releases);
});

test("new operationId can retry the pending file and does not retire blank identifiers again", () => {
  const state = fixture();
  assert.equal(register(state, defaultOptions()).ok, true);
  const historyAfter = state.ss.getSheetByName("_SKU교체이력").snapshot();
  const second = register(state, [incoming("WR0001-GO", { "상품명": "수정된 재등록 상품" }), incoming("WR0001-SI")], "registration-test-0002");
  assert.equal(second.ok, true, second.error);
  assert.equal(value(findRow(state.db, "WR0001-GO"), "상품명"), "수정된 재등록 상품");
  assert.deepEqual(state.ss.getSheetByName("_SKU교체이력").snapshot(), historyAfter);
  assert.equal(state.db.rows.length, 6);
});

for (const identifier of ["SKU ID", "바코드", "발주가능상태", "제품링크", "노출상품ID", "옵션ID"]) {
  test(`pending retry is blocked once ${identifier} has been connected`, () => {
    const state = fixture([row("WR0001", "WR0001-SI", { "현재상태": "재등록파일생성", "SKU ID": "", "바코드": "", "발주가능상태": "", "제품링크": "", "노출상품ID": "", "옵션ID": "", [identifier]: "new-approved-value" })]);
    const before = state.db.snapshot();
    assert.equal(register(state, [incoming("WR0001-SI")]).ok, false);
    assert.deepEqual(state.db.snapshot(), before);
  });
}

test("atomic API rejection leaves every existing product cell and row in place", () => {
  const state = fixture();
  const before = state.db.snapshot();
  state.calls.rejectBatch = true;
  const result = register(state, defaultOptions());
  assert.equal(result.ok, false);
  assert.match(result.error, /일괄 반영 실패/);
  assert.deepEqual(state.db.snapshot(), before);
  assert.equal(state.cache.size, 0);
  assert.equal(state.calls.quoteRecords.length, 0);
  assert.equal(state.calls.locks, state.calls.releases);
});

test("backup-time concurrent edit stops the batch without undoing the user's edit", () => {
  const state = fixture();
  context.backupProductDbSheet_ = () => { findRow(state.db, "WR0001-SI").cells[col("창고번호")].value = "USER-EDIT"; };
  const result = register(state, defaultOptions());
  assert.equal(result.ok, false);
  assert.match(result.error, /확인 중 변경/);
  assert.equal(state.calls.batches.length, 0);
  assert.equal(value(findRow(state.db, "WR0001-SI"), "창고번호"), "USER-EDIT");
  assert.equal(value(findRow(state.db, "WR0001-SI"), "SKU ID"), "old-sku-WR0001-SI");
});

test("legacy replacement repair ignores same-model re-registration history", () => {
  const state = fixture();
  assert.equal(register(state, defaultOptions()).ok, true);
  const before = state.db.snapshot();
  const result = context.repairReplacementDataFromHistory_(state.ss, state.db);
  assert.equal(result.restoredFields, 0);
  assert.equal(result.restoredRows, 0);
  assert.deepEqual(state.db.snapshot(), before);
});

test("live header order without inventory-status column preserves old warehouse and every custom column", () => {
  const state = fixture();
  const liveHeaders = [...headers.filter(name => name !== "재고현황").map(name => name === "원가(부가세포함)" ? "원가" : name === "쿠팡 판매가" ? "판매가" : name), "이전창고번호", "사용자추가열", "사용자수식열"];
  state.db.rows.forEach((item, index) => {
    const original = item.cells;
    item.cells = liveHeaders.map(name => {
      const canonicalName = name === "원가" ? "원가(부가세포함)" : name === "판매가" ? "쿠팡 판매가" : name;
      const position = headers.indexOf(canonicalName);
      if (position >= 0) return index === 0 ? { ...original[position], value: name } : original[position];
      if (name === "사용자추가열") return original[headers.length];
      if (name === "사용자수식열") return original[headers.length + 1];
      return { value: index ? `old-warehouse-${index}` : name, formula: "", format: "warehouse-format", note: "warehouse-note", validation: "" };
    });
  });
  const before = state.db.snapshot();
  context.syncProductDbHeaders_ = () => { throw new Error("Unexpected header migration"); };
  context.removeObsoleteProductInputSheet_ = () => { throw new Error("Unexpected unrelated sheet cleanup"); };
  const check = context.doPost({ postData: { contents: JSON.stringify({ secret: "여기에_임의의_긴_영문_비밀번호를_입력", action: "checkModel", model: "WR0001" }) } });
  assert.equal(check.reregisterable, true, check.error);
  assert.deepEqual(state.db.snapshot(), before);
  const result = register(state, defaultOptions());
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(state.db.rows[0], before[0]);
  const actualCol = name => liveHeaders.indexOf(name);
  const allowed = new Set(["현재상태", "상품명", "SKU ID", "바코드", "발주가능상태", "제품링크", "노출상품ID", "옵션ID", "기본순서"].map(actualCol));
  before.slice(1).forEach(original => {
    const current = state.db.rows.find(item => item.id === original.id);
    original.cells.forEach((cell, index) => {
      if (!allowed.has(index) || original.cells[actualCol("모델명/품번")].value !== "WR0001") assert.deepEqual(current.cells[index], cell, `Live layout cell ${liveHeaders[index]}`);
    });
  });
  const history = state.ss.getSheetByName("_SKU교체이력");
  const archived = JSON.parse(history.getRange(2, 9).getValue());
  assert.deepEqual(archived.headers, liveHeaders);
  assert.equal(context.archivedProductDbRow_(archived)[col("옵션ID")], "existing:WR0001-GO:옵션ID");
});

test("single legacy option gets the new modelSKU in its existing row", () => {
  const state = fixture([row("WR0001", "WR0001")]);
  const before = state.db.snapshot();
  const result = register(state, [incoming("WR0001-SI")]);
  assert.equal(result.ok, true, result.error);
  assert.equal(state.db.rows[1].id, before[1].id);
  assert.equal(value(state.db.rows[1], "모델SKU"), "WR0001-SI");
  assert.equal(value(state.db.rows[1], "누적입고"), 175);
  assert.equal(value(state.db.rows[1], "창고번호"), "A-WR0001");
  assert.equal(value(state.db.rows[1], "SKU ID"), "");
  assert.equal(state.db.rows.length, 2);
  const history = state.ss.getSheetByName("_SKU교체이력");
  assert.equal(context.archivedProductDbRow_(JSON.parse(history.getRange(2, 9).getValue()))[col("모델SKU")], "WR0001");
});

test("single legacy option cannot take a modelSKU owned by another model", () => {
  const state = fixture([row("WR0001", "WR0001"), row("OTHER", "WR0001-SI", { "현재상태": "완료" })]);
  const before = state.db.snapshot();
  const result = register(state, [incoming("WR0001-SI")]);
  assert.equal(result.ok, false);
  assert.match(result.error, /다른 기존 행과 중복/);
  assert.deepEqual(state.db.snapshot(), before);
  assert.equal(state.calls.batches.length, 0);
});

test("multiple legacy options still require exact option identity", () => {
  const state = fixture([row("WR0001", "WR0001-LEGACY-A"), row("WR0001", "WR0001-LEGACY-B")]);
  const before = state.db.snapshot();
  assert.equal(register(state, defaultOptions()).ok, false);
  assert.deepEqual(state.db.snapshot(), before);
});

test("single legacy option cannot bypass exact model or package checks", () => {
  const state = fixture([row("WR0001", "WR0001")]);
  const before = state.db.snapshot();
  assert.equal(register(state, [incoming("WR0001-SI", { "모델명/품번": "WR0001-재등록" })]).ok, false);
  assert.equal(register(state, [incoming("WR0001-SI", { "패키지": "패키지" })], "single-package-0001").ok, false);
  assert.deepEqual(state.db.snapshot(), before);
});

test("manual duplicate cleanup history is also excluded from legacy repair", () => {
  const state = fixture();
  assert.equal(register(state, defaultOptions()).ok, true);
  const history = state.ss.getSheetByName("_SKU교체이력");
  history.getRange(2, 7, 2, 1).setValue("재등록중복정리");
  const before = state.db.snapshot();
  const result = context.repairReplacementDataFromHistory_(state.ss, state.db);
  assert.equal(result.restoredFields, 0);
  assert.equal(result.restoredRows, 0);
  assert.deepEqual(state.db.snapshot(), before);
});
test("existing history headers and additional custom columns are preserved", () => {
  const state = fixture();
  const history = state.ss.insertSheet("_SKU교체이력");
  history.getRange(1, 1, 1, 12).setValues([[...historyHeaders, "사용자 이력 메모", "이력 수식"]]);
  history.getRange(2, 1, 1, 12).setValues([["old-date", "OLD", "OLD-NEW", "old-sku", "old-barcode", "OLD-WH", "완료", "old-operation", "", "", "keep-history-note", "=SUM(1,2)"]]);
  const before = history.snapshot();
  context.syncHeaders_ = () => { throw new Error("Destructive shared header synchronizer must not run"); };
  assert.equal(register(state, defaultOptions()).ok, true);
  assert.deepEqual(history.snapshot().slice(0, 2), before);
  assert.equal(history.getLastColumn(), 12);
  assert.equal(history.getLastRow(), 4);
});

test("unexpected history header order blocks registration without changing existing data", () => {
  const state = fixture();
  const history = state.ss.insertSheet("_SKU교체이력");
  const wrong = [...historyHeaders];
  [wrong[0], wrong[1]] = [wrong[1], wrong[0]];
  history.getRange(1, 1, 1, wrong.length).setValues([wrong]);
  const before = state.db.snapshot();
  const historyBefore = history.snapshot();
  const result = register(state, defaultOptions());
  assert.equal(result.ok, false);
  assert.match(result.error, /SKU 교체이력 열 순서/);
  assert.deepEqual(state.db.snapshot(), before);
  assert.deepEqual(history.snapshot(), historyBefore);
  assert.equal(state.calls.batches.length, 0);
});

test("re-registration passes image preservation even if the atomic database write fails", () => {
  const state = fixture();
  let observed = false;
  context.saveProductImages_ = (_images, preserveExisting) => { observed = true; assert.equal(preserveExisting, true); return {}; };
  state.calls.rejectBatch = true;
  assert.equal(register(state, defaultOptions()).ok, false);
  assert.equal(observed, true);
});

test("actual image saver creates a new file reference while keeping previous same-name images", () => {
  fixture();
  const state = { trashed: 0, created: 0, enumerated: 0 };
  context.Utilities.newBlob = (bytes, mimeType, filename) => ({ bytes, mimeType, filename });
  context.Utilities.base64Decode = value => Buffer.from(value, "base64");
  context.DriveApp = { Access: { ANYONE_WITH_LINK: "anyone" }, Permission: { VIEW: "view" } };
  context.getImageFolder_ = () => ({
    getFilesByName() {
      state.enumerated++;
      let remaining = 1;
      return { hasNext: () => remaining > 0, next() { remaining--; return { setTrashed(value) { assert.equal(value, true); state.trashed++; } }; } };
    },
    createFile(blob) {
      assert.equal(blob.filename, "WR0001.jpg");
      const id = `new-file-${++state.created}`;
      return { setSharing() {}, getId: () => id };
    },
  });
  const input = [{ filename: "WR0001.jpg", dataUrl: "data:image/jpeg;base64,VEVTVA==" }];
  const formulas = actualImageSaver(input, true);
  assert.equal(state.trashed, 0);
  assert.equal(state.enumerated, 0);
  assert.equal(state.created, 1);
  assert.match(formulas["WR0001.jpg"], /id=new-file-1/);
  const defaultFormulas = actualImageSaver(input);
  assert.equal(state.trashed, 1, "Existing behavior for the separate new-registration image path is unchanged");
  assert.match(defaultFormulas["WR0001.jpg"], /id=new-file-2/);
});
for (const identifier of ["SKU ID", "바코드", "발주가능상태", "제품링크", "노출상품ID", "옵션ID"]) {
  test(`retry requires a truly blank ${identifier}, treating numeric/string zero as populated`, () => {
    for (const zero of [0, "0"]) {
      const cleared = Object.fromEntries(["SKU ID", "바코드", "발주가능상태", "제품링크", "노출상품ID", "옵션ID"].map(name => [name, ""]));
      const state = fixture([row("WR0001", "WR0001-SI", { ...cleared, "현재상태": "재등록파일생성", [identifier]: zero })]);
      const before = state.db.snapshot();
      assert.equal(context.reregistrationEligibility_(state.db, "WR0001").reregisterable, false);
      assert.equal(register(state, [incoming("WR0001-SI")]).ok, false);
      assert.deepEqual(state.db.snapshot(), before);
      assert.equal(state.calls.batches.length, 0);
    }
  });
}

test("all six approval identifiers clear numeric zeros and existing link formulas despite supplied replacements", () => {
  const identifiers = ["SKU ID", "바코드", "발주가능상태", "제품링크", "노출상품ID", "옵션ID"];
  const zeroIdentifiers = Object.fromEntries(identifiers.map(name => [name, 0]));
  const suppliedIdentifiers = Object.fromEntries(identifiers.map(name => [name, `supplied:${name}`]));
  const state = fixture([row("WR0001", "WR0001-SI", zeroIdentifiers)]);
  findRow(state.db, "WR0001-SI").cells[col("제품링크")].formula = '=HYPERLINK("https://example.invalid/old","old")';
  const before = state.db.snapshot();
  const result = register(state, [incoming("WR0001-SI", suppliedIdentifiers)]);
  assert.equal(result.ok, true, result.error);
  const current = findRow(state.db, "WR0001-SI");
  identifiers.forEach(name => {
    assert.equal(value(current, name), "", name);
    assert.equal(current.cells[col(name)].formula, "", `${name} formula`);
  });
  assert.equal(value(current, "누적입고"), 175);
  assert.equal(value(current, "창고번호"), "A-WR0001-SI");
  assert.equal(context.reregistrationEligibility_(state.db, "WR0001").reregisterable, true);
  assertProtected(state, before, ["현재상태", "상품명", "기본순서", ...identifiers]);
});

test("post-write verification rejects numeric zero left in an identifier instead of accepting it as blank", () => {
  const state = fixture();
  const nativeFetch = context.UrlFetchApp.fetch;
  context.UrlFetchApp.fetch = (url, options) => {
    const result = nativeFetch(url, options);
    findRow(state.db, "WR0001-GO").cells[col("노출상품ID")].value = 0;
    return result;
  };
  const result = register(state, defaultOptions());
  assert.equal(result.ok, false);
  assert.match(result.error, /반영 결과 확인에 실패/);
  assert.equal(state.cache.size, 0);
  assert.equal(state.calls.quoteRecords.length, 0);
});
function useLivePriceHeaders(state) {
  state.db.rows[0].cells[col("원가(부가세포함)")].value = "원가";
  state.db.rows[0].cells[col("쿠팡 판매가")].value = "판매가";
}

test("canonical cost and sale inputs update live 원가 and 판매가 columns without renaming headers", () => {
  const state = fixture();
  useLivePriceHeaders(state);
  const before = state.db.snapshot();
  const result = register(state, [incoming("WR0001-GO", { "원가(부가세포함)": 2500, "쿠팡 판매가": 17900 }), incoming("WR0001-SI")]);
  assert.equal(result.ok, true, result.error);
  const current = findRow(state.db, "WR0001-GO");
  assert.equal(value(current, "원가(부가세포함)"), 2500);
  assert.equal(value(current, "쿠팡 판매가"), 17900);
  assertProtected(state, before, ["현재상태", "상품명", "기본순서", "원가(부가세포함)", "쿠팡 판매가", "SKU ID", "바코드", "발주가능상태", "제품링크", "노출상품ID", "옵션ID"]);
});

test("blank canonical prices preserve live price values and formulas", () => {
  const state = fixture();
  useLivePriceHeaders(state);
  findRow(state.db, "WR0001-SI").cells[col("원가(부가세포함)")].formula = "=1000";
  const before = state.db.snapshot();
  const result = register(state, [incoming("WR0001-GO", { "원가(부가세포함)": " ", "쿠팡 판매가": null }), incoming("WR0001-SI", { "원가(부가세포함)": "", "쿠팡 판매가": undefined })]);
  assert.equal(result.ok, true, result.error);
  assertProtected(state, before, ["현재상태", "상품명", "기본순서", "SKU ID", "바코드", "발주가능상태", "제품링크", "노출상품ID", "옵션ID"]);
});

test("explicit numeric or string zero updates both live price aliases", () => {
  for (const zero of [0, "0"]) {
    const state = fixture();
    useLivePriceHeaders(state);
    const result = register(state, [incoming("WR0001-GO", { "원가(부가세포함)": zero, "쿠팡 판매가": zero }), incoming("WR0001-SI")]);
    assert.equal(result.ok, true, result.error);
    const current = findRow(state.db, "WR0001-GO");
    assert.equal(value(current, "원가(부가세포함)"), zero);
    assert.equal(value(current, "쿠팡 판매가"), zero);
    assert.equal(value(findRow(state.db, "WR0001-SI"), "원가(부가세포함)"), 1000);
    assert.equal(value(findRow(state.db, "WR0001-SI"), "쿠팡 판매가"), 10000);
  }
});

for (const [canonical, alias] of [["원가(부가세포함)", "원가"], ["쿠팡 판매가", "판매가"], ["현재상태", "SKU매칭상태"]]) {
  test(`simultaneous ${canonical} and ${alias} columns block all registration writes`, () => {
    const state = fixture();
    state.db.rows.forEach((item, index) => item.cells.push({ value: index ? `ambiguous-${alias}` : alias, formula: "", format: "extra-format", note: "extra-note", validation: "" }));
    const before = state.db.snapshot();
    const result = register(state, defaultOptions());
    assert.equal(result.ok, false);
    assert.match(result.error, /같은 의미의 열이 중복/);
    assert.deepEqual(state.db.snapshot(), before);
    assert.equal(state.calls.imageSaves, 0);
    assert.equal(state.calls.batches.length, 0);
  });
}

test("established legacy SKU매칭상태 header maps to current status without a header migration", () => {
  const state = fixture();
  state.db.rows[0].cells[col("현재상태")].value = "SKU매칭상태";
  const beforeHeader = clone(state.db.rows[0]);
  assert.equal(context.reregistrationEligibility_(state.db, "WR0001").reregisterable, true);
  const result = register(state, defaultOptions());
  assert.equal(result.ok, true, result.error);
  assert.equal(value(findRow(state.db, "WR0001-GO"), "현재상태"), "재등록파일생성");
  assert.deepEqual(state.db.rows[0], beforeHeader);
});

test("price aliases use actual header positions even when the two columns are reordered", () => {
  const state = fixture();
  useLivePriceHeaders(state);
  const canonicalCost = col("원가(부가세포함)");
  const canonicalSale = col("쿠팡 판매가");
  state.db.rows.forEach(item => { [item.cells[canonicalCost], item.cells[canonicalSale]] = [item.cells[canonicalSale], item.cells[canonicalCost]]; });
  const beforeHeader = clone(state.db.rows[0]);
  const result = register(state, [incoming("WR0001-GO", { "원가(부가세포함)": 3900, "쿠팡 판매가": 23900 }), incoming("WR0001-SI")]);
  assert.equal(result.ok, true, result.error);
  const current = findRow(state.db, "WR0001-GO");
  assert.equal(current.cells[canonicalSale].value, 3900, "Cost goes to the actual 원가 column");
  assert.equal(current.cells[canonicalCost].value, 23900, "Sale goes to the actual 판매가 column");
  assert.deepEqual(state.db.rows[0], beforeHeader);
});
test("doPost preserves existing IMAGE formulas when the API sends thumbnail filenames without photos", () => {
  const state = fixture();
  for (const sku of ["WR0001-GO", "WR0001-SI"]) findRow(state.db, sku).cells[col("이미지")].formula = `=IMAGE("https://example.invalid/old-${sku}.jpg")`;
  const before = state.db.snapshot();
  const result = register(state, [incoming("WR0001-GO", { "이미지": "WR0001-GO.jpg" }), incoming("WR0001-SI", { "이미지": "WR0001-SI.jpg" })]);
  assert.equal(result.ok, true, result.error);
  for (const sku of ["WR0001-GO", "WR0001-SI"]) assert.equal(findRow(state.db, sku).cells[col("이미지")].formula, `=IMAGE("https://example.invalid/old-${sku}.jpg")`);
  assertProtected(state, before, ["현재상태", "상품명", "기본순서", "SKU ID", "바코드", "발주가능상태", "제품링크", "노출상품ID", "옵션ID"]);
});

test("doPost ignores uploaded-image results for a different thumbnail filename", () => {
  const state = fixture([row("WR0001", "WR0001-SI")]);
  const before = state.db.snapshot();
  context.saveProductImages_ = () => ({ "OTHER-MODEL.jpg": '=IMAGE("https://example.invalid/unrelated.jpg")' });
  const result = register(state, [incoming("WR0001-SI", { "이미지": "WR0001-SI.jpg" })], "wrong-image-test-0001", { productImages: [{ filename: "OTHER-MODEL.jpg", dataUrl: "data:image/jpeg;base64,VEVTVA==" }] });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(findRow(state.db, "WR0001-SI").cells[col("이미지")], before[1].cells[col("이미지")]);
});

test("doPost updates only the option with a real uploaded photo using its new Drive file ID", () => {
  const state = fixture();
  let created = 0;
  for (const sku of ["WR0001-GO", "WR0001-SI"]) findRow(state.db, sku).cells[col("이미지")].formula = `=IMAGE("https://example.invalid/old-${sku}.jpg")`;
  context.saveProductImages_ = actualImageSaver;
  context.Utilities.newBlob = (bytes, mimeType, filename) => ({ bytes, mimeType, filename });
  context.Utilities.base64Decode = value => Buffer.from(value, "base64");
  context.DriveApp = { Access: { ANYONE_WITH_LINK: "anyone" }, Permission: { VIEW: "view" } };
  context.getImageFolder_ = () => ({
    getFilesByName() { throw new Error("Existing Drive images must never be deleted during re-registration"); },
    createFile(blob) {
      assert.equal(blob.filename, "WR0001-SI.jpg");
      created++;
      return { setSharing() {}, getId: () => "new-silver-file-id" };
    },
  });
  const result = register(state, [incoming("WR0001-GO", { "이미지": "WR0001-GO.jpg" }), incoming("WR0001-SI", { "이미지": "WR0001-SI.jpg" })], "uploaded-image-test-0001", { productImages: [{ filename: "WR0001-SI.jpg", dataUrl: "data:image/jpeg;base64,VEVTVA==" }] });
  assert.equal(result.ok, true, result.error);
  assert.equal(created, 1);
  assert.match(findRow(state.db, "WR0001-SI").cells[col("이미지")].formula, /id=new-silver-file-id/);
  assert.equal(findRow(state.db, "WR0001-GO").cells[col("이미지")].formula, '=IMAGE("https://example.invalid/old-WR0001-GO.jpg")');
});
const approvalIdentifiers = ["SKU ID", "바코드", "발주가능상태", "제품링크", "노출상품ID", "옵션ID"];
function undoHistoryRow(oldRow, newModel, status, batch) {
  return ["2026-09-08", oldRow[col("모델명/품번")], newModel, oldRow[col("SKU ID")], oldRow[col("바코드")], oldRow[col("창고번호")], status, batch,
    JSON.stringify({ headers, values: oldRow.slice(0, headers.length) }), "", "keep-history-custom-cell"];
}
function invokeUndo(state, model, legacySku, entryPoint) {
  return entryPoint === "direct" ? context.undoReplacementLink_(state.ss, state.db, model, legacySku)
    : context.doPost({ postData: { contents: JSON.stringify({ secret: "여기에_임의의_긴_영문_비밀번호를_입력", action: "undoReplacementLink", model, replacementSku: legacySku }) } });
}

for (const protectedStatus of ["동일모델재등록", "재등록중복정리"]) {
  for (const selectOlderHistory of [false, true]) {
    test(`${protectedStatus} blocks direct and doPost undo ${selectOlderHistory ? "through another old SKU sharing the new model" : "when selected directly"} before any mutation`, () => {
      const cleared = Object.fromEntries(approvalIdentifiers.map(name => [name, ""]));
      const state = fixture([row("WR0001", "WR0001-SI", { ...cleared, "현재상태": "재등록파일생성" })]);
      const archived = row("WR0001", "WR0001-SI");
      const oldOrdinary = row("LEGACY", "LEGACY-SI", { "SKU ID": "legacy-selected-sku" });
      const history = state.ss.insertSheet("_SKU교체이력");
      history.getRange(1, 1, 1, 11).setValues([[...historyHeaders, "사용자 이력 메모"]]);
      const historyRows = [
        ...(selectOlderHistory ? [undoHistoryRow(oldOrdinary, "WR0001", "구 SKU 사용금지 · 새 SKU 대기", "older-link-batch")] : []),
        undoHistoryRow(archived, "WR0001", protectedStatus, "protected-reregistration-batch"),
      ];
      history.getRange(2, 1, historyRows.length, 11).setValues(historyRows);
      const before = state.db.snapshot();
      const historyBefore = history.snapshot();
      const dbWriteCount = state.db.writes.length;
      const historyWriteCount = history.writes.length;
      let mutationAttempts = 0;
      const forbidden = () => { mutationAttempts++; throw new Error("No mutation helper may run before rejecting protected undo"); };
      context.getOrCreateSheet_ = forbidden;
      context.syncProductDbHeaders_ = forbidden;
      context.normalizeCurrentStatusLabels_ = forbidden;
      context.removeObsoleteProductInputSheet_ = forbidden;
      context.backupProductDbSheet_ = forbidden;
      context.writeDbMatrix_ = forbidden;
      context.refreshPurchasePrintProductLinks_ = forbidden;
      const model = selectOlderHistory ? "LEGACY" : "WR0001";
      const sku = selectOlderHistory ? "legacy-selected-sku" : archived[col("SKU ID")];
      for (const entryPoint of ["direct", "doPost"]) {
        const result = invokeUndo(state, model, sku, entryPoint);
        assert.equal(result.ok, false, `${entryPoint} must reject protected undo`);
        assert.match(result.error, /일반 SKU 연결취소로 복원할 수 없습니다/);
        assert.deepEqual(state.db.snapshot(), before);
        assert.deepEqual(history.snapshot(), historyBefore);
        assert.equal(state.db.writes.length, dbWriteCount);
        assert.equal(history.writes.length, historyWriteCount);
        assert.equal(mutationAttempts, 0);
        assert.equal(state.db.deleteCalls, 0);
        assert.equal(state.db.clearCalls, 0);
        assert.equal(state.calls.batches.length, 0);
        approvalIdentifiers.forEach(name => assert.equal(value(state.db.rows[1], name), "", `${entryPoint}: ${name}`));
      }
    });
  }
}

for (const entryPoint of ["direct", "doPost"]) {
  test(`ordinary legacy SKU undo still works through ${entryPoint} when protected histories belong to other models`, () => {
    const cleared = Object.fromEntries(approvalIdentifiers.map(name => [name, ""]));
    const state = fixture([row("WR0001", "WR0001-SI", { ...cleared, "현재상태": "기존상품승인대기" })]);
    const original = row("LEGACY", "LEGACY-SI", { "SKU ID": "normal-legacy-sku" });
    const history = state.ss.insertSheet("_SKU교체이력");
    history.getRange(1, 1, 1, 11).setValues([[...historyHeaders, "사용자 이력 메모"]]);
    history.getRange(2, 1, 3, 11).setValues([
      undoHistoryRow(original, "WR0001", "구 SKU 사용금지 · 새 SKU 대기", "ordinary-batch"),
      undoHistoryRow(row("OTHER-ONE", "OTHER-ONE-SI"), "OTHER-ONE", "동일모델재등록", "other-reregistration"),
      undoHistoryRow(row("OTHER-TWO", "OTHER-TWO-SI"), "OTHER-TWO", "재등록중복정리", "other-cleanup"),
    ]);
    const unrelatedBefore = history.snapshot().slice(2);
    const writes = [];
    let refreshes = 0;
    let headerSyncs = 0;
    let normalizations = 0;
    let initialCleanups = 0;
    context.writeDbMatrix_ = (_db, rows) => { writes.push(clone(rows)); };
    context.refreshPurchasePrintProductLinks_ = () => { refreshes++; };
    context.syncProductDbHeaders_ = () => { headerSyncs++; };
    context.normalizeCurrentStatusLabels_ = () => { normalizations++; };
    context.removeObsoleteProductInputSheet_ = () => { initialCleanups++; };
    const result = invokeUndo(state, "LEGACY", "normal-legacy-sku", entryPoint);
    assert.equal(result.ok, true, result.error);
    assert.equal(result.restored, 1);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].length, 2);
    assert.equal(writes[0].filter(item => item[col("SKU ID")] === "normal-legacy-sku").length, 1);
    assert.equal(history.getRange(2, 7).getValue(), "연결 취소 · 기존행 복원");
    assert.deepEqual(history.snapshot().slice(2), unrelatedBefore);
    assert.equal(refreshes, 1);
    assert.equal(headerSyncs, entryPoint === "doPost" ? 1 : 0);
    assert.equal(normalizations, entryPoint === "doPost" ? 1 : 0);
    assert.equal(initialCleanups, entryPoint === "doPost" ? 1 : 0);
  });
}
for (const protectedStatus of ["동일모델재등록", "재등록중복정리"]) {
  test(`generic history status marking cannot replace ${protectedStatus}`, () => {
    const state = fixture([row("WR0001", "WR0001-SI")]);
    const oldRow = row("WR0001", "WR0001-SI");
    const history = state.ss.insertSheet("_SKU교체이력");
    history.getRange(1, 1, 1, 11).setValues([[...historyHeaders, "사용자 이력 메모"]]);
    history.getRange(2, 1, 1, 11).setValues([undoHistoryRow(oldRow, "WR0001", protectedStatus, "protected-batch")]);
    const dbBefore = state.db.snapshot();
    const historyBefore = history.snapshot();
    const writesBefore = history.writes.length;
    context.markReplacementHistoryStatus_(state.ss, oldRow[col("SKU ID")], "WR0001", "이관 완료 · 기존행 삭제");
    assert.deepEqual(state.db.snapshot(), dbBefore);
    assert.deepEqual(history.snapshot(), historyBefore);
    assert.equal(history.writes.length, writesBefore);
  });
}

test("ordinary history status updates still work while protected records in the same batch stay unchanged", () => {
  const state = fixture([row("WR0001", "WR0001-SI")]);
  const oldRow = row("WR0001", "WR0001-SI");
  const history = state.ss.insertSheet("_SKU교체이력");
  history.getRange(1, 1, 1, 11).setValues([[...historyHeaders, "사용자 이력 메모"]]);
  history.getRange(2, 1, 3, 11).setValues([
    undoHistoryRow(oldRow, "WR0001", "구 SKU 사용금지 · 새 SKU 대기", "mixed-batch"),
    undoHistoryRow(oldRow, "WR0001", "동일모델재등록", "mixed-batch"),
    undoHistoryRow(oldRow, "WR0001", "재등록중복정리", "mixed-batch"),
  ]);
  const protectedBefore = history.snapshot().slice(2);
  context.markReplacementHistoryStatus_(state.ss, oldRow[col("SKU ID")], "WR0001", "이관 완료 · 기존행 삭제");
  assert.equal(history.getRange(2, 7).getValue(), "이관 완료 · 기존행 삭제");
  assert.deepEqual(history.snapshot().slice(2), protectedBefore);
});
if (failures.length) {
  console.error(JSON.stringify({ passed: scenarios.length, failed: failures }, null, 2));
  process.exitCode = 1;
}

console.log(JSON.stringify({ ok: failures.length === 0, scenarios, count: scenarios.length }, null, 2));
