import type { ProductCatalogItem } from "./product-catalog";

const BARCODE_MODEL_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/**
 * BarTender의 모델명 열에는 사람이 읽는 한글 상품명이 아니라 제품 식별 코드만 기록한다.
 * 옵션별 실제 모델SKU를 우선하고, 없을 때만 영문·숫자형 모델명/품번을 사용한다.
 */
export function resolveBarcodeModelIdentifier(
  catalog: Pick<ProductCatalogItem, "modelSku" | "modelName">
): string {
  for (const candidate of [catalog.modelSku, catalog.modelName]) {
    const value = candidate.trim();
    if (BARCODE_MODEL_IDENTIFIER_PATTERN.test(value)) return value;
  }
  return "";
}
