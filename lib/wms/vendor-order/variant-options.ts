import type { ProductCatalogItem } from "../product-catalog";
import { normalizeSkuId } from "../sku-normalize";
import { resolveDisplayNameAndOption } from "../display-name";

export interface VendorVariantOption {
  skuId: string;
  product: ProductCatalogItem;
  name: string;
  optionLabel: string;
  alreadyAdded: boolean;
  discontinued: boolean;
  selectable: boolean;
}
export interface VendorVariantOptions {
  anchor: ProductCatalogItem | null;
  modelName: string;
  options: VendorVariantOption[];
  reason?: string;
  conflictingSkuIds: string[];
}
const modelKey = (value: string) => value.trim().toLocaleLowerCase("ko").replace(/\s+/g, " ");

/** Exact SKU anchors an exact model group; similar names and model SKU prefixes never join groups. */
export function getVendorVariantOptions(input: {
  anchorSkuId: string;
  catalogItems: Iterable<ProductCatalogItem>;
  existingSkuIds: readonly string[];
}): VendorVariantOptions {
  const products = new Map<string, ProductCatalogItem>();
  const signatures = new Map<string, string>();
  const conflicting = new Set<string>();
  for (const product of input.catalogItems) {
    const sku = normalizeSkuId(product.skuId);
    if (!sku) continue;
    const signature = JSON.stringify(Object.entries({ ...product, skuId: sku, modelName: modelKey(product.modelName) }).sort(([a], [b]) => a.localeCompare(b)));
    if (signatures.has(sku) && signatures.get(sku) !== signature) { conflicting.add(sku); products.delete(sku); continue; }
    if (conflicting.has(sku)) continue;
    signatures.set(sku, signature);
    products.set(sku, product);
  }
  const anchorSkuId = normalizeSkuId(input.anchorSkuId);
  const anchor = products.get(anchorSkuId) || null;
  const result: VendorVariantOptions = { anchor, modelName: anchor?.modelName.trim() || "", options: [], conflictingSkuIds: [...conflicting] };
  if (!anchor) return { ...result, reason: conflicting.has(anchorSkuId) ? "이 SKU의 제품DB 정보가 서로 달라 옵션을 확인할 수 없습니다." : "제품DB에서 이 SKU를 찾지 못했습니다." };
  if (!modelKey(anchor.modelName)) return { ...result, reason: "제품DB에 모델명이 없어 같은 모델의 옵션을 확인할 수 없습니다. 상품 추가에서 SKU로 검색해 주세요." };
  const existing = new Set(input.existingSkuIds.map(normalizeSkuId));
  result.options = [...products].filter(([, product]) => modelKey(product.modelName) === modelKey(anchor.modelName)).map(([skuId, product]) => {
    const display = resolveDisplayNameAndOption(product.productName, "", product.optionLabel);
    const alreadyAdded = existing.has(skuId);
    const discontinued = product.currentStatus.trim() === "단종";
    return { skuId, product, name: display.name, optionLabel: display.option, alreadyAdded, discontinued, selectable: !alreadyAdded && !discontinued };
  }).sort((a, b) => a.optionLabel.localeCompare(b.optionLabel, "ko", { numeric: true }) || a.skuId.localeCompare(b.skuId, "ko", { numeric: true }));
  return result;
}
