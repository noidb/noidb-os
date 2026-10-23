import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { costWithVat, parseNumber, supplyPrice } from "../lib/excel/common";

// 구글시트 원가(부가세포함) 4,400원 → 등록준비 → 제품DB 이동 후에도 4,400원 그대로여야 한다(we20240406 GO·RG·SI).
const sheetCostVatIncluded = "4,400";
const sale = parseNumber("15900");
const cost = parseNumber(sheetCostVatIncluded); // 저장 경로(route.ts·automation.ts)가 쓰는 계산: 부가세를 다시 붙이지 않는다.
assert.equal(cost, 4400);
assert.equal(supplyPrice(sale), 9222); // 시트의 SI 공급가와 같은 계산
assert.equal(supplyPrice(sale) - cost, 4822); // 마진 = 공급가 - 부가세포함 원가

// 신상품: 부가세 미포함 단가를 넣으면 ×1.1(원 단위 반올림)로 원가(부가세포함)가 채워진다.
assert.equal(costWithVat(parseNumber("4000")), 4400);
assert.equal(costWithVat(parseNumber("1900")), 2090);
assert.equal(costWithVat(parseNumber("3333")), 3666);

// 저장 코드가 부가세를 다시 붙이지 않는지 소스로도 확인한다.
for (const file of ["app/api/google-sheet/route.ts", "lib/excel/automation.ts"]) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  assert.ok(!/costWithVat\s*\(/.test(source), `${file}: 원가에 부가세를 다시 붙이는 호출이 남아 있습니다.`);
}

console.log("PASS registration cost stays VAT-included from sheet to 제품DB; ex-VAT helper multiplies by 1.1");
