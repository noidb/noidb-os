/**
 * 2026-10-27 상품등록 목록 직접 관리 + 카테고리별 쿠팡 양식 검사.
 * 실행: npx --yes tsx scripts/verify-product-options.ts
 */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import ExcelJS from "exceljs";
import { parseCoupangTemplate } from "../lib/product-options/template-parse";
import { categoryLetter, normalizeProductOptions } from "../lib/product-options/defaults";
import { buildQuoteWorkbook, MissingRequiredError } from "../lib/excel/quote";
import type { ExportPayload } from "../lib/excel/types";

const payload = (category: string, extraFields?: Record<string, string>): ExportPayload => ({
  model: "wh0001",
  title: "써지컬스틸 리본 여성 집게핀",
  tags: "집게핀",
  product: {
    supplier: "프리스타일", category, gender: "여성", material: "써지컬스틸", colors: "골드,실버", sizes: "",
    modelNo: "1", warehouse: "", replacementSku: "", keyword: "리본", dimension: "폭 3cm", cost: "2000", price: "9900",
    extraFields,
  },
});

async function main() {
  const verbose = process.argv.includes("--verbose");
  for (const file of ["반지.xlsx", "귀걸이(피어싱).xlsx", "목걸이.xlsx", "팔찌.xlsx", "발찌.xlsx"]) {
    const info = await parseCoupangTemplate(await fs.readFile(`templates/${file}`), file);
    assert.ok(info.categoryPaths.length > 0, `${file} 카테고리 경로 목록`);
    assert.ok(info.fields.some(field => field.siteFilled), `${file} 자동 칸`);
    assert.ok(!info.fields.some(field => field.header === "카테고리"), "카테고리 칸은 경로 선택으로 따로");
    if (verbose) {
      console.log(file, info.categoryPaths);
      console.log("  ", info.fields.filter(field => !field.siteFilled).map(field => `${field.required ? "*" : ""}${field.header}(${field.choices.length})`).join(" | "));
    }
  }

  const ring = await parseCoupangTemplate(await fs.readFile("templates/반지.xlsx"), "반지.xlsx");
  const material = ring.fields.find(field => field.header === "주얼리 소재");
  assert.ok(material && material.required && material.choices.includes("써지컬스틸"), "드롭다운 값 읽기");
  const season = ring.fields.find(field => field.header === "출시 계절");
  assert.ok(season && !season.siteFilled, "출시 계절은 사용자가 기본값을 정하는 칸");

  // 설정: 저장본이 없거나 깨져도 기본 목록
  const fallback = normalizeProductOptions(null);
  assert.equal(categoryLetter(fallback, "반지"), "r");
  assert.equal(categoryLetter(fallback, "없는카테고리"), "x");
  const custom = normalizeProductOptions({ categories: [{ name: "집게핀", letter: "H" }] });
  assert.equal(categoryLetter(custom, "집게핀"), "h");

  // 새 카테고리(올린 양식 = 반지 양식으로 흉내): 경로·기본값·상품별 값
  const template = { buffer: await fs.readFile("templates/반지.xlsx"), fileName: "집게핀.xlsx" };
  const path = ring.categoryPaths[0];
  const result = await buildQuoteWorkbook(payload("집게핀", { "주문제작 여부": "주문제작 아님" }), {
    template,
    path: () => path,
    defaults: { "출시 계절": "사계절", "주문제작 여부": "주문제작" , "주얼리 사이즈": "FREE" },
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(result.buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets.find(ws => ws.name.startsWith("QF_"))!;
  const col = (header: string) => {
    let found = 0;
    sheet.getRow(5).eachCell((cell, index) => { if (String(cell.value).trim() === header) found = index; });
    return found;
  };
  const row = sheet.getRow(9);
  assert.equal(row.getCell(col("카테고리")).value, path, "카테고리 경로");
  assert.equal(row.getCell(col("출시 계절")).value, "사계절", "카테고리 기본값");
  assert.equal(row.getCell(col("주문제작 여부")).value, "주문제작 아님", "상품별 값이 기본값보다 우선");
  assert.equal(row.getCell(col("주얼리 소재")).value, "써지컬스틸", "사이트가 채운 값은 기본값으로 덮지 않음");

  // 필수 칸이 비면 알려 주고, 확인하면 그대로 만든다
  await assert.rejects(
    buildQuoteWorkbook(payload("집게핀"), { template, path: () => path }),
    (error: unknown) => error instanceof MissingRequiredError && error.missing.some(item => item.startsWith("주얼리 사이즈")),
  );
  await buildQuoteWorkbook(payload("집게핀"), { template, path: () => path, allowMissingRequired: true });

  // 양식이 없는 카테고리는 안내 문구
  await assert.rejects(buildQuoteWorkbook(payload("모자")), /쿠팡 양식이 없습니다/);

  // 기존 카테고리(반지)는 설정 없이 예전처럼 만들어진다
  const ringPayload = payload("반지");
  ringPayload.product.sizes = "9호,11호";
  await buildQuoteWorkbook(ringPayload);

  console.log("verify-product-options OK");
}

main().catch(error => { console.error(error); process.exit(1); });
