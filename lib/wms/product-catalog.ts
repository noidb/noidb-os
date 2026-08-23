import { fetchSheetRows, isWmsGoogleSheetsConfigured, rowsToObjects } from "./google-sheets";
import { normalizeSkuId } from "./sku-normalize";
export { normalizeSkuId, normalizeModelSkuKey } from "./sku-normalize";

/**
 * "제품DB" 시트만 읽어 상품코드(SKU ID) 기준으로 모델명/카테고리/상품명/옵션명/대표이미지/창고번호/
 * BOX번호/현재고/제조국명을 매핑하는 읽기 전용 조회 모델. lib/wms/purchase-orders.ts가 이미 쓰고 있는 조인
 * 방식(SKU ID 기준)과 동일한 정규화 규칙을 쓴다. 이 파일은 오직 읽기만 수행하며 시트에 값을 쓰지 않는다.
 *
 * 컬럼 확장 방법: FIELD_HEADER_CANDIDATES에 헤더 후보를 추가/수정하기만 하면 된다. 시트에 그 헤더가
 * 없으면 자동으로 빈 값("")이 되므로, 창고번호/BOX번호/현재고처럼 "나중에" 생길 컬럼도 지금 당장 코드를
 * 더 고치지 않고 스프레드시트에 해당 헤더만 추가하면 바로 채워진다.
 */
export interface ProductCatalogItem {
  skuId: string;
  /** 제품DB "모델SKU"(F열, 예: "we0001-GO") — 옵션(색상 등)별로 고유하다. "모델명/품번"(E열,
   *  예: "we0001")과 다르다 — 그건 여러 옵션이 공유하므로 SKU 단위 재매칭 키로 쓰면 안 된다.
   *  없으면 "" (2026-08-20 신규 — 제품DB 새로고침 시 SKU ID가 바뀐 상품도 모델SKU로 다시 찾기 위함). */
  modelSku: string;
  modelName: string;
  category: string;
  /** 제품DB 성별. 빈 값이면 화면 정렬에서 상품명 추론값을 즉시 사용한다. */
  gender: string;
  productName: string;
  optionLabel: string;
  imageUrl: string;
  /** 기존 "창고번호"(자유 텍스트, 노이드비 내부 위치 정보) — 새 BOX 체계 도입 전까지 참고용 */
  warehouseNumber: string;
  /** 아직 제품DB에 없는 컬럼(나중 추가 예정) — 없으면 항상 "" */
  boxNumber: string;
  /** 아직 제품DB에 없는 컬럼(나중 추가 예정) — 없으면 항상 "" */
  currentStock: string;
  /** 제품DB 현재상태(단종/과재고 등). */
  currentStatus: string;
  /** 제품DB 원가(부가세포함). 거래처 입고단가 반영 전후 비교에 사용한다. */
  costVatIncluded: string;
  /** 아직 제품DB에 없는 컬럼(나중 추가 예정) — 없으면 항상 "" (거래처별 부족분 발주서 그룹핑에 사용) */
  vendorName: string;
  /** 실제 쿠팡 Seller SKU Barcode. 임의 생성하지 않고 이 컬럼 값만 사용한다 — 없으면 "" */
  barcode: string;
  /** 제품DB "제조국명". 원본 셀이 비어 있거나 헤더가 없으면 "" — 국가 기본값을 추측하지 않는다. */
  countryOfOrigin: string;
  /** 제품DB "제품링크"(실제 쿠팡 상품 URL) — 없으면 "". SKU로 URL을 임의 생성하지 않고 이
   *  컬럼 값만 그대로 쓴다 (2026-08-19 5차 실사용 테스트 신규 — 거래처 발주서 카드 링크 버튼용). */
  productLink: string;
}

/** product-catalog-write.ts(제품DB 직접 수정)에서도 같은 시트/헤더 매핑을 재사용한다. */
export const PRODUCT_DB_SHEET_NAME = "제품DB";

/** 정규화된 필드 → 시트 헤더 후보(우선순위 순). 첫 번째로 존재하는 헤더의 값을 쓴다. */
export const FIELD_HEADER_CANDIDATES: Record<Exclude<keyof ProductCatalogItem, "skuId" | "imageUrl">, string[]> = {
  modelSku: ["모델SKU"],
  modelName: ["모델명/품번"],
  category: ["카테고리"],
  gender: ["성별"],
  productName: ["상품명"],
  optionLabel: ["옵션명", "옵션", "색상"],
  warehouseNumber: ["창고번호"],
  boxNumber: ["BOX번호", "박스번호"],
  currentStock: ["현재고", "재고수량"],
  currentStatus: ["현재상태"],
  costVatIncluded: ["원가(부가세포함)"],
  vendorName: ["거래처", "거래처명", "매입처"],
  barcode: ["쿠팡 바코드", "Seller SKU Barcode", "쿠팡바코드", "바코드"],
  countryOfOrigin: ["제조국명"],
  productLink: ["제품링크", "상품링크", "쿠팡 URL", "URL", "링크"],
};

/** 제품DB '이미지' 열의 =IMAGE("url",...) 수식에서 실제 이미지 URL만 추출한다. */
function extractImageUrl(rawCell: string | undefined): string {
  const text = String(rawCell ?? "");
  const formulaMatch = text.match(/=IMAGE\(\s*["']([^"']+)["']/i);
  if (formulaMatch) return formulaMatch[1];
  const hyperlinkMatch = text.match(/=HYPERLINK\(\s*["']([^"']+)["']/i);
  if (hyperlinkMatch) return hyperlinkMatch[1];
  const embeddedUrl = text.match(/https?:\/\/[^"'\s,)]+/i);
  if (embeddedUrl) return embeddedUrl[0];
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
      modelSku: firstNonEmpty(row, FIELD_HEADER_CANDIDATES.modelSku),
      modelName: firstNonEmpty(row, FIELD_HEADER_CANDIDATES.modelName),
      category: firstNonEmpty(row, FIELD_HEADER_CANDIDATES.category),
      gender: firstNonEmpty(row, FIELD_HEADER_CANDIDATES.gender),
      productName: firstNonEmpty(row, FIELD_HEADER_CANDIDATES.productName),
      optionLabel: firstNonEmpty(row, FIELD_HEADER_CANDIDATES.optionLabel),
      imageUrl: extractImageUrl(row["이미지"]),
      warehouseNumber: firstNonEmpty(row, FIELD_HEADER_CANDIDATES.warehouseNumber),
      boxNumber: firstNonEmpty(row, FIELD_HEADER_CANDIDATES.boxNumber),
      currentStock: firstNonEmpty(row, FIELD_HEADER_CANDIDATES.currentStock),
      currentStatus: firstNonEmpty(row, FIELD_HEADER_CANDIDATES.currentStatus),
      costVatIncluded: firstNonEmpty(row, FIELD_HEADER_CANDIDATES.costVatIncluded),
      vendorName: firstNonEmpty(row, FIELD_HEADER_CANDIDATES.vendorName),
      barcode: firstNonEmpty(row, FIELD_HEADER_CANDIDATES.barcode),
      countryOfOrigin: firstNonEmpty(row, FIELD_HEADER_CANDIDATES.countryOfOrigin),
      productLink: firstNonEmpty(row, FIELD_HEADER_CANDIDATES.productLink),
    }))
    .filter(item => item.skuId);
  return { configured: true, items };
}
