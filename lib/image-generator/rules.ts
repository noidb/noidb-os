import type { ColorCode, GeneratorProduct, GeneratedAsset, PhotoRole } from "./types";
import { categoryProfile } from "./category-profiles";

export const COLOR_OPTIONS: { code: ColorCode; label: string; metal: string }[] = [
  { code: "RG", label: "로즈골드", metal: "warm rose-gold metal" },
  { code: "GO", label: "골드", metal: "rich yellow-gold metal" },
  { code: "SI", label: "실버", metal: "neutral polished silver metal" },
];

export const PHOTO_ROLES: { value: PhotoRole; label: string }[] = [
  { value: "front", label: "제품 정면" },
  { value: "back", label: "제품 뒷면" },
  { value: "side", label: "제품 측면" },
  { value: "clasp", label: "잠금장치" },
  { value: "pair", label: "제품 한 쌍" },
  { value: "wear-reference", label: "착용 크기·위치 참고" },
  { value: "size-reference", label: "자와 함께 찍은 크기" },
  { value: "detail-reference", label: "상세페이지 참고" },
  { value: "other", label: "기타 참고" },
];

export function colorLabel(code: ColorCode) {
  return COLOR_OPTIONS.find(item => item.code === code)?.label || code;
}

export function allColorRule(colors: ColorCode[], category = "귀걸이") {
  const unique = [...new Set(colors)];
  const profile = categoryProfile(category);
  return {
    enabled: unique.length >= 2,
    colorCount: unique.length,
    unitsPerColor: profile.unitsPerColor,
    expectedProducts: unique.length * profile.unitsPerColor,
    message: unique.length < 2
      ? "선택한 색상이 1개이므로 전 컬러 옵션컷은 자동으로 생략됩니다."
      : profile.unitsPerColor === 2
        ? `${unique.length}컬러를 한 쌍씩 배치해 총 ${unique.length * 2}개 제품이 보이는 옵션컷 2장을 만듭니다.`
        : `${unique.length}컬러를 1개씩 배치해 총 ${unique.length}개 제품이 보이는 옵션컷 2장을 만듭니다.`,
  };
}

export function filenameFor(model: string, kind: string, color?: ColorCode, variant = 1) {
  const safeModel = model.trim() || "MODEL";
  if (kind === "color" && color) return `${safeModel}-${color}.jpg`;
  if (kind === "wear") return `${safeModel}-WEAR-${String(variant).padStart(2, "0")}.jpg`;
  if (kind === "all-colors") return `${safeModel}-ALL-${String(variant).padStart(2, "0")}.jpg`;
  if (kind === "detail") return `${safeModel}-DETAIL-${String(variant).padStart(2, "0")}.jpg`;
  if (kind === "baseline") return `${safeModel}-BASELINE.jpg`;
  if (kind === "model-template") return `NOID-B-MODEL-TEMPLATE.jpg`;
  return `${safeModel}.jpg`;
}

export function estimateImageCalls(product: GeneratorProduct, assets: GeneratedAsset[], hasModelTemplate: boolean) {
  const approved = (kind: string, predicate?: (asset: GeneratedAsset) => boolean) =>
    assets.some(asset => asset.kind === kind && asset.approved && (!predicate || predicate(asset)));
  const baseline = approved("baseline") ? 0 : 1;
  const colors = product.colors.filter(color => !approved("color", asset => asset.color === color)).length;
  const wear = [1, 2, 3].filter(variant => !approved("wear", asset => asset.variant === variant)).length;
  const modelTemplate = hasModelTemplate ? 0 : 1;
  return {
    baseline,
    colors,
    wear,
    modelTemplate,
    total: baseline + colors + wear + modelTemplate,
    freeCompositions: allColorRule(product.colors, product.category).enabled ? 3 : 1,
  };
}

export function initialProduct(): GeneratorProduct {
  return {
    category: "귀걸이",
    model: "",
    photographedColor: "SI",
    colors: ["RG", "GO", "SI"],
    wearColor: "SI",
    widthMm: "",
    heightMm: "",
    thicknessMm: "",
  };
}
