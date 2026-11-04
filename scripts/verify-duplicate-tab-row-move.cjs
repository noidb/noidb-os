// 2026-11-04 재등록 때 같은 모델SKU의 옛 중복 줄을 비관리SKU로 옮기는 동작 검사. 실행: node scripts/verify-duplicate-tab-row-move.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require("node:path").join(__dirname, "..", "templates", "구글시트_상품DB_연동.gs"), "utf8");
const sandbox = { console, Date, Math, JSON, String, Number, Object, Array, Boolean, Error, RegExp, Set, Map,
  SpreadsheetApp: { flush() {}, CopyPasteType: {} } };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

// 실제 시트와 같은 열 구성(판매중지SKU 36열, 비관리SKU = 36열 + 원본 위치·보관사유)
const H = ["현재상태","거래처","성별","카테고리","모델명/품번","모델SKU","창고번호","SKU ID","이미지","상품명","색상","주얼리사이즈","치수","원가(부가세포함)","쿠팡 판매가","공급가","발주가능상태","제품링크","마진","바코드","현재고","누적입고","미입고","최근발주일","최근입고일","이전쿠팡공급가","최근쿠팡공급가","공급가차이","공급가확인","쿠팡 노출가","재고현황","기본순서","노출상품ID","옵션ID","패키지","제조국명"];
function sheet(grid) {
  const self = {
    grid,
    getLastRow: () => grid.length,
    getLastColumn: () => Math.max(...grid.map(r => r.length)),
    getMaxRows: () => grid.length, getMaxColumns: () => self.getLastColumn(),
    insertRowsAfter: (_, n) => { for (let i = 0; i < n; i++) grid.push([]); },
    insertColumnsAfter: () => {},
    deleteRow: r => grid.splice(r - 1, 1),
    getRange: (r, c, nr = 1, nc = 1) => {
      const cells = () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (grid[r - 1 + i] || [])[c - 1 + j] ?? ""));
      return {
        getValues: cells, getDisplayValues: () => cells().map(l => l.map(v => String(v))),
        setValue: v => { grid[r - 1] = grid[r - 1] || []; grid[r - 1][c - 1] = v; },
        copyTo: dest => dest._paste(cells()),
        _paste: data => data.forEach((l, i) => { grid[r - 1 + i] = grid[r - 1 + i] || []; l.forEach((v, j) => { grid[r - 1 + i][c - 1 + j] = v; }); }),
      };
    },
  };
  return self;
}
const line = (sku, id, name) => H.map(h => ({ "현재상태": "판매중지", "거래처": "비에이블리", "모델명/품번": "we011316", "모델SKU": sku, "SKU ID": id, "상품명": name, "바코드": "R" + id, "공급가": "=ROUND(O2*0.58,0)" })[h] ?? "");
const stop = sheet([H, line("we011316BK", 39404616, "새 블랙"), line("we011316BK", 38256587, "옛 블랙"), line("we011316WH", 40284074, "화이트"), line("we011313WH", 1, "다른모델")]);
const un = sheet([[...H, "원본 위치", "보관사유"], ["거래처단종", "x"]]);
const ss = { getSheetByName: n => ({ "판매중지SKU": stop, "비관리SKU": un })[n] || null };

assert.equal(sandbox.moveDuplicateTabRowsToUnmanaged_(ss, "we011316", ["38256587"]), 1);
assert.equal(un.grid.length, 3, "비관리SKU에 한 줄 추가");
const added = un.grid[2];
assert.equal(added[0], "비관리(중복등록)");
assert.equal(added[H.indexOf("SKU ID")], 38256587);
assert.equal(added[H.indexOf("상품명")], "옛 블랙", "상품명까지 전부 복사");
assert.equal(added[H.indexOf("바코드")], "R38256587");
assert.equal(added[36], "판매중지SKU!3");
assert.equal(added[37], "비관리(중복등록)");
assert.ok(!stop.grid.some(r => r[H.indexOf("SKU ID")] === 38256587), "판매중지SKU에서 지움");
assert.equal(stop.grid.length, 4, "다른 줄은 그대로");

// 이미 비관리SKU에 있는 SKU가 원래 탭에 또 남아 있으면 → 다시 붙이지 않고 원래 탭에서만 지운다(여러 번 눌러도 한 줄)
stop.grid.push(line("we011316BK", 38256587, "옛 블랙"));
assert.equal(sandbox.moveDuplicateTabRowsToUnmanaged_(ss, "we011316", ["38256587"]), 1);
assert.equal(un.grid.length, 3, "두 번째에도 비관리SKU는 한 줄");
assert.ok(!stop.grid.some(r => r[H.indexOf("SKU ID")] === 38256587));

// 중복이 없으면 아무것도 안 함
assert.equal(sandbox.moveDuplicateTabRowsToUnmanaged_(ss, "we011316", []), 0);
console.log("PASS 중복 옛 줄 비관리SKU 이동(전체 복사·한 번만·원래 탭에서 삭제)");
