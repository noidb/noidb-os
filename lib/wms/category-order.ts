/** 실제 창고 동선에 맞춘 상품 분류와 정렬의 단일 기준. */
export const WAREHOUSE_CATEGORY_ORDER = ["세트", "남성 팔찌", "남성 반지", "남성 목걸이", "귀걸이", "피어싱", "이어커프", "여성 목걸이", "여성 반지", "여성 팔찌", "여성 발찌"] as const;
export const UNCATEGORIZED_BUCKET = "기타/미분류";
export const WAREHOUSE_NUMBER_CATEGORY_ORDER = [
  "세트", "남성반지", "남성팔찌", "남성목걸이", "실버목걸이", "피어싱", "귀걸이A",
  "귀걸이B", "이어커프", "여성목걸이", "초커목걸이", "여성반지", "여성팔찌", "팔찌/발찌",
] as const;
export const UNCLASSIFIED_WAREHOUSE_NUMBER = "미분류 창고번호";
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

export interface WarehouseNumberIdentity {
  category: string;
  categoryIndex: number;
  numberPart: string;
  raw: string;
  empty: boolean;
}

/** 제품DB C열 창고번호를 화면 정렬용으로만 해석한다. 원본 값과 제품DB 행은 변경하지 않는다. */
export function resolveWarehouseNumberIdentity(value: string | undefined): WarehouseNumberIdentity {
  const raw = (value || "").trim();
  if (!raw) return { category: UNCLASSIFIED_WAREHOUSE_NUMBER, categoryIndex: WAREHOUSE_NUMBER_CATEGORY_ORDER.length + 1, numberPart: "", raw, empty: true };
  const categoryIndex = WAREHOUSE_NUMBER_CATEGORY_ORDER.findIndex(category => raw.startsWith(category));
  if (categoryIndex < 0) return { category: UNCLASSIFIED_WAREHOUSE_NUMBER, categoryIndex: WAREHOUSE_NUMBER_CATEGORY_ORDER.length, numberPart: raw, raw, empty: false };
  const category = WAREHOUSE_NUMBER_CATEGORY_ORDER[categoryIndex];
  return {
    category,
    categoryIndex,
    numberPart: raw.slice(category.length).replace(/^[\s_-]+/, ""),
    raw,
    empty: false,
  };
}

export function compareWarehouseNumbers(a: string | undefined, b: string | undefined): number {
  const ak = resolveWarehouseNumberIdentity(a);
  const bk = resolveWarehouseNumberIdentity(b);
  return ak.categoryIndex - bk.categoryIndex
    || ak.numberPart.localeCompare(bk.numberPart, "ko", { numeric: true, sensitivity: "base" })
    || ak.raw.localeCompare(bk.raw, "ko", { numeric: true, sensitivity: "base" });
}

export function compareWarehouseProducts(a: WarehouseSortableProduct, b: WarehouseSortableProduct): number {
  const priority = compareWarehouseNumbers(a.warehouseNumber, b.warehouseNumber);
  if (priority) return priority;
  const ak = [a.modelName || a.modelSku, a.skuId || a.productCode];
  const bk = [b.modelName || b.modelSku, b.skuId || b.productCode];
  for (let i = 0; i < ak.length; i += 1) { const diff = natural(ak[i]).localeCompare(natural(bk[i]), "ko", { numeric: true }); if (diff) return diff; }
  return 0;
}
export function sortWarehouseProducts<T extends WarehouseSortableProduct>(items: readonly T[]): T[] {
  return items.map((item, index) => ({ item, index })).sort((a, b) => compareWarehouseProducts(a.item, b.item) || a.index - b.index).map(entry => entry.item);
}
