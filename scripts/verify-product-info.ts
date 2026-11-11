/**
 * 2026-11-11 상품정보 txt 읽기 검사(이름표 형식·옛 순서 형식·vat 표기·상품명 분해).
 * 실행: npx --yes tsx scripts/verify-product-info.ts
 */
import assert from "node:assert/strict";
import { parseProductInfo, parseProductTitle } from "../lib/product-info";

// 1) 실제 사용 중인 이름표 형식(wb041708 리본 팔찌)
const labeled = parseProductInfo(
  "거래처: 비에이블리\r\n원가: 2500(vat제외)\r\n판매가:15900\r\n상품명: 여성 써지컬스틸 스네이크체인 리본매듭 팔찌\r\n치수: 체인길이 16~21cm, 리본 2.2cm\r\n",
);
assert.equal(labeled.supplier, "비에이블리");
assert.equal(labeled.costExVat, "2500");
assert.equal(labeled.costIncVat, "");
assert.equal(labeled.price, "15900");
assert.equal(labeled.titleText, "여성 써지컬스틸 스네이크체인 리본매듭 팔찌");
assert.equal(labeled.dimension, "체인길이 16~21cm, 리본 2.2cm");
assert.deepEqual(labeled.problems, []);
assert.equal(labeled.entries[0].label, "거래처");

// 2) 줄 순서가 달라도 이름으로 찾는다
const shuffled = parseProductInfo("상품명: 남성 티타늄 체인 목걸이\n판매가: 19,900원\n거래처: 샬롬\n원가: 3,000원");
assert.equal(shuffled.supplier, "샬롬");
assert.equal(shuffled.costExVat, "3000");
assert.equal(shuffled.price, "19900");

// 3) vat 표기: 포함이면 부가세포함 원가로, 미포함·표기없음은 미포함으로
assert.equal(parseProductInfo("거래처: 샬롬\n원가: 2750 (vat포함)").costIncVat, "2750");
assert.equal(parseProductInfo("거래처: 샬롬\n원가: 2750 (vat포함)").costExVat, "");
assert.equal(parseProductInfo("거래처: 샬롬\n원가: 2500 부가세 미포함").costExVat, "2500");
assert.equal(parseProductInfo("거래처: 샬롬\n원가: 2500").costExVat, "2500");

// 4) 옛 형식(이름표 없이 순서대로)도 그대로 읽는다
const old = parseProductInfo("비에이블리\n2500\n15900\n여성 써지컬스틸 리본 팔찌\n체인길이 16cm");
assert.equal(old.supplier, "비에이블리");
assert.equal(old.costExVat, "2500");
assert.equal(old.price, "15900");
assert.equal(old.titleText, "여성 써지컬스틸 리본 팔찌");
assert.equal(old.dimension, "체인길이 16cm");

// 5) 상품명 한 줄에서 성별·소재·카테고리·키워드를 뽑는다
const title = parseProductTitle(labeled.titleText, {
  genders: ["여성", "남성", "남녀공용"],
  materials: ["써지컬스틸", "925실버", "티타늄"],
  categories: ["반지", "귀걸이", "목걸이", "팔찌"],
});
assert.deepEqual(title, { gender: "여성", material: "써지컬스틸", category: "팔찌", keyword: "스네이크체인 리본매듭" });

// 6) 이름표 형식에서 필수 줄이 없으면 알려 준다
assert.ok(parseProductInfo("원가: 2500\n판매가: 9900").problems.length >= 2);

console.log("verify-product-info OK");
