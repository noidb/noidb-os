/**
 * 2026-11-10 신상등록대기 모델 폴더의 '상품정보.txt'를 읽어 등록 화면 칸으로 바꾼다.
 * 줄 순서는 고정: 거래처 → 원가(부가세 미포함) → 판매가 → 상품명 → 치수(사이즈).
 * 브라우저·서버 어디서든 쓰는 순수 함수만 둔다.
 */

export const PRODUCT_INFO_LABELS = ["거래처", "원가(부가세 미포함)", "판매가", "상품명", "치수"] as const;
export const PRODUCT_INFO_STORAGE_KEY = "noidb-new-product-info-v1";

export type ParsedProductInfo = {
  lines: string[];
  supplier: string;
  costExVat: string;
  price: string;
  titleText: string;
  dimension: string;
  /** 형식이 맞지 않는 곳 설명(비어 있으면 정상) */
  problems: string[];
};

const digitsOf = (value: string) => value.replace(/[,\s원₩]/g, "");

export function parseProductInfo(text: string): ParsedProductInfo {
  const lines = String(text || "").replace(/^﻿/, "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const problems: string[] = [];
  const costExVat = digitsOf(lines[1] || "");
  const price = digitsOf(lines[2] || "");
  if (lines.length < 4) problems.push("줄이 부족합니다(거래처·원가·판매가·상품명 순서로 4줄 이상 필요).");
  if (lines[1] && !/^\d+$/.test(costExVat)) problems.push(`2번째 줄(원가)이 숫자가 아닙니다: ${lines[1]}`);
  if (lines[2] && !/^\d+$/.test(price)) problems.push(`3번째 줄(판매가)이 숫자가 아닙니다: ${lines[2]}`);
  return {
    lines,
    supplier: lines[0] || "",
    costExVat: /^\d+$/.test(costExVat) ? costExVat : "",
    price: /^\d+$/.test(price) ? price : "",
    titleText: lines[3] || "",
    dimension: lines[4] || "",
    problems,
  };
}

export type ParsedTitle = { gender: string; material: string; category: string; keyword: string };

/** 상품명 한 줄에서 성별·소재·카테고리를 뽑고, 나머지를 키워드로 돌려준다. */
export function parseProductTitle(title: string, options: { genders: string[]; materials: string[]; categories: string[] }): ParsedTitle {
  const tokens = title.replace(/[,，、/|+()[\]{}:;·]+/g, " ").split(/\s+/).map(token => token.trim()).filter(Boolean);
  const used = new Set<number>();
  const pick = (candidates: string[], prefer: "first" | "last" = "first") => {
    // 긴 이름부터 맞춰 '남녀공용'이 '남성'보다 먼저 잡히게 한다.
    const ordered = [...candidates].sort((a, b) => b.length - a.length);
    let found = "";
    let foundAt = -1;
    for (const name of ordered) {
      const indexes = tokens.map((token, index) => (token === name && !used.has(index) ? index : -1)).filter(index => index >= 0);
      if (!indexes.length) continue;
      const at = prefer === "last" ? indexes[indexes.length - 1] : indexes[0];
      if (!found || (prefer === "last" ? at > foundAt : at < foundAt)) { found = name; foundAt = at; }
    }
    if (foundAt >= 0) used.add(foundAt);
    return found;
  };
  const gender = pick([...options.genders, "여성용", "남성용"]).replace(/^(여성|남성)용$/, "$1");
  const material = pick(options.materials);
  const category = pick(options.categories, "last");
  const keyword = tokens.filter((_, index) => !used.has(index)).join(" ");
  return { gender, material, category, keyword };
}

/** 텍스트 파일 바이트를 글자로 바꾼다. UTF-8이 아니면 윈도우 메모장 기본(CP949)으로 읽는다. */
export function decodeTextFile(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try { return new TextDecoder("euc-kr").decode(bytes); } catch { return new TextDecoder("utf-8").decode(bytes); }
  }
}
