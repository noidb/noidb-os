/** 실제 창고 동선에 맞춘 상품 분류와 정렬의 단일 기준. */
export const WAREHOUSE_CATEGORY_ORDER = ["세트", "남성 팔찌", "남성 반지", "남성 목걸이", "귀걸이", "피어싱", "이어커프", "여성 목걸이", "여성 반지", "여성 팔찌", "여성 발찌"] as const;
export const UNCATEGORIZED_BUCKET = "기타/미분류";
export type InferredGender = "남녀공용" | "남성" | "여성" | "";
export type InferredCategory = "세트" | "반지" | "팔찌" | "발찌" | "목걸이" | "귀걸이" | "피어싱" | "이어커프" | "";
const CATEGORY_KEYWORDS: Exclude<InferredCategory, "세트" | "">[] = ["반지", "팔찌", "발찌", "목걸이", "귀걸이", "피어싱", "이어커프"];

export function inferGender(name: string): InferredGender {
  if (/남녀공용/.test(name)) return "남녀공용";
  if (/남성|남자/.test(name)) return "남성";
  if (/여성|여자/.test(name)) return "여성";
  return "";
}
export function inferCategory(name: string): InferredCategory {
  const found = CATEGORY_KEYWORDS.filter(keyword => name.includes(keyword));
  return found.length >= 2 ? "세트" : found[0] || "";
}
export function inferProductClassification(productName: string) { return { gender: inferGender(productName), category: inferCategory(productName) }; }

export interface WarehouseSortableProduct {
  productName?: string; category?: string; gender?: string; zoneId?: string; shelfId?: string; boxId?: string;
  warehouseNumber?: string; boxNumber?: string; modelName?: string; modelSku?: string; skuId?: string; productCode?: string;
}
function genderOf(raw: string | undefined, name: string): InferredGender {
  const value = (raw || "").trim();
  if (/남녀공용/.test(value)) return "남녀공용";
  if (/남성|남자/.test(value)) return "남성";
  if (/여성|여자/.test(value)) return "여성";
  return inferGender(name);
}
function categoryOf(raw: string | undefined, name: string): InferredCategory {
  const value = (raw || "").trim();
  if (/세트|SET/i.test(value)) return "세트";
  const found = CATEGORY_KEYWORDS.filter(keyword => value.includes(keyword));
  return found.length >= 2 ? "세트" : found[0] || inferCategory(name);
}
export function resolveWarehouseCategoryBucket(rawCategory: string | undefined, rawGender?: string, productName = ""): string {
  const category = categoryOf(rawCategory, productName);
  const gender = genderOf(rawGender, productName);
  if (!category) return UNCATEGORIZED_BUCKET;
  if (category === "세트") return "세트";
  if (["귀걸이", "피어싱", "이어커프"].includes(category)) return category;
  if (gender === "남성" && ["팔찌", "반지", "목걸이"].includes(category)) return `남성 ${category}`;
  if (gender === "여성" && ["목걸이", "반지", "팔찌", "발찌"].includes(category)) return `여성 ${category}`;
  return `기타:${gender || "성별미정"}:${category}`;
}
export function warehouseCategorySortIndex(bucket: string): number {
  const idx = (WAREHOUSE_CATEGORY_ORDER as readonly string[]).indexOf(bucket);
  return idx >= 0 ? idx : bucket === UNCATEGORIZED_BUCKET ? WAREHOUSE_CATEGORY_ORDER.length + 2 : WAREHOUSE_CATEGORY_ORDER.length + 1;
}
function natural(value: string | undefined) { return (value || "￿").trim().toLocaleLowerCase("ko"); }
export function compareWarehouseProducts(a: WarehouseSortableProduct, b: WarehouseSortableProduct): number {
  const priority = warehouseCategorySortIndex(resolveWarehouseCategoryBucket(a.category, a.gender, a.productName)) - warehouseCategorySortIndex(resolveWarehouseCategoryBucket(b.category, b.gender, b.productName));
  if (priority) return priority;
  const ak = [a.zoneId, a.shelfId, a.boxId || a.boxNumber || a.warehouseNumber, a.modelName || a.modelSku, a.skuId || a.productCode];
  const bk = [b.zoneId, b.shelfId, b.boxId || b.boxNumber || b.warehouseNumber, b.modelName || b.modelSku, b.skuId || b.productCode];
  for (let i = 0; i < ak.length; i += 1) { const diff = natural(ak[i]).localeCompare(natural(bk[i]), "ko", { numeric: true }); if (diff) return diff; }
  return 0;
}
export function sortWarehouseProducts<T extends WarehouseSortableProduct>(items: readonly T[]): T[] {
  return items.map((item, index) => ({ item, index })).sort((a, b) => compareWarehouseProducts(a.item, b.item) || a.index - b.index).map(entry => entry.item);
}
