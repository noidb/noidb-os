const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
function load(file, dependencies, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, console, Error, Intl, process: { env: {} }, require(name) { assert(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`); return dependencies[name]; }, ...globals }, { filename: file });
  return module.exports;
}
const plain = value => JSON.parse(JSON.stringify(value));

async function main() {
  const sheets = new Map(), requests = [], backups = [];
  let denyBackup = false;
  const json = (value, ok = true) => ({ ok, status: ok ? 200 : 403, json: async () => value });
  const spreadsheet = load("lib/wms/google-sheets.ts", { "./google-service-account": { getWmsGoogleAccessToken: async () => "isolated-fixture-token", isWmsGoogleConfigured: () => true, WmsGoogleNotConfiguredError: class extends Error {} } }, {
    fetch: async (address, init = {}) => {
      const url = new URL(address), method = init.method || "GET";
      const body = init.body ? JSON.parse(init.body) : null;
      requests.push({ method, path: url.pathname, body });
      if (method === "GET" && url.searchParams.get("fields") === "sheets.properties") return json({ sheets: [...sheets.entries()].map(([title, sheet]) => ({ properties: { sheetId: sheet.id, title, hidden: true, gridProperties: { columnCount: sheet.columns } } })) });
      if (method === "GET" && url.pathname.includes("/values/")) {
        const title = decodeURIComponent(url.pathname.split("/values/")[1]).replace(/^'|'$/g, "");
        assert(sheets.has(title)); return json({ values: plain(sheets.get(title).rows) });
      }
      if (method === "POST" && url.pathname.endsWith(":batchUpdate") && !url.pathname.endsWith("/values:batchUpdate")) {
        if (denyBackup && body.requests.some(request => request.duplicateSheet)) return json({ error: { message: "Fixture backup refused" } }, false);
        const replies = [];
        for (const request of body.requests) {
          if (request.duplicateSheet) { const source = [...sheets.values()].find(sheet => sheet.id === request.duplicateSheet.sourceSheetId); backups.push(plain(source)); replies.push({}); }
          else if (request.updateSheetProperties) replies.push({});
          else if (request.addSheet) { const property = request.addSheet.properties; sheets.set(property.title, { id: 71, columns: property.gridProperties.columnCount, rows: [] }); replies.push({ addSheet: { properties: { sheetId: 71 } } }); }
          else if (request.appendDimension) { assert.equal(request.appendDimension.dimension, "COLUMNS"); const sheet = [...sheets.values()].find(sheet => sheet.id === request.appendDimension.sheetId); sheet.columns += request.appendDimension.length; replies.push({}); }
          else if (request.updateCells) { const update = request.updateCells, range = update.range; assert.equal(update.fields, "userEnteredValue"); assert.equal(range.startRowIndex, 0); assert.equal(range.endRowIndex, 1); assert.equal(range.startColumnIndex, 11); assert.equal(range.endColumnIndex, 12); const sheet = [...sheets.values()].find(sheet => sheet.id === range.sheetId); assert(sheet.columns >= 12); sheet.rows[0][11] = update.rows[0].values[0].userEnteredValue.stringValue; replies.push({}); }
          else assert.fail("Unexpected sheet mutation");
        }
        return json({ replies });
      }
      if (method === "POST" && url.pathname.endsWith("/values:batchUpdate")) {
        for (const entry of body.data) { const match = entry.range.match(/^'(.+)'!([A-Z]+)(\d+)$/); assert(match); const column = match[2].split("").reduce((result, value) => result * 26 + value.charCodeAt(0) - 64, 0) - 1; const sheet = sheets.get(match[1]); sheet.rows[Number(match[3]) - 1] ||= []; sheet.rows[Number(match[3]) - 1][column] = entry.values[0][0]; }
        return json({});
      }
      if (method === "POST" && url.pathname.includes("/values/") && url.pathname.endsWith(":append")) { const title = decodeURIComponent(url.pathname.split("/values/")[1]).replace(/!A:A:append$/, "").replace(/^'|'$/g, ""); assert(sheets.has(title)); sheets.get(title).rows.push(...plain(body.values)); return json({}); }
      assert.fail(`Never forward fixture request ${method} ${url.pathname}`);
    },
  });
  const normalizeSkuId = value => String(value || "").trim();
  const pure = load("lib/wms/vendor-order/receiving-delay.ts", { "../sku-normalize": { normalizeSkuId } });
  const actions = load("lib/wms/vendor-order-actions.ts", { "./google-sheets": spreadsheet, "./product-catalog": { normalizeSkuId, PRODUCT_DB_SHEET_NAME: "제품DB" }, "./receiving-cost": {}, "./display-name": {}, "./vendor-order/receiving-delay": pure });
  const writeCount = () => requests.filter(request => request.method !== "GET").length;
  assert.equal((await actions.listReceivingDelaySummaries()).length, 0); assert.equal(writeCount(), 0); assert.equal(sheets.size, 0);
  const originalRows = [[...actions.RECEIVING_DELAY_HEADERS], ["old", "80000001", "M1", "상품", "실버, 20호", "기존거래처", "140000001", "입고지연", "2026-09-04T15:30:00Z", "fixture", "입고지연"]];
  sheets.set(actions.RECEIVING_DELAY_SHEET, { id: 71, columns: 11, rows: plain(originalRows) });
  const legacy = await actions.listReceivingDelaySummaries(); assert.equal(legacy[0].memo, ""); assert.equal(writeCount(), 0);
  const input = { skuId: "80000002", modelSku: "M2", productName: "반지", optionLabel: "실버, 20호", vendorName: "검증거래처", purchaseOrderNumber: "140000002", operator: "fixture", delayed: true, memo: "다음 주 금요일 입고", expectedLastActionAt: null };
  const added = await actions.recordReceivingDelay(input);
  assert.equal(added.active, true); assert.equal(added.memo, input.memo); assert.equal(added.vendorName, input.vendorName);
  const stored = sheets.get(actions.RECEIVING_DELAY_SHEET);
  assert.equal(stored.columns, 12); assert.equal(stored.rows[0][11], "메모"); assert.deepEqual(stored.rows.slice(0, 2).map(row => row.slice(0, 11)), originalRows);
  assert.equal(backups.length, 1); assert.deepEqual(backups[0].rows, originalRows);
  assert.equal(stored.rows[2][11], input.memo);
  const beforeRepeat = writeCount(); await actions.recordReceivingDelay(input); assert.equal(writeCount(), beforeRepeat, "Repeated delay state must not append again.");
  await assert.rejects(() => actions.recordReceivingDelay({ ...input, delayed: false, expectedLastActionAt: "stale" }), /다른 화면/); assert.equal(writeCount(), beforeRepeat);
  const released = await actions.recordReceivingDelay({ ...input, delayed: false, memo: "입고 확인", expectedLastActionAt: added.lastActionAt });
  assert.equal(released.active, false); assert.equal(released.recentDelayedAt, added.recentDelayedAt); assert.equal(released.memo, "입고 확인"); assert.equal(backups.length, 1);
  const final = (await actions.listReceivingDelaySummaries()).find(summary => summary.skuId === input.skuId); assert.deepEqual(plain(final), plain(released));
  assert.equal(pure.receivingDelayDate("2026-09-04T15:30:00Z"), "2026-09-05");
  assert.throws(() => pure.validateReceivingDelayChange({ delayed: "true" }), /처리 구분/);
  assert.throws(() => pure.validateReceivingDelayChange({ delayed: true, memo: "x".repeat(501) }), /500자/);

  stored.rows = plain(originalRows); stored.columns = 11; denyBackup = true;
  const beforeDenied = plain(stored.rows);
  await assert.rejects(() => actions.recordReceivingDelay(input), /백업/); assert.deepEqual(stored.rows, beforeDenied); assert.equal(stored.columns, 11);
  denyBackup = false; stored.rows[0][11] = "사용자 데이터";
  const beforeMismatch = writeCount(); await assert.rejects(() => actions.recordReceivingDelay(input), /메모 열/); assert.equal(writeCount(), beforeMismatch);
  stored.rows[0][11] = ""; stored.rows[1][11] = "기존 미지정 값";
  await assert.rejects(() => actions.recordReceivingDelay(input), /다른 데이터/); assert.equal(writeCount(), beforeMismatch);

  sheets.clear(); const created = await actions.recordReceivingDelay(input);
  assert.equal(created.active, true); assert.equal(sheets.get(actions.RECEIVING_DELAY_SHEET).columns, 12); assert.equal(sheets.get(actions.RECEIVING_DELAY_SHEET).rows[0][11], "메모");
  console.log(JSON.stringify({ passed: true, actualModules: true, isolatedNetwork: true, legacyReadWrites: 0, optionalMemoColumnBackedUp: true, oldCellsPreserved: true, retryNoDuplicate: true, staleChangeBlocked: true, releaseHistoryPreserved: true, newSheet12Columns: true, operatingWrites: 0 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
