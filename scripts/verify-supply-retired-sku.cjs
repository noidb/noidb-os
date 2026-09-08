const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const ExcelJS = require("exceljs");
const clone = value => JSON.parse(JSON.stringify(value));
const root = path.resolve(__dirname, "..");
const products = [
  ["현재상태", "모델SKU", "SKU ID", "상품명", "색상", "바코드", "발주가능상태", "누적입고", "창고번호"],
  ["기존상품승인대기", "OLD001-SI", "", "재등록상품", "실버", "", "", "83", "711"],
  ["신상승인대기", "NEW001-GO", "", "신상품", "골드", "", "", "0", "712"],
  ["완료", "LIVE001-BK", "77777777", "기존상품", "블랙", "R77777777", "중지", "20", "713"],
];
const historyHeaders = ["처리일시", "이전모델명", "새모델명", "이전 SKU ID", "이전 바코드", "창고번호", "처리상태"];
const initialHistory = [historyHeaders,
  ["2026-09-08T00:00:00.000Z", "OLD001", "OLD001", "11111111", "R11111111", "711", "동일모델재등록"],
  ["2026-09-08T01:00:00.000Z", "수동재등록", "OTHER001", "99999999", "R99999999", "714", "재등록중복정리"],
];
const downloadHeaders = ["모델SKU", "SKU ID", "상품명", "색상옵션명", "바코드", "발주가능상태"];
const oldDownload = ["OLD001-SI", "11111111", "재등록상품", "실버", "R11111111", "정상"];
const newDownload = ["OLD001-SI", "22222222", "재등록상품", "실버", "R22222222", "정상"];
const newProduct = ["NEW001-GO", "33333333", "신상품", "골드", "R33333333", "정상"];
const liveDownload = ["LIVE001-BK", "77777777", "기존상품", "블랙", "R77777777", "정상"];
let sheet = clone(products), history = clone(initialHistory), writes = [], backupCount = 0;
let historyError = null, afterBackup = null, workbookBuffer;
const sheetMocks = {
  fetchSheetRows: async name => {
    if (name === "_SKU교체이력" && historyError) throw historyError;
    return clone(name === "_SKU교체이력" ? history : sheet);
  },
  backupSheetWithinSpreadsheet: async () => {
    backupCount += 1;
    if (afterBackup) afterBackup();
    return { sheetName: "_백업_제품DB_test" };
  },
  updateSheetCells: async (_name, cells) => {
    writes.push(...clone(cells));
    for (const cell of cells) sheet[cell.row - 1][cell.col - 1] = cell.value;
  },
};
const mocks = {
  "./google-sheets": sheetMocks,
  "./product-catalog": { PRODUCT_DB_SHEET_NAME: "제품DB" },
  "./google-drive-reader": {
    isDriveReaderConfigured: () => true, shouldRequireDriveReader: () => true,
    listDriveFilesFromEnv: async () => [{ id: "fixture", name: "fixture.xlsx", modifiedTime: "2026-09-08T04:00:00.000Z" }],
    downloadDriveFile: async () => workbookBuffer,
  },
};
const cache = new Map();
function loadTs(relativePath) {
  const filename = path.resolve(root, relativePath);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} }; cache.set(filename, module);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
  }).outputText;
  const customRequire = name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith(".")) {
      let dependency = path.resolve(path.dirname(filename), name);
      if (!path.extname(dependency)) dependency += ".ts";
      return loadTs(path.relative(root, dependency));
    }
    return require(name);
  };
  vm.runInThisContext("(function(require,module,exports){" + compiled + "\n})", { filename })(customRequire, module, module.exports);
  return module.exports;
}
const supply = loadTs("lib/wms/supply-status-update.ts");
const retirement = loadTs("lib/wms/sku-retirement.ts");
const capture = rows => ({
  schemaVersion: 1, source: "supplier-hub-live", headers: downloadHeaders, rows,
  capturedAt: "2026-09-08T04:00:00.000Z", sourceUrl: "https://supplier.coupang.com/plan/ticket/supplySkuList",
  totalRowCount: rows.length, pageCount: 1, pageSize: 100, coverageComplete: true,
});
function reset() { sheet = clone(products); history = clone(initialHistory); writes = []; backupCount = 0; historyError = null; afterBackup = null; }
async function prepareFile(rows) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("상품공급상태");
  ws.addRow(downloadHeaders); rows.forEach(row => ws.addRow(row));
  workbookBuffer = Buffer.from(await wb.xlsx.writeBuffer());
}
let checks = 0;
async function test(name, run) { reset(); await run(); checks += 1; console.log("PASS " + name); }
(async () => {
  await test("공통 이력 파서: 동일모델재등록·수동중복정리만 retired SKU 수집, 헤더 순서와 정확 ID 보존", async () => {
    assert.deepEqual([...retirement.collectRetiredSkuIds(initialHistory)].sort(), ["11111111", "99999999"]);
    assert.deepEqual([...retirement.collectRetiredSkuIds([["이전 SKU ID", "처리상태"], [" ABC-1 ", "동일모델재등록"], ["ABC_1", "일반연결"]])], ["ABC-1"]);
    assert.throws(() => retirement.collectRetiredSkuIds([["잘못된 헤더"], ["11111111"]]), /SKU교체이력/);
  });
  await test("실시간 오래된 공급목록은 이전 SKU를 재등록행에 복원하지 않음", async () => {
    const c = capture([oldDownload]);
    const audit = await supply.buildSupplyStatusAudit(c);
    assert.equal(audit.newApprovalCandidateCount, 0); assert.equal(audit.safeUpdateCount, 0);
    assert(audit.issues.some(issue => issue.skuId === "11111111" && issue.message.includes("이전 SKU")));
    const result = await supply.applySupplyStatusAudit(audit.dryRunToken, c);
    assert.equal(result.applied, false); assert.equal(backupCount, 0); assert.deepEqual(writes, []);
    assert.deepEqual(sheet, products);
  });
  await test("이전·새 SKU가 같이 있어도 새 승인만 연결하고 정상 신상승인·기존SKU 갱신 유지", async () => {
    const c = capture([oldDownload, newDownload, newProduct, liveDownload]);
    const audit = await supply.buildSupplyStatusAudit(c);
    assert.equal(audit.newApprovalCandidateCount, 2); assert.equal(audit.duplicateCount, 0);
    assert.equal(audit.existingAvailabilityChangeCount, 1);
    const result = await supply.applySupplyStatusAudit(audit.dryRunToken, c);
    assert.equal(result.newApprovalCount, 2); assert.equal(result.existingSkuUpdateCount, 1);
    assert.equal(sheet[1][2], "22222222"); assert.equal(sheet[2][2], "33333333"); assert.equal(sheet[3][6], "정상");
    assert.equal(writes.some(cell => cell.value === "11111111"), false);
    sheet.slice(1).forEach((row, index) => assert.deepEqual(row.slice(7), products[index + 1].slice(7)));
  });
  await test("수동중복정리 이전 SKU도 모델명 변경과 무관하게 전역 차단", async () => {
    const c = capture([["NEW001-GO", "99999999", "신상품", "골드", "R99999999", "정상"]]);
    const audit = await supply.buildSupplyStatusAudit(c);
    assert.equal(audit.newApprovalCandidateCount, 0);
    assert.equal((await supply.applySupplyStatusAudit(audit.dryRunToken, c)).applied, false);
    assert.deepEqual(writes, []);
  });
  await test("교체이력 권한오류·잘못된 헤더는 승인 쓰기 전에 차단", async () => {
    historyError = new Error("Permission denied");
    await assert.rejects(() => supply.buildSupplyStatusAudit(capture([newProduct])), /이력을 확인하지/);
    historyError = null; history = [["잘못된 헤더"], ["11111111"]];
    await assert.rejects(() => supply.buildSupplyStatusAudit(capture([newProduct])), /SKU교체이력/);
    assert.deepEqual(writes, []); assert.equal(backupCount, 0);
  });
  await test("과거부터 이력탭이 없는 정상 신규승인은 유지, 재등록파일생성은 이력 필수", async () => {
    historyError = new Error("Unable to parse range: _SKU교체이력");
    const c = capture([newProduct]); const audit = await supply.buildSupplyStatusAudit(c);
    assert.equal(audit.newApprovalCandidateCount, 1);
    sheet[1][0] = "재등록파일생성";
    await assert.rejects(() => supply.buildSupplyStatusAudit(c), /이력을 확인하지/);
  });
  await test("재등록파일생성은 빈 이력·머리글만 있는 이력도 차단하고 기존 신상승인은 유지", async () => {
    sheet[1][0] = "재등록파일생성";
    for (const emptyHistory of [[], [historyHeaders]]) {
      history = clone(emptyHistory);
      await assert.rejects(() => supply.buildSupplyStatusAudit(capture([newProduct])), /필수 SKU교체이력이 비어/);
    }
    assert.deepEqual(writes, []); assert.equal(backupCount, 0);
    sheet[1][0] = "기존상품승인대기";
    assert.equal((await supply.buildSupplyStatusAudit(capture([newProduct]))).newApprovalCandidateCount, 1);
  });
  await test("미리보기 후·백업 중 SKU가 교체이력에 추가되면 토큰 변경으로 쓰기 차단", async () => {
    const c = capture([newDownload]); const audit = await supply.buildSupplyStatusAudit(c);
    history.push(["2026-09-08T05:00:00.000Z", "OLD001", "OLD001", "22222222", "R22222222", "711", "동일모델재등록"]);
    await assert.rejects(() => supply.applySupplyStatusAudit(audit.dryRunToken, c), /dry-run 이후/);
    assert.equal(backupCount, 0); assert.deepEqual(writes, []);
    history = clone(initialHistory); const fresh = await supply.buildSupplyStatusAudit(c);
    afterBackup = () => history.push(["2026-09-08T05:00:00.000Z", "OLD001", "OLD001", "22222222", "R22222222", "711", "동일모델재등록"]);
    await assert.rejects(() => supply.applySupplyStatusAudit(fresh.dryRunToken, c), /dry-run 이후/);
    assert.deepEqual(writes, []);
  });
  await test("레거시 XLSX 미리보기와 쓰기도 오래된 SKU 재연결 차단", async () => {
    await prepareFile([oldDownload]);
    const preview = await supply.buildSupplyStatusPreview(); assert.equal(preview.eligibleCount, 0);
    assert.equal((await supply.applySupplyStatusUpdate(preview.dryRunToken)).applied, false);
    assert.deepEqual(writes, []); assert.equal(backupCount, 0);
  });
  await test("레거시 XLSX에서 새 승인만 정상 연결하고 재읽기 때 이력 변경 차단", async () => {
    await prepareFile([oldDownload, newDownload, newProduct]);
    let preview = await supply.buildSupplyStatusPreview(); assert.equal(preview.eligibleCount, 2); assert.equal(preview.duplicateCount, 0);
    const result = await supply.applySupplyStatusUpdate(preview.dryRunToken); assert.equal(result.writtenCount, 2);
    assert.equal(sheet[1][2], "22222222"); assert.equal(sheet[2][2], "33333333");
    assert.deepEqual(sheet[1].slice(7), products[1].slice(7));
    reset(); await prepareFile([newDownload]); preview = await supply.buildSupplyStatusPreview();
    afterBackup = () => history.push(["2026-09-08T05:00:00.000Z", "OLD001", "OLD001", "22222222", "R22222222", "711", "동일모델재등록"]);
    await assert.rejects(() => supply.applySupplyStatusUpdate(preview.dryRunToken), /dry-run 이후/);
    assert.deepEqual(writes, []);
  });
  console.log("상품공급상태 이전 SKU 재연결 방지 " + checks + "개 검증 그룹 통과 (실제 함수·메모리 XLSX, 외부 쓰기 없음)");
})().catch(error => { console.error(error); process.exitCode = 1; });
