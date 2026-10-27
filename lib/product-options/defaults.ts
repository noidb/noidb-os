import type { CategoryConfig, ProductOptionsConfig } from "./types";

/** 원래 코드에 고정돼 있던 목록. 저장된 설정이 없을 때 그대로 쓴다. */
export const BUILTIN_CATEGORIES: CategoryConfig[] = [
  { name: "반지", letter: "r" },
  { name: "귀걸이", letter: "e" },
  { name: "목걸이", letter: "n" },
  { name: "팔찌", letter: "b" },
  { name: "발찌", letter: "a" },
  { name: "피어싱", letter: "p" },
  { name: "브로치", letter: "c" },
  { name: "세트", letter: "x" },
];

export const DEFAULT_SUPPLIER_LIST = [
  "프리스타일", "JK인터내셔널", "닝구네", "단종", "모건쥬얼리", "블루", "비에이블리",
  "샬롬", "세븐", "스콜피온", "실버데이", "아트피어싱", "자체제작", "제작", "쥬얼리김",
  "창성", "캐럿", "케이원", "태양사", "팝비즈도매", "피어싱도매닷컴", "한나도매", "현", "기타",
];

export const DEFAULT_GENDERS = ["여성", "남성", "남녀공용"];
export const DEFAULT_MATERIALS = ["써지컬스틸", "925실버", "티타늄", "신주", "14K", "18K", "기타"];

export function defaultProductOptions(): ProductOptionsConfig {
  return {
    version: 1,
    suppliers: [...DEFAULT_SUPPLIER_LIST],
    removedSuppliers: [],
    categories: BUILTIN_CATEGORIES.map(category => ({ ...category })),
    genders: [...DEFAULT_GENDERS],
    materials: [...DEFAULT_MATERIALS],
  };
}

const cleanList = (values: unknown): string[] =>
  Array.isArray(values) ? [...new Set(values.map(value => String(value ?? "").trim()).filter(Boolean))] : [];

/** 저장본이 깨졌거나 일부만 있어도 화면이 동작하도록 기본값으로 채운다. */
export function normalizeProductOptions(raw: unknown): ProductOptionsConfig {
  const base = defaultProductOptions();
  if (!raw || typeof raw !== "object") return base;
  const value = raw as Partial<ProductOptionsConfig>;
  const categories = Array.isArray(value.categories)
    ? value.categories
      .filter(category => category && typeof category.name === "string" && category.name.trim())
      .map(category => ({
        ...category,
        name: category.name.trim(),
        letter: String(category.letter || "").trim().toLowerCase(),
      }))
    : base.categories;
  return {
    version: 1,
    suppliers: Array.isArray(value.suppliers) ? cleanList(value.suppliers) : base.suppliers,
    removedSuppliers: cleanList(value.removedSuppliers),
    categories: categories.length ? categories : base.categories,
    genders: Array.isArray(value.genders) && cleanList(value.genders).length ? cleanList(value.genders) : base.genders,
    materials: Array.isArray(value.materials) && cleanList(value.materials).length ? cleanList(value.materials) : base.materials,
    updatedAt: value.updatedAt,
  };
}

/** 모델명 가운데 글자. 설정이 없으면 예전처럼 x(세트). */
export function categoryLetter(config: ProductOptionsConfig | null | undefined, category: string): string {
  const found = (config?.categories || BUILTIN_CATEGORIES).find(item => item.name === category);
  return found?.letter || BUILTIN_CATEGORIES.find(item => item.name === category)?.letter || "x";
}

export function categoryNames(config: ProductOptionsConfig | null | undefined): string[] {
  return (config?.categories || BUILTIN_CATEGORIES).map(item => item.name);
}

/** 사이트(견적서 만들기)가 직접 값을 넣는 쿠팡 양식 칸. 화면에서는 '자동으로 채움'으로 접어 둔다. */
export const SITE_FILLED_HEADERS = new Set([
  "카테고리", "상품명", "상품 바코드", "검색태그", "브랜드", "색상", "주얼리 사이즈", "사이즈",
  "주얼리 소재", "모델명/품번", "사용대상 구분", "패션잡화 사용대상", "출시 연도", "출시연도", "계절",
  "대표이미지 파일명", "상세이미지 파일명", "추가이미지 파일명", "이미지 대체 텍스트", "공급가", "쿠팡 판매가",
  "권장소비자가격", "과세여부", "제조사", "거래타입", "수입여부", "박스 내 SKU 수량", "취급주의 사유",
  "한 개 단품 포장 무게", "한 개 단품 포장 사이즈", "제품 필수 표시사항 (라벨 또는 도안 이미지)", "고시명",
  "종류", "소재", "치수", "제조자(수입자)", "제조국", "취급시 주의사항", "품질보증기준", "A/S 책임자와 전화번호",
]);

/** 사이트가 일부러 비워 두는 칸(사용자 규칙). 기본값을 넣을 수 없게 목록에서 숨긴다. */
export function isAlwaysBlankHeader(header: string): boolean {
  const norm = header.replace(/\s+/g, " ").trim().toLowerCase();
  return norm === "어린이용 여부" || norm === "parent manufacturer part number" || norm === "manufacturer part number";
}

export function isSiteFilledHeader(header: string): boolean {
  const key = header.replace(/\s+/g, " ").trim();
  if (SITE_FILLED_HEADERS.has(key)) return true;
  if (/^유통기간/.test(key) || /추가\s*이미지/.test(key)) return true;
  if (/전기용품.*생활용품.*어린이.*kc.*인증/i.test(key) || /방송통신.*기자재.*emc/i.test(key) || /^kcs\s*인증번호$/i.test(key)) return true;
  return false;
}
