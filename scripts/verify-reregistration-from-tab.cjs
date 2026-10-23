// 재등록SKU 탭(판매중지SKU·실적저조SKU·그 외 재등록SKU)에서 가져온 모델은 판매중지 검사 없이 재등록 가능한지 확인한다.
// 구글시트 스크립트(templates/구글시트_상품DB_연동.gs)를 가짜 시트로 실행해 본다. 실행: node scripts/verify-reregistration-from-tab.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "templates", "구글시트_상품DB_연동.gs"), "utf8");
const sandbox = { console, Date, Math, JSON, String, Number, Object, Array, Boolean, Error, RegExp, Set, Map };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "gs" });

const HEADERS = ["현재상태", "모델명/품번", "모델SKU", "SKU ID", "바코드", "발주가능상태", "제품링크", "노출상품ID", "옵션ID", "기본순서", "패키지", "상품명"];
const row = (state, sku, extra = {}) => HEADERS.map(name => {
  if (name in extra) return extra[name];
  return ({ "현재상태": state, "모델명/품번": "we20240406", "모델SKU": sku, "SKU ID": "1", "바코드": "B", "발주가능상태": "정상", "제품링크": "L", "노출상품ID": "N", "옵션ID": "O", "기본순서": 1, "패키지": "", "상품명": "써지컬스틸 귀걸이" })[name];
});

function fakeSheet(headers, rows) {
  return {
    getLastRow: () => rows.length + 1,
    getLastColumn: () => headers.length,
    getRange: (r, c, nRows, nCols) => {
      const data = r === 1 ? [headers] : rows.slice(r - 2, r - 2 + nRows);
      const cut = data.map(line => line.slice(c - 1, c - 1 + nCols));
      return { getDisplayValues: () => cut, getValues: () => cut, getFormulas: () => cut.map(line => line.map(() => "")) };
    },
  };
}
function fakeDb(dbRows, tabs) {
  const db = fakeSheet(HEADERS, dbRows);
  const sheets = {};
  Object.keys(tabs).forEach(name => { sheets[name] = fakeSheet(HEADERS, tabs[name]); });
  db.getParent = () => ({ getSheetByName: name => sheets[name] || null });
  return db;
}
const check = (dbRows, tabs) => sandbox.reregistrationEligibility_(fakeDb(dbRows, tabs), "we20240406");

// 1) 탭 줄 + 제품DB에 정상으로 남은 같은 모델 줄 → 예전에는 막혔지만 이제는 재등록 가능
for (const tab of ["판매중지SKU", "실적저조SKU", "그 외 재등록SKU"]) {
  const r = check([row("정상", "we20240406SI")], { [tab]: [row("재등록대상", "we20240406GO")] });
  assert.equal(r.reregisterable, true, `${tab}: 탭에서 온 모델은 재등록 가능해야 함 (${r.reason})`);
}
// 2) 탭에서 온 줄이 패키지 표시여도 막지 않는다
const other = row("정상", "other1SI", { "모델명/품번": "other1" });
const pack = check([other], { "실적저조SKU": [row("재등록대상", "we20240406GO", { "패키지": "2개입" })] });
assert.equal(pack.reregisterable, true, "탭 줄은 패키지 검사를 건너뜀");
// 3) 탭에 없고 제품DB에만 정상으로 있는 모델은 그대로 막는다(다른 경로는 검사 유지)
const dbOnly = check([row("정상", "we20240406SI")], {});
assert.equal(dbOnly.reregisterable, false);
assert.match(dbOnly.reason, /판매중지 기본 옵션만/);
// 4) 제품DB에 원래 있던 패키지 줄은 탭 줄이 있어도 막는다
const dbPack = check([row("정상", "we20240406SI", { "패키지": "2개입" })], { "판매중지SKU": [row("판매중지", "we20240406GO")] });
assert.equal(dbPack.reregisterable, false, "제품DB 패키지 줄은 계속 차단");
// 5) 탭 줄을 제품DB로 옮긴 직후 두 번째 확인(pulledFromTab)은 통과
const second = sandbox.reregistrationEligibility_(fakeDb([row("정상", "we20240406SI"), row("재등록대상", "we20240406GO", { "패키지": "2개입" })], {}), "we20240406", { pulledFromTab: true });
assert.equal(second.reregisterable, true, "옮긴 직후 재확인 통과");

console.log("PASS 재등록SKU 탭에서 가져온 모델은 판매중지 검사 없이 재등록 가능, 다른 경로는 검사 유지");
