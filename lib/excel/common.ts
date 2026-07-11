import path from "path";
import type { ExportPayload, SkuRow } from "./types";

export const ALT_TEXT_FOOTER =
  "저희 악세사리는 일반 악세사리에 비해 변색과 알러지가 적고\n심플하면서도 개성있는 감각있는 디자인이 특징입니다.\n아름다운 컬러와 디자인, 가격 또한 훌륭합니다.\n사랑하는 사람에게 선물하세요";

export function colorCode(option: string) {
  const normalized = option.trim().toLowerCase();
  if (normalized.includes("로즈")) return "RG";
  if (normalized.includes("골드") || normalized.includes("gold")) return "GO";
  if (normalized.includes("실버") || normalized.includes("silver")) return "SI";
  if (normalized.includes("블랙") || normalized.includes("black")) return "BK";
  if (normalized.includes("화이트") || normalized.includes("white")) return "WH";
  return normalized.replace(/[^a-z0-9가-힣]/g, "").slice(0, 2).toUpperCase() || "OP";
}

export function ringSizeNumber(size: string) {
  return size.replace(/[^0-9]/g, "");
}

export function splitList(value: string) {
  return value
    .split(/[,，]/)
    .map(v => v.trim())
    .filter(Boolean);
}

export function buildSkuRows(payload: ExportPayload): SkuRow[] {
  const { product, model } = payload;
  const colors = splitList(product.colors);
  const sizes = splitList(product.sizes);
  const useSizeCombo =
    product.category === "반지" ||
    (sizes.length > 0 && sizes.some(s => /\d/.test(s)));

  const rows: SkuRow[] = [];
  for (const color of colors) {
    const code = colorCode(color);
    if (useSizeCombo && sizes.length) {
      for (const size of sizes) {
        const num = ringSizeNumber(size);
        const sku = num ? `${model}-${code}${num}` : `${model}-${code}`;
        rows.push({
          color,
          size,
          colorCode: code,
          sku,
          thumbFile: `${sku}.jpg`,
          detailFile: `${model}.jpg`,
          labelFile: `라벨_${model}.jpg`,
        });
      }
    } else {
      const sku = `${model}-${code}`;
      rows.push({
        color,
        size: sizes[0] || "Free",
        colorCode: code,
        sku,
        thumbFile: `${sku}.jpg`,
        detailFile: `${model}.jpg`,
        labelFile: `라벨_${model}.jpg`,
      });
    }
  }
  return rows;
}

export function templateFileForCategory(category: string) {
  if (category === "귀걸이" || category === "피어싱") return "귀걸이(피어싱).xlsx";
  if (category === "목걸이") return "목걸이.xlsx";
  if (category === "반지") return "반지.xlsx";
  if (category === "발찌") return "발찌.xlsx";
  if (category === "팔찌") return "팔찌.xlsx";
  return null;
}

export function templatesDir() {
  return path.join(process.cwd(), "templates");
}

export function categoryPath(category: string, gender: string) {
  const g = gender === "남성" ? "남성" : gender === "남녀공용" ? "남녀공용" : "여성";

  const map: Record<string, Record<string, string>> = {
    반지: {
      여성: "패션의류잡화>여성패션>여성쥬얼리>반지>여성패션반지 (71594)",
      남성: "패션의류잡화>남성패션>남성쥬얼리>반지>남성패션반지 (71641)",
      남녀공용: "패션의류잡화>여성패션>여성쥬얼리>반지>여성패션반지 (71594)",
    },
    귀걸이: {
      여성: "패션의류잡화>여성패션>여성쥬얼리>귀걸이>여성패션귀걸이 (71579)",
      남성: "패션의류잡화>남성패션>남성쥬얼리>귀걸이>남성패션귀걸이 (71627)",
      남녀공용: "패션의류잡화>유니섹스/남녀공용 패션>공용 쥬얼리>귀걸이>남녀공용패션귀걸이 (71659)",
    },
    피어싱: {
      여성: "패션의류잡화>여성패션>여성쥬얼리>귀걸이>여성피어싱 (109077)",
      남성: "패션의류잡화>남성패션>남성쥬얼리>귀걸이>남성피어싱 (109019)",
      남녀공용: "패션의류잡화>유니섹스/남녀공용 패션>공용 쥬얼리>남녀공용피어싱 (79358)",
    },
    목걸이: {
      여성: "패션의류잡화>여성패션>여성쥬얼리>목걸이/팬던트>여성패션목걸이 (71586)",
      남성: "패션의류잡화>남성패션>남성쥬얼리>목걸이/팬던트>남성패션목걸이 (71633)",
      남녀공용: "패션의류잡화>유니섹스/남녀공용 패션>공용 쥬얼리>목걸이/팬던트>남녀공용패션목걸이 (71665)",
    },
    팔찌: {
      여성: "패션의류잡화>여성패션>여성쥬얼리>팔찌/발찌>여성패션팔찌 (71601)",
      남성: "패션의류잡화>남성패션>남성쥬얼리>팔찌/발찌>남성패션팔찌 (71648)",
      남녀공용: "패션의류잡화>유니섹스/남녀공용 패션>공용 쥬얼리>팔찌/발찌>남녀공용패션 팔찌 (71680)",
    },
    발찌: {
      여성: "패션의류잡화>여성패션>여성쥬얼리>팔찌/발찌>여성패션발찌 (71607)",
      남성: "패션의류잡화>남성패션>남성쥬얼리>팔찌/발찌>남성패션발찌 (71654)",
      남녀공용: "패션의류잡화>유니섹스/남녀공용 패션>공용 쥬얼리>팔찌/발찌>남녀공용패션발찌 (71686)",
    },
  };

  return map[category]?.[g] || map[category]?.["여성"] || "";
}

export function genderTarget(gender: string) {
  if (gender === "남성") return "남성용";
  if (gender === "남녀공용") return "남녀공용";
  return "여성용";
}

export function kindLabel(gender: string, category: string) {
  return `${gender} ${category}`;
}

export function dimensionText(product: ExportPayload["product"]) {
  const sizes = product.sizes || "";
  if (product.category === "반지") {
    return `반지너비 약 1cm, 한국사이즈 ${sizes || "9호,11호,14호,17호,20호,22호,25호"}`;
  }
  if (sizes) return `${product.category} 사이즈 ${sizes}`;
  return "Free";
}

export function supplyPrice(salePrice: number) {
  return Math.round(salePrice * 0.58);
}

export function msrpPrice(salePrice: number) {
  return Math.ceil((salePrice * 1.5) / 1000) * 1000;
}

export function altText(title: string) {
  return `${title}\n${ALT_TEXT_FOOTER}`;
}

export function supplierLabel(supplier: string, gender: string) {
  if (supplier && supplier !== "기타") {
    if (gender === "남성") return `${supplier}(남성)`;
    if (gender === "여성") return `${supplier}(여성)`;
    return supplier;
  }
  if (gender === "남성") return "남성 거래처";
  if (gender === "남녀공용") return "공용 거래처";
  return "여성 거래처";
}

export function detectStone(keyword: string) {
  if (/큐빅|지르콘|cz/i.test(keyword)) return "큐빅";
  if (/진주|펄/i.test(keyword)) return "진주";
  if (/다이아/i.test(keyword)) return "다이아몬드";
  return "";
}

export function parseNumber(value: string) {
  const n = Number(String(value).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
