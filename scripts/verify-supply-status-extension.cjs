const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../browser-extension/noidb-supplier-sync/supply-status-core.js");

const headers = ["SKU ID", "상품명", "바코드", "발주가능상태"];
assert.deepEqual(core.missingRequiredHeaders(headers), []);
assert.deepEqual(core.missingRequiredHeaders(["SKU ID", "상품명"]), ["바코드", "발주가능상태"]);
assert.equal(core.parseTotalCount("총 6,496건"), 6496);
assert.equal(core.expectedPageCount(6496, 100), 65);
assert.equal(core.expectedRowsForPage(6496, 100, 65), 96);
assert.deepEqual(core.selectPaginationCandidate([
  ...[1, 2, 3, 4, 5].map(page => ({ dataPage: String(page), text: String(page) })),
  { dataPage: "", text: ">" },
], 6), { index: 5, kind: "forward-block" });

function rows(start, count) {
  return Array.from({ length: count }, (_, index) => [String(start + index), `상품 ${start + index}`, `R${String(start + index).padStart(12, "0")}`, "정상"]);
}

const valid = core.validateCapture({
  totalCount: 205,
  pageSize: 100,
  headers,
  pages: [
    { pageNumber: 1, rows: rows(1, 100) },
    { pageNumber: 2, rows: rows(101, 100) },
    { pageNumber: 3, rows: rows(201, 5) },
  ],
});
assert.equal(valid.complete, true);
assert.equal(valid.collectedRowCount, 205);

const repeatedSku = core.validateCapture({
  totalCount: 2,
  pageSize: 1,
  headers,
  pages: [
    { pageNumber: 1, rows: rows(1, 1) },
    { pageNumber: 2, rows: rows(1, 1) },
  ],
});
assert.equal(repeatedSku.complete, false);
assert.match(repeatedSku.errors.join(" "), /반복/);

const bridgeSource = fs.readFileSync(path.resolve(__dirname, "../browser-extension/noidb-supplier-sync/noidb-bridge.js"), "utf8");
assert.match(bridgeSource, /noidbPendingSupplyStatusTransfer/);
assert.match(bridgeSource, /Array\.isArray\(candidate\?\.rows\)/, "상품공급상태 행 배열을 NOID-B 페이지로 전달해야 합니다.");

console.log("상품공급상태 확장 전체 페이지 수집 규칙 검증 완료");
