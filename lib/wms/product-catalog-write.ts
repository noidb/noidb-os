import { uploadImageToDriveOAuth } from "./google-drive-user";
import { fetchSheetRows, fetchSpreadsheetTabs, updateSheetCells } from "./google-sheets";
import { FIELD_HEADER_CANDIDATES, PRODUCT_DB_SHEET_NAME, normalizeSkuId } from "./product-catalog";
import { OTHER_REREGISTRATION_TAB, STOPPED_TAB, pickLowPerformanceTab } from "./retired-sku-tabs";
import { pickStorageTabTitle } from "./warehouse-recheck-cleanup";
import { findProductRowAnyTab, notFoundAnyTabMessage } from "./product-row-lookup";
import { readWeeklyFile } from "./weekly-work-files";

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
  | "modelSku"
  | "modelName"
  | "productName"
  | "optionLabel"
  | "category"
  | "vendorName"
  | "warehouseNumber"
  | "boxNumber"
  | "currentStock"
  | "currentStatus"
  | "costVatIncluded"
  | "barcode"
  | "countryOfOrigin"
  | "productLink"
  | "imageUrl";

export type ProductCatalogUpdatePatch = Partial<Record<ProductCatalogWritableField, string>>;

export interface ProductCatalogUpdateResult {
  success: boolean;
  rowNumber?: number;
  /** 실제로 쓴 탭 (제품DB 또는 다른 탭) */
  sheetName?: string;
  updatedFields: ProductCatalogWritableField[];
  skippedFields: { field: ProductCatalogWritableField; reason: string }[];
  error?: string;
}

/** 제품DB "이미지" 컬럼은 항상 =IMAGE() 수식 형태를 쓴다 (기존 상품등록 Apps Script와 동일 규칙). */
function formatImageCellValue(url: string): string {
  if (!url) return "";
  return `=IMAGE("${url}",4,80,80)`;
}

/**
 * 구글시트 =IMAGE()는 구글 서버가 주소를 직접 열기 때문에 "/api/..." 같은 사이트 안의 상대 주소는 그려지지 않는다(2026-10-19).
 * 사진 붙여넣기·주간업무 사진 추가는 서버 내부 저장소 주소(/api/wms/weekly-work/image?id=...)를 만들므로,
 * 시트에 쓰기 전에 그 사진을 구글 드라이브에 올려 "사진 변경하기"와 같은 드라이브 주소로 바꾼다.
 * 그 밖의 상대 주소는 깨진 수식이 시트에 남지 않도록 쓰지 않고 오류로 돌려준다.
 */
const INTERNAL_WEEKLY_IMAGE_URL = /^\/api\/wms\/weekly-work\/image\?id=([a-f0-9]{64})$/;

async function sheetImageUrl(url: string, skuId: string, dryRun: boolean): Promise<string> {
  const trimmed = url.trim();
  const internal = trimmed.match(INTERNAL_WEEKLY_IMAGE_URL);
  if (!internal) {
    if (trimmed.startsWith("/")) throw new Error("이미지 주소가 사이트 안의 주소라서 구글시트에 쓰면 사진이 보이지 않습니다. 사진을 다시 올려 주세요.");
    return trimmed;
  }
  if (dryRun) return trimmed;
  const file = await readWeeklyFile(`image-${internal[1]}.json`);
  if (!file) throw new Error("저장해 둔 사진을 찾지 못했습니다. 사진을 다시 추가해 주세요.");
  const data = JSON.parse(file.toString()) as { mimeType?: string; base64?: string };
  if (!data.mimeType || !data.base64) throw new Error("저장해 둔 사진이 올바르지 않습니다. 사진을 다시 추가해 주세요.");
  const extension = data.mimeType.includes("png") ? "png" : data.mimeType.includes("webp") ? "webp" : "jpg";
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
  const uploaded = await uploadImageToDriveOAuth(Buffer.from(data.base64, "base64"), `${skuId}_${timestamp}.${extension}`, data.mimeType);
  return uploaded.url;
}

/**
 * 영수증 단가로 원가를 고칠 때, '모델명/품번'이 같은 줄 전부의 원가(부가세포함)를 한 번에 바꾼다
 * (사용자 요청 2026-10-21 — 같은 모델 색상·옵션 SKU를 하나씩 바꿀 수 없음).
 * 2026-10-23: 같은 탭만 바꿔서 제품DB·비관리SKU·실적저조SKU 등에 흩어진 같은 모델이 일부만 바뀌던 문제 →
 * 전 탭(제품DB·비관리SKU·실적저조SKU·그 외 재등록SKU·판매중지SKU)에서 모델명이 같은(대소문자·앞뒤 공백 무시) 줄을 모두 바꾼다.
 * SKU ID가 아직 없는 줄(승인대기)도 바꾼다. 모델명이 비어 있으면 그 SKU 한 줄만. 원가 칸이 수식인 줄은 건너뛴다.
 */
export async function updateCostForSameModel(skuId: string, costVatIncluded: string): Promise<{ success: boolean; sheetName?: string; modelName?: string; skuIds: string[]; skippedFormulaSkuIds: string[]; tabs?: string[]; error?: string }> {
  const targetSkuId = normalizeSkuId(skuId);
  const cost = String(costVatIncluded || "").trim();
  if (!targetSkuId) return { success: false, skuIds: [], skippedFormulaSkuIds: [], error: "SKU ID가 비어 있습니다." };
  if (!/^\d+(?:\.\d+)?$/.test(cost)) return { success: false, skuIds: [], skippedFormulaSkuIds: [], error: "원가를 숫자로 입력해 주세요." };
  let match;
  try {
    match = await findProductRowAnyTab(targetSkuId, { valueRenderOption: "FORMULA" });
  } catch (error) {
    return { success: false, skuIds: [], skippedFormulaSkuIds: [], error: error instanceof Error ? error.message : "제품DB를 읽을 수 없습니다." };
  }
  if (!match) return { success: false, skuIds: [], skippedFormulaSkuIds: [], error: notFoundAnyTabMessage(skuId) };
  const modelColumnOf = (headers: string[]) => headers.findIndex(h => FIELD_HEADER_CANDIDATES.modelName.includes(h));
  const modelName = (() => { const col = modelColumnOf(match.headers); return col >= 0 ? String(match.values[col] ?? "").trim() : ""; })();
  const key = modelName.toLowerCase();
  const titles = await fetchSpreadsheetTabs().then(tabs => tabs.map(tab => tab.title)).catch(() => [] as string[]);
  const storage = pickStorageTabTitle(titles);
  const tabNames = [...new Set([match.sheetName, PRODUCT_DB_SHEET_NAME, storage, pickLowPerformanceTab(titles), OTHER_REREGISTRATION_TAB, STOPPED_TAB]
    .filter((title): title is string => Boolean(title) && (title === match.sheetName || titles.includes(title!))))];
  const skuIds: string[] = [], skippedFormulaSkuIds: string[] = [], changedTabs: string[] = [];
  for (const title of key ? tabNames : [match.sheetName]) {
    const rows = title === match.sheetName ? match.rows : await fetchSheetRows(title, { valueRenderOption: "FORMULA" }).catch(() => null);
    if (!rows?.length) continue;
    const headerRowIndex = title === match.sheetName ? match.headerRowIndex : 0;
    const headers = (rows[headerRowIndex] || []).map(value => String(value ?? "").trim());
    const skuColumn = headers.indexOf("SKU ID");
    const costColumn = headers.findIndex(h => FIELD_HEADER_CANDIDATES.costVatIncluded.includes(h));
    const modelColumn = modelColumnOf(headers);
    if (costColumn < 0) { if (title === match.sheetName) return { success: false, sheetName: title, skuIds: [], skippedFormulaSkuIds: [], error: `${title} 탭에 '원가(부가세포함)' 열이 없습니다.` }; continue; }
    const targets = key
      ? rows.map((row, index) => ({ row, index })).filter(entry => entry.index > headerRowIndex && modelColumn >= 0 && String(entry.row?.[modelColumn] ?? "").trim().toLowerCase() === key)
      : [{ row: rows[match.rowNumber - 1], index: match.rowNumber - 1 }];
    const cellUpdates: { row: number; col: number; value: string }[] = [];
    for (const { row, index } of targets) {
      const id = normalizeSkuId(row?.[skuColumn]) || `${title} ${index + 1}행`;
      const before = String(row?.[costColumn] ?? "");
      if (before.startsWith("=")) { skippedFormulaSkuIds.push(id); continue; }
      skuIds.push(id);
      if (before.replace(/[,\s]/g, "") !== cost) cellUpdates.push({ row: index + 1, col: costColumn + 1, value: cost });
    }
    if (cellUpdates.length) { await updateSheetCells(title, cellUpdates); changedTabs.push(title); }
  }
  return { success: true, sheetName: match.sheetName, modelName, skuIds, skippedFormulaSkuIds, tabs: changedTabs };
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

  // 제품DB에 없으면(단종됐다가 다시 입고된 상품 등) 보관·창고재확인 등 다른 탭에서 찾아 그 탭에 쓴다 (2026-10-14).
  let match;
  try {
    match = await findProductRowAnyTab(targetSkuId);
  } catch (error) {
    return { success: false, updatedFields: [], skippedFields: [], error: error instanceof Error ? error.message : "제품DB를 읽을 수 없습니다." };
  }
  if (!match) {
    return { success: false, updatedFields: [], skippedFields: [], error: notFoundAnyTabMessage(skuId) };
  }
  const { headers, rowNumber, sheetName } = match;

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
        skippedFields.push({ field, reason: `${sheetName} 탭에 '이미지' 헤더가 없어 건너뛰었습니다.` });
        continue;
      }
      let imageUrl: string;
      try {
        imageUrl = await sheetImageUrl(value, targetSkuId, Boolean(options?.dryRun));
      } catch (error) {
        // 아직 시트에 아무것도 쓰지 않았으므로 그대로 실패로 돌려준다.
        return { success: false, rowNumber, sheetName, updatedFields: [], skippedFields, error: error instanceof Error ? error.message : "사진을 구글 드라이브에 올리지 못했습니다." };
      }
      updatedFields.push(field);
      cellUpdates.push({ row: rowNumber, col: imageColIndex + 1, value: formatImageCellValue(imageUrl) });
      continue;
    }

    const candidates = FIELD_HEADER_CANDIDATES[field];
    const headerIndex = headers.findIndex(h => candidates.includes(h));
    if (headerIndex < 0) {
      skippedFields.push({ field, reason: `${sheetName} 탭에 이 항목의 헤더(${candidates.join("/")})가 없어 건너뛰었습니다.` });
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
      error: `${sheetName} 탭에 수정할 열이 없습니다 (${skippedFields.map(item => item.reason).join(" ")})`,
    };
  }

  if (!options?.dryRun) {
    await updateSheetCells(sheetName, cellUpdates);
  }

  return { success: true, rowNumber, sheetName, updatedFields, skippedFields };
}
