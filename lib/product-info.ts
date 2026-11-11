/**
 * 2026-11-10 신상등록대기 모델 폴더의 '상품정보.txt'를 읽어 등록 화면 칸으로 바꾼다.
 * 줄 순서는 고정: 거래처 → 원가(부가세 미포함) → 판매가 → 상품명 → 치수(사이즈).
 * 브라우저·서버 어디서든 쓰는 순수 함수만 둔다.
 */

export const PRODUCT_INFO_LABELS = ["거래처", "원가(부가세 미포함)", "판매가", "상품명", "치수"] as const;
export const PRODUCT_INFO_STORAGE_KEY = "noidb-new-product-info-v1";

/** 상품정보 파일로 인정하는 이름(앞에 있을수록 먼저). 이 이름이 없고 폴더에 txt가 하나뿐이면 그 파일을 쓴다. */
export const PRODUCT_INFO_FILE_NAMES = ["상품정보.txt", "상품설명.txt"];

export type ParsedProductInfo = {
  lines: string[];
  /** 화면 표시용: 줄마다 이름(거래처·원가…)과 값. 이름표가 없는 옛 형식은 줄 순서로 이름을 붙인다. */
  entries: { label: string; value: string; raw: string }[];
  supplier: string;
  /** 원가(부가세 미포함). 파일에 'vat포함'이라 적혀 있으면 비어 있고 costIncVat에 들어간다. */
  costExVat: string;
  /** 파일에 'vat포함'이라 적힌 원가(그대로 원가(부가세포함)로 쓴다). */
  costIncVat: string;
  price: string;
  titleText: string;
  dimension: string;
  /** 형식이 맞지 않는 곳 설명(비어 있으면 정상) */
  problems: string[];
};

type InfoKey = "supplier" | "cost" | "price" | "title" | "dimension";
const LABEL_ALIASES: Record<InfoKey, string[]> = {
  supplier: ["거래처", "공급처", "매입처"],
  cost: ["원가", "공급가", "매입가", "도매가", "단가"],
  price: ["판매가", "판매가격", "쿠팡판매가", "소비자가"],
  title: ["상품명", "제품명", "쿠팡상품명"],
  dimension: ["치수", "사이즈", "크기", "규격"],
};
const KEY_LABEL: Record<InfoKey, string> = { supplier: "거래처", cost: "원가(부가세 미포함)", price: "판매가", title: "상품명", dimension: "치수" };
const POSITION_KEYS: InfoKey[] = ["supplier", "cost", "price", "title", "dimension"];

function keyOfLabel(label: string): InfoKey | null {
  const clean = label.replace(/\s+/g, "");
  for (const key of Object.keys(LABEL_ALIASES) as InfoKey[]) if (LABEL_ALIASES[key].includes(clean)) return key;
  return null;
}

/** '거래처: 비에이블리'처럼 첫 ':' 앞이 알려진 이름이면 (이름, 값). 아니면 null. */
function splitLabeled(line: string): { key: InfoKey; value: string } | null {
  const match = line.match(/^([^:：]{1,12})[:：]\s*(.*)$/);
  if (!match) return null;
  const key = keyOfLabel(match[1]);
  return key ? { key, value: match[2].trim() } : null;
}

/** '2500(vat제외)'·'3,000원 vat포함'에서 숫자와 부가세 표기를 읽는다. 표기가 없으면 부가세 미포함으로 본다. */
function readMoney(value: string): { digits: string; vatIncluded: boolean } {
  const digits = (value.match(/\d[\d,]*/)?.[0] || "").replace(/,/g, "");
  const note = value.replace(/\s+/g, "").toLowerCase();
  const excluded = /(vat|부가세|부가가치세)(제외|별도|미포함|불포함)|(vat|부가세)\s*x|부가세별/.test(note);
  const included = !excluded && /(vat|부가세|부가가치세)(포함|별도아님)/.test(note);
  return { digits, vatIncluded: included };
}

export function parseProductInfo(text: string): ParsedProductInfo {
  const lines = String(text || "").replace(/^﻿/, "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const problems: string[] = [];
  const values: Partial<Record<InfoKey, string>> = {};
  const entries: ParsedProductInfo["entries"] = [];
  const labeled = lines.map(splitLabeled);
  if (labeled.some(Boolean)) {
    // 이름표가 있는 형식: 줄 순서와 상관없이 이름으로 찾는다. 이름표가 없는 줄은 그대로 보여 주기만 한다.
    lines.forEach((line, index) => {
      const hit = labeled[index];
      if (hit) {
        if (values[hit.key] === undefined) values[hit.key] = hit.value;
        entries.push({ label: KEY_LABEL[hit.key], value: hit.value, raw: line });
      } else entries.push({ label: `${index + 1}번째 줄`, value: line, raw: line });
    });
  } else {
    // 이름표가 없는 옛 형식: 거래처 → 원가(부가세 미포함) → 판매가 → 상품명 → 치수 순서
    lines.forEach((line, index) => {
      const key = POSITION_KEYS[index];
      if (key) values[key] = line;
      entries.push({ label: key ? KEY_LABEL[key] : `${index + 1}번째 줄`, value: line, raw: line });
    });
    if (lines.length < 4) problems.push("줄이 부족합니다(거래처·원가·판매가·상품명 순서로 4줄 이상 필요).");
  }
  const cost = readMoney(values.cost || "");
  const price = readMoney(values.price || "").digits;
  if (values.cost && !cost.digits) problems.push(`원가에서 숫자를 찾지 못했습니다: ${values.cost}`);
  if (values.price && !price) problems.push(`판매가에서 숫자를 찾지 못했습니다: ${values.price}`);
  if (labeled.some(Boolean)) {
    if (!values.supplier) problems.push("거래처 줄이 없습니다.");
    if (!values.title) problems.push("상품명 줄이 없습니다.");
  }
  return {
    lines,
    entries,
    supplier: values.supplier || "",
    costExVat: cost.vatIncluded ? "" : cost.digits,
    costIncVat: cost.vatIncluded ? cost.digits : "",
    price,
    titleText: values.title || "",
    dimension: values.dimension || "",
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
