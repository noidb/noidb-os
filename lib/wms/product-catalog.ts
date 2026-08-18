import { fetchSheetRows, isWmsGoogleSheetsConfigured, rowsToObjects } from "./google-sheets";

/**
 * "제품DB" 시트만 읽어 상품코드(SKU ID) 기준으로 모델명/카테고리/상품명/옵션명/대표이미지/창고번호/
 * BOX번호/현재고를 매핑하는 읽기 전용 조회 모델. lib/wms/purchase-orders.ts가 이미 쓰고 있는 조인
 * 방식(SKU ID 기준)과 동일한 정규화 규칙을 쓴다. 이 파일은 오직 읽기만 수행하며 시트에 값을 쓰지 않는다.
 *
 * 컬럼 확장 방법: FIELD_HEADER_CANDIDATES에 헤더 후보를 추가/수정하기만 하면 된다. 시트에 그 헤더가
 * 없으면 자동으로 빈 값("")이 되므로, 창고번호/BOX번호/현재고처럼 "나중에" 생길 컬럼도 지금 당장 코드를
 * 더 고치지 않고 스프레드시트에 해당 헤더만 추가하면 바로 채워진다.
 */
export interface ProductCatalogItem {
  skuId: string;
  modelName: string;
  category: string;
  productName: string;
  optionLabel: string;
  imageUrl: string;
  /** 기존 "창고번호"(자유 텍스트, 노이드비 내부 위치 정보) — 새 BOX 체계 도입 전까지 참고용 */
  warehouseNumber: string;
  /** 아직 제품DB에 없는 컬럼(나중 추가 예정) — 없으면 항상 "" */
  boxNumber: string;
  /** 아직 제품DB에 없는 컬럼(나중 추가 예정) — 없으면 항상 "" */
  currentStock: string;
}

const PRODUCT_DB_SHEET_NAME = "제품DB";

/** 정규화된 필드 → 시트 헤더 후보(우선순위 순). 첫 번째로 존재하는 헤더의 값을 쓴다. */
const FIELD_HEADER_CANDIDATES: Record<Exclude<keyof ProductCatalogItem, "skuId" | "imageUrl">, string[]> = {
  modelName: ["모델명/품번"],
  category: ["카테고리"],
  productName: ["상품명"],
  optionLabel: ["옵션명", "옵션", "색상"],
  warehouseNumber: ["창고번호"],
  boxNumber: ["BOX번호", "박스번호"],
  currentStock: ["현재고", "재고수량"],
};

/** 숫자/문자/쉼표 형식이 달라도 같은 SKU ID로 비교할 수 있게 정규화한다. */
function normalizeSkuId(value: string | undefined): string {
  return String(value ?? "").trim().replace(/^'/, "").replace(/[\s,]/g, "").replace(/\.0+$/, "");
}

/** 제품DB '이미지' 열의 =IMAGE("url",...) 수식에서 실제 이미지 URL만 추출한다. */
function extractImageUrl(rawCell: string | undefined): string {
  const text = String(rawCell ?? "");
  const formulaMatch = text.match(/=IMAGE\("([^"]+)"/i);
  if (formulaMatch) return formulaMatch[1];
  if (/^https?:\/\//i.test(text.trim())) return text.trim();
  return "";
}

/** 후보 헤더 중 시트에 실제로 존재하고 값이 있는 첫 번째 것을 반환한다. 없으면 "". */
function firstNonEmpty(row: Record<string, string>, headerCandidates: string[]): string {
  for (const header of headerCandidates) {
    const value = row[header];
    if (value) return value;
  }
  return "";
}

/** 구글시트 설정 여부와 카탈로그 항목을 함께 반환한다. 미설정이면 configured:false, items:[]. */
export async function fetchProductCatalog(): Promise<{ configured: boolean; items: ProductCatalogItem[] }> {
  if (!isWmsGoogleSheetsConfigured()) {
    return { configured: false, items: [] };
  }
  const rows = await fetchSheetRows(PRODUCT_DB_SHEET_NAME, { valueRenderOption: "FORMULA" });
  const items = rowsToObjects(rows)
    .map((row): ProductCatalogItem => ({
      skuId: normalizeSkuId(row["SKU ID"]),
      modelName: firstNonEmpty(row, FIELD_HEADER_CANDIDATES.modelName),
      category: firstNonEmpty(row, FIELD_HEADER_CANDIDATES.category),
      productName: firstNonEmpty(row, FIELD_HEADER_CANDIDATES.productName),
      optionLabel: firstNonEmpty(row, FIELD_HEADER_CANDIDATES.optionLabel),
      imageUrl: extractImageUrl(row["이미지"]),
      warehouseNumber: firstNonEmpty(row, FIELD_HEADER_CANDIDATES.warehouseNumber),
      boxNumber: firstNonEmpty(row, FIELD_HEADER_CANDIDATES.boxNumber),
      currentStock: firstNonEmpty(row, FIELD_HEADER_CANDIDATES.currentStock),
    }))
    .filter(item => item.skuId);
  return { configured: true, items };
}
