const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const ExcelJS = require("exceljs");

// Run the application's actual TypeScript generator without downloading tools.
require.extensions[".ts"] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText,
  filename,
);
const { buildQuoteWorkbook } = require("../lib/excel/quote.ts");

function fixture(category, model, colors, sizes) {
  return {
    model,
    title: `써지컬스틸 ${model} ${category}`,
    tags: "검증,액세서리",
    product: {
      supplier: "프리스타일", category, gender: "여성", material: "써지컬스틸",
      colors, sizes, modelNo: model, warehouse: "", replacementSku: "",
      keyword: "심플", dimension: "1cm", cost: "1000", price: "10000",
    },
  };
}

async function verifyOutput(input, expectedRows) {
  const output = await buildQuoteWorkbook(input);
  assert.equal(output.skuCount, expectedRows.length);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(output.buffer);
  const sheet = workbook.worksheets.find(candidate => candidate.name.startsWith("QF_"));
  assert(sheet, "내보낸 XLSX에 견적서 QF 시트가 있어야 합니다.");
  const headers = new Map();
  sheet.getRow(5).eachCell((cell, column) => {
    headers.set(String(cell.value ?? "").replace(/\s+/g, " ").trim(), column);
  });
  const read = (row, header) => {
    assert(headers.has(header), `실제 템플릿에 ${header} 헤더가 있어야 합니다.`);
    return sheet.getRow(row).getCell(headers.get(header)).value;
  };
  expectedRows.forEach((expected, index) => {
    const row = index + 9;
    assert.equal(read(row, "모델명/품번"), expected.model, `${sheet.name} ${row}행: 입력 모델명을 출력해야 합니다.`);
    assert.notEqual(read(row, "모델명/품번"), expected.sku, "모델SKU를 모델명/품번에 넣으면 안 됩니다.");
    assert.equal(read(row, "색상"), `${expected.sku} | ${expected.color}`, "색상의 옵션별 모델SKU는 유지해야 합니다.");
    assert.equal(read(row, "대표이미지 파일명"), `${expected.sku}.jpg`, "옵션별 대표이미지 파일명은 유지해야 합니다.");
    assert.equal(read(row, "상세이미지 파일명"), `${expected.model}.jpg`);
    assert.equal(read(row, "상품 바코드"), "바코드 없음(쿠팡 바코드 생성 요청)");
    assert.equal(read(row, "상품명"), [expected.title, `${expected.sku} | ${expected.color}`, expected.size].filter(Boolean).join(", "));
  });
  assert.equal(read(expectedRows.length + 9, "모델명/품번"), null, "기존 템플릿의 예시 상품이 남으면 안 됩니다.");
  return expectedRows.length;
}

(async () => {
  let verifiedRows = 0;
  let verifiedWorkbooks = 0;
  for (const category of ["귀걸이", "피어싱", "목걸이", "반지", "발찌", "팔찌"]) {
    const first = fixture(category, "WR0001", "실버, 골드", category === "반지" ? "9호, 11호" : "Free");
    const second = fixture(category, "재등록-품번002", "블랙", "Free");
    const firstRows = category === "반지"
      ? [
        { sku: "WR0001-SI9", color: "실버", size: "9호" },
        { sku: "WR0001-SI11", color: "실버", size: "11호" },
        { sku: "WR0001-GO9", color: "골드", size: "9호" },
        { sku: "WR0001-GO11", color: "골드", size: "11호" },
      ]
      : [{ sku: "WR0001-SI", color: "실버" }, { sku: "WR0001-GO", color: "골드" }];
    const expectedFirst = firstRows.map(row => ({ ...row, model: first.model, title: first.title }));
    const expectedSecond = [{ model: second.model, title: second.title, color: "블랙", sku: category === "반지" ? "재등록-품번002-BKFR" : "재등록-품번002-BK" }];
    verifiedRows += await verifyOutput(first, expectedFirst);
    verifiedRows += await verifyOutput([first, second], [...expectedFirst, ...expectedSecond]);
    verifiedWorkbooks += 2;
  }
  console.log(`PASS: 실제 견적서 XLSX ${verifiedWorkbooks}개 / ${verifiedRows}행 재로딩 확인 — 6개 카테고리 단독·묶음 모델명, 한글·하이픈 품번, 색상·사이즈별 SKU 및 이미지 파일명 보존.`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
