import type { ProductCatalogItem } from "./product-catalog";

/**
 * 마케팅(쿠폰·광고) 무조건 제외 목록 — 사용자 지정(2026-10-08~).
 * 여기 적힌 SKU 하나가 있으면 제품DB에서 같은 "모델명/품번"인 SKU 전부를 제외한다.
 * 사용자가 대화로 알려 주면 Claude가 이 목록에 추가한다.
 */
export const MARKETING_PERMANENT_EXCLUDED_SKU_IDS: readonly string[] = [
  "36839194",
];

export interface MarketingExclusionResult {
  skuIds: Set<string>;
  models: string[];
}

/** 지정 SKU → 같은 모델 SKU 전체로 넓힌다. 모델명이 비어 있는 SKU는 그 SKU만 제외한다. */
export function expandMarketingExclusions(items: readonly Pick<ProductCatalogItem, "skuId" | "modelName">[], listed: readonly string[] = MARKETING_PERMANENT_EXCLUDED_SKU_IDS): MarketingExclusionResult {
  const skuIds = new Set(listed);
  const models = new Set<string>();
  for (const item of items) if (skuIds.has(item.skuId) && item.modelName.trim()) models.add(item.modelName.trim());
  for (const item of items) if (models.has(item.modelName.trim())) skuIds.add(item.skuId);
  return { skuIds, models: [...models].sort() };
}
