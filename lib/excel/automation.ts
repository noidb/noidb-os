import ExcelJS from "exceljs";
import path from "path";
import {
  buildSkuRows,
  costWithVat,
  dimensionText,
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
  const cost = costWithVat(parseNumber(payload.product.cost));
  const supply = supplyPrice(sale || 0);
  const msrp = msrpPrice(sale || 0);
  const supplier = supplierLabel(payload.product.supplier, payload.product.gender);
  const dimension = dimensionText(payload.product);
  const skus = buildSkuRows(payload);

  for (const sheet of [...workbook.worksheets]) {
    if (sheet.name !== "제품DB") {
      workbook.removeWorksheet(sheet.id);
    }
  }

  // 제품DB — 재고관리용 SKU rows
  const db = workbook.getWorksheet("제품DB");
  if (!db) throw new Error("제품DB 시트가 없습니다.");
  clearSheetFrom(db, 1);
  const dbHeaders = [
    "거래처", "성별", "카테고리", "모델명/품번", "모델SKU", "이미지",
    "상품명", "색상", "주얼리사이즈", "치수", "원가(부가세포함)", "쿠팡 판매가",
    "공급가", "권장소비자가격", "SKU ID", "발주가능상태", "제품링크", "마진",
    "바코드", "현재고", "누적입고", "창고번호",
  ];
  db.getRow(1).values = dbHeaders;
  const header = db.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  header.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  header.height = 32;
  skus.forEach((sku, index) => {
    const rowNumber = 2 + index;
    const row = db.getRow(rowNumber);
    row.values = [
      supplier,
      payload.product.gender,
      payload.product.category,
      payload.model,
      sku.sku,
      "",
      payload.title,
      sku.color,
      sku.size,
      dimension,
      cost || "",
      sale || "",
      supply,
      msrp,
      "",
      "",
      payload.sourcingUrl || "",
      supply - cost,
      "",
      0,
      0,
      payload.product.warehouse || "",
    ];
    row.getCell(13).value = { formula: `ROUND(L${rowNumber}*0.58,0)`, result: supply };
    row.getCell(14).value = { formula: `CEILING(L${rowNumber}*1.5,1000)`, result: msrp };
    row.getCell(18).value = { formula: `M${rowNumber}-K${rowNumber}`, result: supply - cost };
    const imageData = payload.optionImages?.[sku.color];
    if (imageData?.startsWith("data:image/")) {
      const extension: "jpeg" | "png" = imageData.startsWith("data:image/png") ? "png" : "jpeg";
      const imageId = workbook.addImage({ base64: imageData, extension });
      db.addImage(imageId, {
        tl: { col: 5.12, row: rowNumber - 0.88 },
        ext: { width: 68, height: 68 },
        editAs: "oneCell",
      });
      row.height = 56;
    }
  });
  db.views = [{ state: "frozen", ySplit: 1 }];
  db.autoFilter = { from: "A1", to: "V1" };
  db.columns.forEach((column, index) => {
    column.width = index === 5 || index === 6 || index === 16 ? 24 : 15;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(buffer),
    downloadName: "상품DB.xlsx",
    skuCount: skus.length,
  };
}
