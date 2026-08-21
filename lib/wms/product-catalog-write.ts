import { fetchSheetRows, updateSheetCells } from "./google-sheets";
import { FIELD_HEADER_CANDIDATES, PRODUCT_DB_SHEET_NAME, normalizeSkuId } from "./product-catalog";

/**
 * 제품DB 구글시트를, SKU ID로 정확히 찾은 딱 한 행에만 쓰는 전용 함수 (2026-08-19 확장 —
 * 처음엔 거래처/창고번호/BOX번호 3개만이었으나, 상품 상세 화면에서 모델명·상품명·옵션명·
 * 카테고리·현재고·쿠팡바코드·대표이미지까지 눌러서 바로 수정할 수 있도록 넓혔다).
 * 사용자가 화면에서 저장을 눌렀을 때만 호출된다 — 자동으로 실행되지 않는다.
 *
 * 안전장치:
 * - SKU ID 컬럼에서 정규화 후 정확히 1개 행만 일치할 때만 쓴다. 0개면 "찾을 수 없음", 2개
 *   이상이면 "중복 SKU — 안전을 위해 취소" 에러를 던지고 아무것도 쓰지 않는다.
 * - 대상 헤더가 시트에 아예 없으면 그 필드는 건너뛰고 에러로 알린다(컬럼을 새로 만들지 않는다).
 * - dryRun:true면 실제 쓰기 없이 "몇 번째 행을 찾았는지"만 확인한다(테스트/검증용).
 * - SKU ID 자체는 수정 대상에 포함하지 않는다(행을 찾는 고유 키이므로 읽기 전용).
 */

export type ProductCatalogWritableField =
  | "modelName"
  | "productName"
  | "optionLabel"
  | "category"
  | "vendorName"
  | "warehouseNumber"
  | "boxNumber"
  | "currentStock"
  | "currentStatus"
  | "barcode"
  | "imageUrl";

export type ProductCatalogUpdatePatch = Partial<Record<ProductCatalogWritableField, string>>;

export interface ProductCatalogUpdateResult {
  success: boolean;
  rowNumber?: number;
  updatedFields: ProductCatalogWritableField[];
  skippedFields: { field: ProductCatalogWritableField; reason: string }[];
  error?: string;
}

/** 제품DB "이미지" 컬럼은 항상 =IMAGE() 수식 형태를 쓴다 (기존 상품등록 Apps Script와 동일 규칙). */
function formatImageCellValue(url: string): string {
  if (!url) return "";
  return `=IMAGE("${url}",4,80,80)`;
}

export async function updateProductCatalogFields(
  skuId: string,
  patch: ProductCatalogUpdatePatch,
  options?: { dryRun?: boolean }
): Promise<ProductCatalogUpdateResult> {
  const targetSkuId = normalizeSkuId(skuId);
  if (!targetSkuId) {
    return { success: false, updatedFields: [], skippedFields: [], error: "SKU ID가 비어 있습니다." };
  }

  const rows = await fetchSheetRows(PRODUCT_DB_SHEET_NAME);
  if (rows.length === 0) {
    return { success: false, updatedFields: [], skippedFields: [], error: "제품DB 시트를 읽을 수 없습니다." };
  }

  const headers = rows[0].map(h => String(h ?? "").trim());
  const skuIdColIndex = headers.findIndex(h => h === "SKU ID");
  if (skuIdColIndex < 0) {
    return { success: false, updatedFields: [], skippedFields: [], error: "제품DB 시트에 'SKU ID' 헤더를 찾을 수 없습니다." };
  }

  const matchingSheetRows: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    if (normalizeSkuId(rows[i][skuIdColIndex]) === targetSkuId) {
      matchingSheetRows.push(i + 1); // 1-based 시트 행 번호 (헤더가 1행이므로 데이터는 +1)
    }
  }

  if (matchingSheetRows.length === 0) {
    return { success: false, updatedFields: [], skippedFields: [], error: `제품DB에서 SKU ID "${skuId}"를 찾을 수 없습니다.` };
  }
  if (matchingSheetRows.length > 1) {
    return {
      success: false,
      updatedFields: [],
      skippedFields: [],
      error: `제품DB에 SKU ID "${skuId}"가 ${matchingSheetRows.length}개 행에 중복되어 있어 안전을 위해 수정을 취소했습니다. 시트에서 직접 정리해주세요.`,
    };
  }
  const rowNumber = matchingSheetRows[0];

  const fieldEntries = (Object.entries(patch) as [ProductCatalogWritableField, string | undefined][]).filter(
    (entry): entry is [ProductCatalogWritableField, string] => entry[1] !== undefined
  );

  const updatedFields: ProductCatalogWritableField[] = [];
  const skippedFields: { field: ProductCatalogWritableField; reason: string }[] = [];
  const cellUpdates: { row: number; col: number; value: string }[] = [];

  for (const [field, value] of fieldEntries) {
    if (field === "imageUrl") {
      const imageColIndex = headers.findIndex(h => h === "이미지");
      if (imageColIndex < 0) {
        skippedFields.push({ field, reason: "제품DB 시트에 '이미지' 헤더가 없어 건너뛰었습니다." });
        continue;
      }
      updatedFields.push(field);
      cellUpdates.push({ row: rowNumber, col: imageColIndex + 1, value: formatImageCellValue(value) });
      continue;
    }

    const candidates = FIELD_HEADER_CANDIDATES[field];
    const headerIndex = headers.findIndex(h => candidates.includes(h));
    if (headerIndex < 0) {
      skippedFields.push({ field, reason: `제품DB 시트에 이 항목의 헤더(${candidates.join("/")})가 없어 건너뛰었습니다.` });
      continue;
    }
    updatedFields.push(field);
    cellUpdates.push({ row: rowNumber, col: headerIndex + 1, value });
  }

  if (updatedFields.length === 0) {
    return {
      success: false,
      rowNumber,
      updatedFields: [],
      skippedFields,
      error: "수정할 수 있는 항목이 없습니다 (대상 컬럼이 시트에 없음).",
    };
  }

  if (!options?.dryRun) {
    await updateSheetCells(PRODUCT_DB_SHEET_NAME, cellUpdates);
  }

  return { success: true, rowNumber, updatedFields, skippedFields };
}
