const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// 실제 시트 API 대신 메모리 시트만 사용하며, 프로덕션 함수 자체를 실행한다.
function loadTs(relativePath, mocks = {}) {
  const filename = path.resolve(__dirname, "..", relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
    reportDiagnostics: true,
  });
  const diagnostics = (compiled.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error);
  assert.equal(diagnostics.length, 0, JSON.stringify(diagnostics));
  const module = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + compiled.outputText + "\n})", { filename })(
    name => Object.hasOwn(mocks, name) ? mocks[name] : name === "./sku-retirement" ? loadTs("lib/wms/sku-retirement.ts", mocks) : require(name), module, module.exports
  );
  return module.exports;
}

const clone = value => JSON.parse(JSON.stringify(value));
const headers = ["현재상태", "모델SKU", "SKU ID", "쿠팡 바코드", "상품명", "누적입고", "창고번호", "발주가능상태", "계산식"];
const initial = [
  headers,
  ["등록파일생성", "NEW001-SI", "", "", "신상품", "0", "N-01", "", "=SUM(F2:F2)"],
  ["재등록파일생성", "OLD001-GO", "", "", "재등록상품", "158", "A-05", "", "=SUM(F3:F3)"],
  ["완료", "LIVE001-BK", "77777777", "R77777777", "판매상품", "12", "C-02", "정상", "=F4"],
];
const history = [
  ["처리일시", "이전모델명", "새모델명", "이전 SKU ID", "이전 바코드", "창고번호", "처리상태", "연결묶음", "기존행전체정보", "새행연결전정보"],
  ["2026-09-08T00:30:00.000Z", "OLD001", "OLD001", "11111111", "R11111111", "A-05", "동일모델재등록", "op-1",
    JSON.stringify({ headers, values: ["판매중지", "OLD001-GO", "11111111", "R11111111", "이전상품", "158", "A-05", "판매중지"] }), ""],
];
const row = (modelSku, status, fields = {}) => ({
  modelSku, status, productName: "새 상품 " + modelSku, skuId: "", barcode: "",
  estimateId: "estimate-" + modelSku, statusLabel: status, registeredAt: "2026/09/08 10:00:00", ...fields,
});
const reviewing = [row("NEW001-SI", "reviewing"), row("OLD001-GO", "reviewing")];
let current = clone(initial);
let currentHistory = clone(history);
let updates = [];
let backups = 0;
let afterBackup = null;
let corruptWrite = false;
const auditModule = loadTs("lib/wms/wims-registration-audit.ts", {
  "./product-catalog": { PRODUCT_DB_SHEET_NAME: "제품DB" },
  "./google-sheets": {
    fetchSheetRows: async name => clone(name === "제품DB" ? current : currentHistory),
    backupSheetWithinSpreadsheet: async () => {
      backups += 1;
      if (afterBackup) afterBackup();
      return { sheetName: "_백업_제품DB_test" };
    },
    updateSheetCells: async (_name, cells) => {
      updates.push(...clone(cells));
      if (!corruptWrite) for (const cell of cells) current[cell.row - 1][cell.col - 1] = cell.value;
    },
  },
});
const { buildWimsRegistrationAuditFromRows: auditRows, buildWimsRegistrationCellUpdates: cellsFor,
  buildWimsRegistrationAudit, applyWimsRegistrationAudit, applyWimsRejectionDecision } = auditModule;
let checks = 0;
function test(name, fn) { fn(); checks += 1; console.log("PASS " + name); }

test("검수중 신상·재등록의 정확한 상태 제안과 기본 승인 전용 호환", () => {
  const audit = auditRows(reviewing, initial, history);
  assert.equal(audit.readOnly, true);
  assert.equal(audit.reviewingCandidateCount, 2);
  assert.deepEqual(audit.rows.map(item => item.proposedStatus), ["신상승인대기", "기존상품승인대기"]);
  assert.deepEqual(cellsFor(initial, audit), []);
  assert.deepEqual(cellsFor(initial, audit, true), [
    { row: 2, col: 1, value: "신상승인대기" }, { row: 3, col: 1, value: "기존상품승인대기" },
  ]);
  assert.deepEqual(initial[2].slice(2), ["", "", "재등록상품", "158", "A-05", "", "=SUM(F3:F3)"]);
});
test("모델SKU 구분기호 불일치·중복 DB·중복 WIMS는 자동 연결 금지", () => {
  assert.equal(auditRows([row("NEW001_SI", "reviewing")], initial).unmatchedCount, 1);
  const duplicateDb = clone(initial); duplicateDb.push(clone(initial[1]));
  assert.equal(auditRows([reviewing[0]], duplicateDb).conflictCount, 1);
  const duplicateWims = auditRows([reviewing[0], row("NEW001-SI", "reviewing", { estimateId: "other" })], initial);
  assert.equal(duplicateWims.conflictCount, 2);
  assert.equal(duplicateWims.reviewingCandidateCount, 0);
  assert.deepEqual(cellsFor(initial, duplicateWims, true), []);
});
test("SKU ID와 모델SKU가 다른 행을 지목하면 차단", () => {
  const audit = auditRows([row("NEW001-SI", "reviewing", { skuId: "77777777" })], initial);
  assert.equal(audit.conflictCount, 1);
  assert.equal(audit.reviewingCandidateCount, 0);
});
test("재등록 이전 승인 SKU·이전 검수일을 차단하고 이번 등록만 연결", () => {
  const oldApproval = row("OLD001-GO", "approved", { skuId: "11111111", barcode: "R11111111" });
  const currentApproval = row("OLD001-GO", "approved", { skuId: "22222222", barcode: "R22222222" });
  const audit = auditRows([oldApproval, currentApproval], initial, history);
  assert.equal(audit.approvedCandidateCount, 1);
  assert.equal(audit.conflictCount, 0);
  assert.equal(audit.rows[0].type, "unmatched");
  assert.equal(audit.rows[1].sheetRowNumber, 3);
  for (const registeredAt of ["2026/09/07", "2026/09/08", "2026/09/08 09:00:00", ""]) {
    assert.equal(auditRows([row("OLD001-GO", "reviewing", { registeredAt })], initial, history).reviewingCandidateCount, 0);
  }
  assert.equal(auditRows([reviewing[1]], initial).reviewingCandidateCount, 0, "이력이 없으면 재등록 입증 불가");
  const legacyHistory = clone(history);
  const original = Array(36).fill(""); original[5] = "OLD001-GO";
  legacyHistory[1][8] = JSON.stringify(original);
  assert.equal(auditRows([reviewing[1]], initial, legacyHistory).reviewingCandidateCount, 1);
});
test("오늘 수동 중복정리는 정리시각 이전의 새 업로드를 허용하고 이전 SKU를 전역 제외", () => {
  const cleaned = clone(initial); cleaned[2][0] = "등록파일생성";
  const cleanupHistory = clone(history);
  cleanupHistory[1][0] = "2026-09-08T10:00:00.000Z";
  cleanupHistory[1][6] = "재등록중복정리";
  cleanupHistory[1][8] = JSON.stringify({ headers, values: ["판매중지", "재등록", "11111111"] });
  cleanupHistory[1][9] = JSON.stringify({ headers, values: cleaned[2] });
  const audit = auditRows([row("재등록", "approved", { skuId: "11111111", barcode: "R11111111" }), reviewing[1]], cleaned, cleanupHistory);
  assert.equal(audit.rows[0].type, "unmatched");
  assert.equal(audit.rows[1].proposedStatus, "기존상품승인대기");
  const approved = auditRows([row("OLD001-GO", "approved", { skuId: "22222222", barcode: "R22222222" })], cleaned, cleanupHistory);
  assert.equal(approved.approvedCandidateCount, 1);
});
test("이미 연결된 승인대기 행도 완료로 전환하고 판매중지 행은 보호", () => {
  const sheet = clone(initial);
  sheet[3][0] = "신상승인대기";
  const approved = row("LIVE001-BK", "approved", { skuId: "77777777", barcode: "R77777777", productName: "판매상품" });
  const audit = auditRows([approved], sheet);
  assert.equal(audit.approvedCandidateCount, 1);
  assert.deepEqual(cellsFor(sheet, audit), [{ row: 4, col: 1, value: "완료" }]);
  sheet[3][0] = "판매중지"; sheet[3][2] = ""; sheet[3][3] = "";
  assert.equal(auditRows([approved], sheet).conflictCount, 1);
});
test("쓰기 직전 대상 행·상태 변경 차단 및 현재 헤더 위치 사용", () => {
  const audit = auditRows(reviewing, initial, history);
  const changed = clone(initial); changed[1][0] = "완료";
  assert.throws(() => cellsFor(changed, audit, true), /식별정보 또는 현재상태/);
  const reordered = initial.map(item => [...item].reverse());
  const reorderedAudit = auditRows(reviewing, reordered, history);
  assert.deepEqual(cellsFor(reordered, reorderedAudit, true).map(item => item.col), [9, 9]);
});

async function integrationTests() {
  const beforeAudit = clone(current);
  const first = await buildWimsRegistrationAudit(reviewing);
  assert.deepEqual(current, beforeAudit);
  assert.equal(updates.length, 0);
  await assert.rejects(() => applyWimsRegistrationAudit(reviewing, "stale-token", true), /미리보기 이후 변경/);
  assert.equal(backups, 0);
  const pendingResult = await applyWimsRegistrationAudit(reviewing, first.dryRunToken, true);
  assert.equal(pendingResult.writtenRowCount, 2); assert.equal(pendingResult.writtenCellCount, 2);
  assert.deepEqual(updates.map(item => item.col), [1, 1]);
  assert.equal(current[1][0], "신상승인대기"); assert.equal(current[2][0], "기존상품승인대기");
  assert.deepEqual(current[1].slice(1), initial[1].slice(1));
  assert.deepEqual(current[2].slice(1), initial[2].slice(1));
  assert.deepEqual(current[3], initial[3]);
  const approved = [row("NEW001-SI", "approved", { skuId: "33333333", barcode: "R33333333" }),
    row("OLD001-GO", "approved", { skuId: "22222222", barcode: "R22222222" })];
  const approvedAudit = await buildWimsRegistrationAudit(approved);
  const approvedResult = await applyWimsRegistrationAudit(approved, approvedAudit.dryRunToken, true);
  assert.equal(approvedResult.writtenRowCount, 2);
  assert.equal(current[2][0], "완료"); assert.equal(current[2][2], "22222222"); assert.equal(current[2][3], "R22222222");
  assert.deepEqual(current[2].slice(5), initial[2].slice(5));
  const repeat = await buildWimsRegistrationAudit(approved);
  assert.equal(repeat.alreadyLinkedCount, 2);
  const writesBeforeRepeat = updates.length, backupsBeforeRepeat = backups;
  assert.equal((await applyWimsRegistrationAudit(approved, repeat.dryRunToken, true)).applied, false);
  assert.equal(updates.length, writesBeforeRepeat); assert.equal(backups, backupsBeforeRepeat);
  checks += 1; console.log("PASS 실제 apply 함수: 읽기 전용 대조 → 검수중 반영 → 승인 완료 → 반복 멱등성·비대상 데이터 보존");

  current = clone(initial); updates = [];
  const stale = await buildWimsRegistrationAudit(reviewing);
  afterBackup = () => { current[1][0] = "완료"; };
  await assert.rejects(() => applyWimsRegistrationAudit(reviewing, stale.dryRunToken, true), /백업 중 변경/);
  assert.equal(updates.length, 0);
  afterBackup = null; current = clone(initial); corruptWrite = true;
  const beforeFailedWrite = await buildWimsRegistrationAudit(reviewing);
  await assert.rejects(() => applyWimsRegistrationAudit(reviewing, beforeFailedWrite.dryRunToken, true), /반영 후 검증/);
  corruptWrite = false;
  checks += 1; console.log("PASS 백업 중 데이터 변경 차단 및 API 성공 후 실제 값 미반영 검출");

  current = clone(initial); updates = [];
  const rejection = [row("OLD001-GO", "rejected")];
  const rejectionAudit = await buildWimsRegistrationAudit(rejection);
  const rejectionResult = await applyWimsRejectionDecision(rejection, rejectionAudit.dryRunToken, 3, "재등록시도");
  assert.equal(rejectionResult.applied, true);
  assert.equal(current[2][0], "재등록시도");
  assert.deepEqual(current[2].slice(1), initial[2].slice(1));
  current = clone(initial);
  const ambiguousRejected = [rejection[0], row("OLD001-GO", "rejected", { estimateId: "second" })];
  const ambiguousAudit = await buildWimsRegistrationAudit(ambiguousRejected);
  await assert.rejects(() => applyWimsRejectionDecision(ambiguousRejected, ambiguousAudit.dryRunToken, 3, "등록불가"), /정확히 연결된 반려/);
  checks += 1; console.log("PASS 재등록파일생성 반려 처리 및 중복 견적서 반려 조치 차단");

  const { NextRequest } = require("next/server");
  let authenticated = false;
  let apiCalls = [];
  const route = loadTs("app/api/wms/wims-registration/apply/route.ts", {
    "@/lib/wms/wims-registration-audit": { applyWimsRegistrationAudit: async (...args) => { apiCalls.push(args); return { applied: false }; } },
    "@/lib/wms/noidb-action-auth": { hasNoidbActionSession: () => authenticated, isSameOriginActionRequest: () => true },
  });
  const request = body => new NextRequest("https://example.test/api/wms/wims-registration/apply", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  assert.equal((await route.POST(request({}))).status, 401);
  authenticated = true;
  assert.equal((await route.POST(request({ rows: reviewing, dryRunToken: "test", includeReviewing: true, confirmation: "WIMS 검수완료 상품 연결" }))).status, 423);
  assert.equal((await route.POST(request({ rows: reviewing, dryRunToken: "test", includeReviewing: true, confirmation: "WIMS 검수상태 반영" }))).status, 200);
  assert.equal(apiCalls.length, 1); assert.equal(apiCalls[0][2], true);
  checks += 1; console.log("PASS 실제 API 인증·확인문구·includeReviewing 전달 검증");
  console.log("WIMS 검수상태·재등록 승인 흐름 " + checks + "개 검증 그룹 통과 (외부 쓰기 없음)");
}
integrationTests().catch(error => { console.error(error); process.exitCode = 1; });
