import ExcelJS from "exceljs";
import path from "path";
import {
  altText,
  buildSkuRows,
  categoryPath,
  detectStone,
  dimensionText,
  genderTarget,
  kindLabel,
  msrpPrice,
  parseNumber,
  supplierLabel,
  supplyPrice,
  templatesDir,
} from "./common";
import type { ExportPayload } from "./types";

function clearSheetFrom(sheet: ExcelJS.Worksheet, startRow: number) {
  const max = Math.max(sheet.rowCount, startRow);
  for (let r = startRow; r <= max; r++) {
    const row = sheet.getRow(r);
    row.eachCell({ includeEmpty: true }, cell => {
      cell.value = null;
    });
  }
}

export async function buildAutomationWorkbook(payload: ExportPayload) {
  if (!payload.model) throw new Error("모델명이 없습니다.");
  if (!payload.title) throw new Error("상품명이 없습니다.");

  const templatePath = path.join(templatesDir(), "로켓배송 상품등록 자동화.xlsx");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);

  const sale = parseNumber(payload.product.price);
  const cost = parseNumber(payload.product.cost);
  const supply = supplyPrice(sale || 0);
  const msrp = msrpPrice(sale || 0);
  const supplier = supplierLabel(payload.product.supplier, payload.product.gender);
  const dimension = dimensionText(payload.product);
  const skus = buildSkuRows(payload);
  const target = genderTarget(payload.product.gender);
  const stone = detectStone(payload.product.keyword);
  const engraving = /각인/.test(payload.product.keyword + payload.title) ? "각인 포함" : "각인 미포함";
  const pathValue = categoryPath(payload.product.category, payload.product.gender);
  const kind = kindLabel(payload.product.gender, payload.product.category);

  // 1) 상품입력 — current product only
  const input = workbook.getWorksheet("상품입력");
  if (!input) throw new Error("상품입력 시트가 없습니다.");
  clearSheetFrom(input, 2);
  input.getRow(2).values = [
    undefined,
    "등록",
    supplier,
    payload.product.gender,
    payload.product.category,
    payload.model,
    payload.title,
    payload.product.colors,
    payload.product.sizes,
    cost || "",
    sale || "",
    dimension,
  ];

  // 2) AI분석요청
  const ai = workbook.getWorksheet("AI분석요청");
  if (ai) {
    clearSheetFrom(ai, 2);
    const prompt =
      `첨부한 상품 이미지를 참고해서 아래 상품을 분석해줘.\n\n` +
      `[상품정보]\n카테고리 : ${kind}\n모델명 : ${payload.model}\n현재 상품명 : ${payload.title}\n` +
      `옵션 : ${payload.product.colors}\n사이즈 : ${payload.product.sizes}\n치수 : ${dimension}`;
    ai.getRow(2).values = [
      undefined,
      payload.model,
      kind,
      payload.title,
      prompt,
      "",
      "미완료",
      "미완료",
      "미완료",
    ];
  }

  // 3) 제품DB — SKU rows
  const db = workbook.getWorksheet("제품DB");
  if (!db) throw new Error("제품DB 시트가 없습니다.");
  clearSheetFrom(db, 2);
  skus.forEach((sku, index) => {
    db.getRow(2 + index).values = [
      undefined,
      supplier,
      payload.product.gender,
      payload.product.category,
      payload.model,
      sku.sku,
      payload.title,
      sku.color,
      sku.size,
      dimension,
      cost || "",
      sale || "",
      payload.tags,
      sku.thumbFile,
      sku.detailFile,
      altText(payload.title),
      supply,
      msrp,
      kind,
      sku.labelFile,
      payload.product.material,
    ];
  });

  // 4) 쿠팡반지_앞부분 / 뒷부분 — fill when 반지 (sheet is ring-oriented)
  const front = workbook.getWorksheet("쿠팡반지_앞부분");
  const back = workbook.getWorksheet("쿠팡반지_뒷부분");
  if (front) {
    clearSheetFrom(front, 2);
    if (payload.product.category === "반지") {
      skus.forEach((sku, index) => {
        front.getRow(2 + index).values = [
          undefined,
          pathValue,
          payload.title,
          "바코드 없음(쿠팡 바코드 생성 요청)",
          payload.tags,
          "브랜드 없음",
          sku.color,
          sku.size,
          payload.product.material,
          "주문제작 아님",
          "사이즈 조절 아님",
          stone,
          payload.model,
          target,
          engraving,
          sku.size,
          "",
          "",
          "",
          target,
          "",
          "",
          "",
          "",
          payload.model,
          sku.sku,
          sku.thumbFile,
          "",
          sku.detailFile,
          "",
          "",
          altText(payload.title),
          supply,
          sale,
          "과세",
          "프리스타일 협력업체",
          "기타 도소매업자",
          "수입상품",
          500,
          0,
          "해당사항없음",
          10,
          "70*60*10",
          "",
          "",
          "",
          "",
          sku.labelFile,
        ];
      });
    }
  }
  if (back) {
    clearSheetFrom(back, 2);
    if (payload.product.category === "반지") {
      skus.forEach((_sku, index) => {
        back.getRow(2 + index).values = [
          undefined,
          kind,
          payload.product.material,
          dimension,
          "프리스타일 협력사",
          "중국",
          "분실, 파손주의",
          "제품 이상 시 공정거래위원회 고시 소비자분쟁해결 기준에 의거 보상합니다.",
          "쿠팡 1577-7011",
        ];
      });
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(buffer),
    downloadName: `상품입력자동화_${payload.model}.xlsx`,
    skuCount: skus.length,
  };
}
