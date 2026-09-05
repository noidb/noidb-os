const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("jszip");
const core = require("../browser-extension/noidb-supplier-sync/wims-core.js");

assert.equal(core.CAPTURE_MODE, "all-pages");
assert.equal(core.MAX_TRANSFER_ROWS, 1000);
assert.equal(core.parseTotalCount("205개 검색됨"), 205);
assert.equal(core.parseTotalCount("6,496개 검색됨"), 6496);
assert.equal(core.parseTotalCount("검색 결과 없음"), null);
assert.equal(core.expectedPageCount(205, 100), 3);
assert.deepEqual([1, 2, 3].map(page => core.expectedRowsForPage(205, 100, page)), [100, 100, 5]);
assert.equal(core.isExactNumericPageLink("1", "1", 1), true);
assert.equal(core.isExactNumericPageLink("1", "<<", 1), false, "처음 이동 화살표를 숫자 1페이지로 선택하면 안 됩니다.");
assert.equal(core.isExactNumericPageLink("6", ">", 6), false, "다음 묶음 화살표를 숫자 6페이지로 선택하면 안 됩니다.");
assert.deepEqual(core.selectPaginationCandidate([
  { dataPage: "1", text: "<<" },
  { dataPage: "1", text: "1" },
], 1), { index: 1, kind: "numeric" }, "같은 data-page라면 숫자 링크가 화살표보다 우선해야 합니다.");
assert.deepEqual(core.selectPaginationCandidate([
  ...[1, 2, 3, 4, 5].map(page => ({ dataPage: String(page), text: String(page) })),
  { dataPage: "6", text: ">" },
], 6), { index: 5, kind: "target-jump" }, "6페이지 숫자가 없으면 같은 data-page의 다음 묶음 링크를 선택해야 합니다.");
assert.deepEqual(core.selectPaginationCandidate([
  ...[6, 7, 8, 9, 10].map(page => ({ dataPage: String(page), text: String(page) })),
  { dataPage: "", text: ">" },
], 11), { index: 5, kind: "forward-block" }, "data-page 없는 다음 묶음 링크도 선택해야 합니다.");

function makeRows(start, count, columnCount = 9) {
  return Array.from({ length: count }, (_, rowOffset) =>
    Array.from({ length: columnCount }, (_, columnOffset) => `r${start + rowOffset}-c${columnOffset + 1}`)
  );
}

const validPages = [
  { pageNumber: 1, rows: makeRows(1, 100) },
  { pageNumber: 2, rows: makeRows(101, 100) },
  { pageNumber: 3, rows: makeRows(201, 5) },
];
const valid = core.validateCapture({ totalCount: 205, pageSize: 100, columnCount: 9, pages: validPages });
assert.equal(valid.complete, true);
assert.equal(valid.collectedRowCount, 205);
assert.deepEqual(valid.pageRowCounts, [100, 100, 5]);

const tooManyRows = core.validateCapture({
  totalCount: 1001,
  pageSize: 100,
  columnCount: 9,
  pages: Array.from({ length: 11 }, (_, index) => ({
    pageNumber: index + 1,
    rows: makeRows(index * 100 + 1, index === 10 ? 1 : 100),
  })),
});
assert.equal(tooManyRows.complete, false);
assert.match(tooManyRows.errors.join(" "), /최대 1000건/);

const missingRows = core.validateCapture({
  totalCount: 205,
  pageSize: 100,
  columnCount: 9,
  pages: [validPages[0], validPages[1], { pageNumber: 3, rows: makeRows(201, 4) }],
});
assert.equal(missingRows.complete, false);
assert.match(missingRows.errors.join(" "), /3페이지가 예상 5행 대신 4행/);
assert.match(missingRows.errors.join(" "), /총 205건 중 204건/);

const wrongColumns = core.validateCapture({
  totalCount: 1,
  pageSize: 100,
  columnCount: 9,
  pages: [{ pageNumber: 1, rows: makeRows(1, 1, 8) }],
});
assert.equal(wrongColumns.complete, false);
assert.match(wrongColumns.errors.join(" "), /컬럼 수/);

const repeatedPage = core.validateCapture({
  totalCount: 200,
  pageSize: 100,
  columnCount: 9,
  pages: [
    { pageNumber: 1, rows: makeRows(1, 100) },
    { pageNumber: 2, rows: makeRows(1, 100) },
  ],
});
assert.equal(repeatedPage.complete, false);
assert.match(repeatedPage.errors.join(" "), /반복/);

const repeatedBoundaryRow = core.validateCapture({
  totalCount: 205,
  pageSize: 100,
  columnCount: 9,
  pages: [
    { pageNumber: 1, rows: makeRows(1, 100) },
    { pageNumber: 2, rows: makeRows(100, 100) },
    { pageNumber: 3, rows: makeRows(201, 5) },
  ],
});
assert.equal(repeatedBoundaryRow.complete, false);
assert.match(repeatedBoundaryRow.errors.join(" "), /페이지 경계에서 동일한 행 1건/);

const tsv = core.buildTsv(["상품명", "상태"], [
  { pageNumber: 1, rows: [["상품 A\n옵션", "상품 검수 완료"]] },
  { pageNumber: 2, rows: [["상품 B", "상품 등록 불가"]] },
]);
assert.equal(tsv, "상품명\t상태\n상품 A 옵션\t상품 검수 완료\n상품 B\t상품 등록 불가");

async function verifyPublishedZip() {
  const sourceDir = path.resolve(__dirname, "../browser-extension/noidb-supplier-sync");
  const zipPath = path.resolve(__dirname, "../public/downloads/noidb-supplier-sync.zip");
  const expectedFiles = fs.readdirSync(sourceDir)
    .filter(name => fs.statSync(path.join(sourceDir, name)).isFile())
    .sort();
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const archivedFiles = Object.values(zip.files).filter(entry => !entry.dir).map(entry => entry.name).sort();
  assert.deepEqual(archivedFiles, expectedFiles, "공개 ZIP의 파일 목록이 확장 소스와 같아야 합니다.");
  for (const filename of expectedFiles) {
    const archived = await zip.file(filename).async("nodebuffer");
    const source = fs.readFileSync(path.join(sourceDir, filename));
    // Git checkout/archive changes CRLF/LF across Windows and Linux. Compare every
    // text character after newline normalization; binary assets remain byte-exact.
    if (/\.(?:md|js|json|html|css|txt)$/i.test(filename)) {
      assert.equal(archived.toString("utf8").replace(/\r\n/g, "\n"), source.toString("utf8").replace(/\r\n/g, "\n"), `공개 ZIP의 ${filename}이 최신 소스와 같아야 합니다.`);
    } else {
      assert.deepEqual(archived, source, `공개 ZIP의 ${filename}이 최신 소스와 같아야 합니다.`);
    }
  }
}

verifyPublishedZip().then(() => {
  console.log("WIMS 확장 전체 페이지 수집·공개 ZIP 동기화 검증 완료");
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
