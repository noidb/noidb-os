const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// 실제 Google 인증·네트워크를 사용하지 않고 실제 모듈의 GET 호출 경로를 실행한다.
function loadModule(relativePath, dependencies, globals = {}) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = vm.createContext({
    module, exports: module.exports, console, Error, process: { env: {} },
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `예상하지 않은 의존성: ${name}`);
      return dependencies[name];
    },
    ...globals,
  });
  vm.runInContext(compiled, context, { filename: relativePath });
  return module.exports;
}

async function run() {
  const sheets = new Map();
  const calls = [];
  let denyMetadata = false;
  const spreadsheet = loadModule("lib/wms/google-sheets.ts", {
    "./google-service-account": {
      getWmsGoogleAccessToken: async () => "fixture-token",
      isWmsGoogleConfigured: () => true,
      WmsGoogleNotConfiguredError: class extends Error {},
    },
  }, {
    fetch: async (value, init = {}) => {
      const url = new URL(value);
      const method = init.method || "GET";
      calls.push(method);
      assert.equal(method, "GET", "조회가 시트 생성 또는 변경 요청을 보내면 안 됩니다.");
      if (url.searchParams.get("fields") === "sheets.properties") {
        if (denyMetadata) return { ok: false, status: 403, json: async () => ({ error: { message: "접근 권한 없음" } }) };
        return { ok: true, json: async () => ({ sheets: [...sheets.keys()].map((title, index) => ({ properties: { sheetId: index + 1, title, hidden: true } })) }) };
      }
      const name = decodeURIComponent(url.pathname.split("/values/")[1] || "").replace(/^'|'$/g, "");
      assert.ok(sheets.has(name), "없는 탭의 데이터 조회를 시도하면 안 됩니다.");
      return { ok: true, json: async () => ({ values: sheets.get(name) }) };
    },
  });
  const actions = loadModule("lib/wms/vendor-order-actions.ts", {
    "./google-sheets": spreadsheet,
    "./product-catalog": { normalizeSkuId: value => String(value || "").trim(), PRODUCT_DB_SHEET_NAME: "제품DB" },
    "./receiving-cost": { calculateReceivingCost: () => { throw new Error("조회 중 원가 계산 호출 금지"); } },
    "./display-name": { resolveDisplayNameAndOption: () => { throw new Error("조회 중 상품 변경 호출 금지"); } },
  });
  const route = loadModule("app/api/wms/vendor-order-actions/route.ts", {
    "next/server": { NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } },
    "@/lib/wms/vendor-order-actions": actions,
  });

  const empty = await route.GET();
  assert.equal(empty.status, 200);
  assert.equal(empty.body.success, true);
  assert.equal(empty.body.statusRequests.length, 0);
  assert.equal(empty.body.delaySummaries.length, 0);
  assert.equal(empty.body.statusFileGenerations.length, 0);
  assert.equal(sheets.size, 0, "첫 조회에서 보조 시트가 생성되면 안 됩니다.");

  sheets.set(actions.STATUS_REQUEST_SHEET, [[...actions.STATUS_REQUEST_HEADERS], [], ["request-1", "70000001", "M1", "상품", "실버, 17호", "판매중", "단종", "2026-09-04", "처리대기"]]);
  sheets.set(actions.RECEIVING_DELAY_SHEET, [[...actions.RECEIVING_DELAY_HEADERS], ["delay-1", "70000001", "M1", "상품", "실버, 17호", "거래처", "PO-1", "입고지연", "2026-09-04", "검증", "입고지연"]]);
  sheets.set(actions.STATUS_FILE_GENERATION_SHEET, [[...actions.STATUS_FILE_GENERATION_HEADERS], ["file-1", "단종", "70000001", "request-1", "2026-09-04", "요청.xlsx", "공문.pdf", "검증"]]);
  const before = JSON.stringify([...sheets.entries()]);
  const populated = await route.GET();
  assert.equal(populated.status, 200);
  assert.equal(populated.body.statusRequests[0].skuId, "70000001");
  assert.equal(populated.body.statusRequests[0].sheetRow, 3, "빈 행이 있어도 실제 시트 행번호를 보존해야 합니다.");
  assert.equal(populated.body.delaySummaries[0].active, true);
  assert.equal(populated.body.statusFileGenerations[0].xlsxFileName, "요청.xlsx");
  assert.equal(JSON.stringify([...sheets.entries()]), before, "조회 전후 모든 값이 같아야 합니다.");

  sheets.set(actions.STATUS_REQUEST_SHEET, [["잘못된 헤더"]]);
  const mismatch = await route.GET();
  assert.equal(mismatch.status, 500);
  assert.match(mismatch.body.error, /열 구성/);
  assert.equal(sheets.get(actions.STATUS_REQUEST_SHEET)[0][0], "잘못된 헤더", "조회가 헤더를 복구하거나 덮어쓰면 안 됩니다.");

  denyMetadata = true;
  const denied = await route.GET();
  assert.equal(denied.status, 500, "권한 오류를 빈 목록으로 감추면 안 됩니다.");
  assert.ok(calls.length > 0 && calls.every(method => method === "GET"));
  console.log("단종·입고지연 이력 조회 검증 통과: 없는 탭 빈 목록, 기존 값 보존, 헤더·권한 오류 차단, 운영 쓰기 0");
}

run().catch(error => { console.error(error); process.exitCode = 1; });
