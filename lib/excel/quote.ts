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
  templateFileForCategory,
  templatesDir,
} from "./common";
import type { ExportPayload } from "./types";

function findQfSheet(workbook: ExcelJS.Workbook) {
  const sheet = workbook.worksheets.find(ws => ws.name.startsWith("QF_"));
  if (!sheet) throw new Error("견적서 QF 시트를 찾지 못했습니다.");
  return sheet;
}

function headerMap(sheet: ExcelJS.Worksheet) {
  const map = new Map<string, number>();
  const row = sheet.getRow(5);
  row.eachCell({ includeEmpty: false }, (cell, col) => {
    const key = String(cell.value ?? "").replace(/\s+/g, " ").trim();
    if (key) map.set(key, col);
  });
  return map;
}

function setByHeader(
  row: ExcelJS.Row,
  headers: Map<string, number>,
  header: string,
  value: string | number | undefined | null
) {
  const col = headers.get(header);
  if (!col || value === undefined || value === null || value === "") return;
  row.getCell(col).value = value;
}

function clearDataRows(sheet: ExcelJS.Worksheet) {
  const max = Math.max(sheet.rowCount, 9);
  for (let r = 9; r <= max; r++) {
    const row = sheet.getRow(r);
    row.eachCell({ includeEmpty: true }, cell => {
      cell.value = null;
    });
  }
}

function commonDefaults(payload: ExportPayload) {
  const sale = parseNumber(payload.product.price);
  const supply = supplyPrice(sale || 0);
  const msrp = msrpPrice(sale || 0);
  return {
    sale,
    supply,
    msrp,
    barcode: "바코드 없음(쿠팡 바코드 생성 요청)",
    brand: "브랜드 없음",
    material: payload.product.material || "써지컬스틸",
    custom: "주문제작 아님",
    sizeAdjust: "사이즈 조절 아님",
    target: genderTarget(payload.product.gender),
    engraving: /각인/.test(payload.product.keyword + payload.title) ? "각인 포함" : "각인 미포함",
    stone: detectStone(payload.product.keyword),
    tax: "과세",
    maker: "프리스타일 협력사",
    businessType: "기타 도소매업자",
    importType: "수입상품",
    boxQty: 500,
    shelfDays: 0,
    cautionReason: "해당사항없음",
    packWeight: 10,
    packSize: "70*60*10",
    noticeName: "상품고시정보",
    kind: kindLabel(payload.product.gender, payload.product.category),
    dimension: dimensionText(payload.product),
    importer: "프리스타일",
    country: "중국",
    handleCaution: "분실, 파손주의",
    warranty: "제품 이상 시 공정거래위원회 고시 소비자분쟁해결 기준에 의거 보상합니다.",
    asContact: "쿠팡 1577-7011",
    path: categoryPath(payload.product.category, payload.product.gender),
    supplier: supplierLabel(payload.product.supplier, payload.product.gender),
  };
}

export async function buildQuoteWorkbook(payload: ExportPayload) {
  const fileName = templateFileForCategory(payload.product.category);
  if (!fileName) {
    throw new Error(`지원하지 않는 카테고리입니다: ${payload.product.category}`);
  }
  if (!payload.model) throw new Error("모델명이 없습니다.");
  if (!payload.title) throw new Error("상품명이 없습니다.");

  const templatePath = path.join(templatesDir(), fileName);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);

  const sheet = findQfSheet(workbook);
  const headers = headerMap(sheet);
  clearDataRows(sheet);

  const defaults = commonDefaults(payload);
  const skus = buildSkuRows(payload);
  if (!skus.length) throw new Error("색상/사이즈 조합으로 생성할 SKU가 없습니다.");

  skus.forEach((sku, index) => {
    const row = sheet.getRow(9 + index);
    setByHeader(row, headers, "카테고리", defaults.path);
    setByHeader(row, headers, "상품명", payload.title);
    setByHeader(row, headers, "상품 바코드", defaults.barcode);
    setByHeader(row, headers, "검색태그", payload.tags);
    setByHeader(row, headers, "브랜드", defaults.brand);
    setByHeader(row, headers, "색상", sku.color);
    setByHeader(row, headers, "주얼리 사이즈", sku.size);
    setByHeader(row, headers, "사이즈", sku.size);
    setByHeader(row, headers, "반지 사이즈", sku.size);
    setByHeader(row, headers, "주얼리 소재", defaults.material);
    setByHeader(row, headers, "주문제작 여부", defaults.custom);
    setByHeader(row, headers, "사이즈 조절여부", defaults.sizeAdjust);
    setByHeader(row, headers, "주얼리 스톤", defaults.stone);
    setByHeader(row, headers, "모델명/품번", payload.model);
    setByHeader(row, headers, "사용대상 구분", defaults.target);
    setByHeader(row, headers, "패션잡화 사용대상", defaults.target);
    setByHeader(row, headers, "각인 포함 유무", defaults.engraving);
    setByHeader(row, headers, "어린이용 여부", "어린이용 아님");
    setByHeader(row, headers, "귀걸이 종류", payload.product.category === "피어싱" ? "피어싱" : "귀걸이");
    // Parent / Manufacturer Part Number must stay blank for all rows
    for (const [key, col] of headers.entries()) {
      const norm = key.replace(/\s+/g, " ").trim().toLowerCase();
      if (
        norm === "parent manufacturer part number" ||
        norm === "manufacturer part number"
      ) {
        row.getCell(col).value = null;
      }
    }
    setByHeader(row, headers, "대표이미지 파일명", sku.thumbFile);
    setByHeader(row, headers, "상세이미지 파일명", sku.detailFile);

    const extras = payload.additionalImages || [];
    const extraHeaders = [...headers.entries()]
      .filter(([key]) => /추가\s*이미지/.test(key) || /additional\s*image/i.test(key))
      .sort((a, b) => a[1] - b[1]);
    if (extraHeaders.length) {
      extraHeaders.forEach(([, col], i) => {
        row.getCell(col).value = extras[i] || null;
      });
    } else {
      // numbered columns: 추가이미지1, 추가이미지 1, 추가이미지파일명1 …
      for (let i = 0; i < 10; i++) {
        const candidates = [
          `추가이미지${i + 1}`,
          `추가이미지 ${i + 1}`,
          `추가이미지파일명${i + 1}`,
          `추가 이미지${i + 1}`,
          `추가 이미지 ${i + 1}`,
        ];
        for (const h of candidates) {
          const col = headers.get(h);
          if (col) {
            row.getCell(col).value = extras[i] || null;
            break;
          }
        }
      }
    }
    setByHeader(row, headers, "이미지 대체 텍스트", altText(payload.title));
    setByHeader(row, headers, "공급가", defaults.supply);
    setByHeader(row, headers, "쿠팡 판매가", defaults.sale);
    setByHeader(row, headers, "권장소비자가격", defaults.msrp);
    setByHeader(row, headers, "과세여부", defaults.tax);
    setByHeader(row, headers, "제조사", defaults.maker);
    setByHeader(row, headers, "거래타입", defaults.businessType);
    setByHeader(row, headers, "수입여부", defaults.importType);
    setByHeader(row, headers, "박스 내 SKU 수량", defaults.boxQty);
    setByHeader(row, headers, "유통기간 *식품의 경우 소비기간\n(일수기재)", defaults.shelfDays);
    // header may contain newline differently — try normalized match
    for (const [key, col] of headers.entries()) {
      if (key.startsWith("유통기간")) row.getCell(col).value = defaults.shelfDays;
    }
    setByHeader(row, headers, "취급주의 사유", defaults.cautionReason);
    setByHeader(row, headers, "한 개 단품 포장 무게", defaults.packWeight);
    setByHeader(row, headers, "한 개 단품 포장 사이즈", defaults.packSize);
    setByHeader(row, headers, "제품 필수 표시사항 (라벨 또는 도안 이미지)", sku.labelFile);
    setByHeader(row, headers, "고시명", defaults.noticeName);
    setByHeader(row, headers, "종류", defaults.kind);
    setByHeader(row, headers, "소재", defaults.material);
    setByHeader(row, headers, "치수", defaults.dimension);
    setByHeader(row, headers, "제조자(수입자)", defaults.importer);
    setByHeader(row, headers, "제조국", defaults.country);
    setByHeader(row, headers, "취급시 주의사항", defaults.handleCaution);
    setByHeader(row, headers, "품질보증기준", defaults.warranty);
    setByHeader(row, headers, "A/S 책임자와 전화번호", defaults.asContact);
    row.commit();
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const downloadName = `견적서_${payload.model}_${payload.product.category}.xlsx`;
  return {
    buffer: Buffer.from(buffer),
    downloadName,
    skuCount: skus.length,
    templateFile: fileName,
  };
}
