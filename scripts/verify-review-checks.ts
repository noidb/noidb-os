/**
 * 2026-11-11 상품등록 검수 자동 검사 확인.
 * 실행: npx --yes tsx scripts/verify-review-checks.ts
 */
import assert from "node:assert/strict";
import { runReviewChecks } from "../lib/review/checks";
import type { ReviewRecord } from "../lib/review/types";

const summary = { title: "써지컬스틸 리본 여성 반지", category: "반지", gender: "여성", supplier: "프리스타일", colors: "골드,실버", sizes: "9호,11호", cost: "2000", price: "9900", tags: "반지", dimension: "폭 3mm" };
const payload = (extra: Record<string, unknown> = {}) => ({
  model: "wr0001", title: summary.title, tags: summary.tags,
  product: { supplier: "프리스타일", category: "반지", gender: "여성", material: "써지컬스틸", colors: "골드,실버", sizes: "9호,11호", modelNo: "1", warehouse: "", replacementSku: "", keyword: "리본", dimension: "폭 3mm", cost: "2000", price: "9900", ...extra },
  skuImages: {},
});
const base = (over: Partial<ReviewRecord> = {}) => ({
  model: "wr0001", summary, payload: payload(),
  thumbs: [{ label: "골드 9호 썸네일", ref: "aaaaaaaa" }, { label: "실버 9호 썸네일", ref: "bbbbbbbb" }],
  slots: [{ label: "전체옵션", ref: "cccccccc" }, { label: "상세컷", ref: "" }],
  details: [{ label: "상세 사진 1", ref: "dddddddd" }], detailPreviewRef: "eeeeeeee",
  images: { aaaaaaaa: { width: 1000, height: 1000, bytes: 1 }, bbbbbbbb: { width: 1000, height: 1000, bytes: 1 }, cccccccc: { width: 1000, height: 1000, bytes: 1 }, dddddddd: { width: 860, height: 900, bytes: 1 }, eeeeeeee: { width: 860, height: 5000, bytes: 1 } },
  ...over,
});
const text = (checks: { level: string; text: string }[], level: string) => checks.filter(check => check.level === level).map(check => check.text).join(" | ");

async function main() {
  const good = await runReviewChecks(base(), []);
  console.log(good.map(check => `${check.level} [${check.group}] ${check.text}`).join("\n"));
  assert.ok(!good.some(check => check.level === "fail" && check.group !== "쿠팡 양식"), "정상 입력에는 기본정보·이미지 오류가 없다");
  assert.match(text(good, "warn"), /비어 있는 추가이미지 칸: 상세컷/, "빈 추가이미지 칸 안내");

  const missing = await runReviewChecks(base({
    summary: { ...summary, supplier: "", price: "1000" },
    thumbs: [{ label: "골드 9호 썸네일", ref: "aaaaaaaa" }, { label: "실버 9호 썸네일", ref: "" }],
    images: { aaaaaaaa: { width: 400, height: 400, bytes: 1 } },
    detailPreviewRef: "", details: [],
  }), []);
  const fails = text(missing, "fail");
  assert.match(fails, /빠진 칸: 거래처/, "빠진 기본정보");
  assert.match(fails, /원가\(2,000\) 이하|원가/, "판매가가 원가보다 낮음");
  assert.match(fails, /대표 썸네일이 빠진 옵션 1개: 실버 9호 썸네일/, "빠진 썸네일");
  assert.match(fails, /500×500보다 작은 사진/, "작은 사진");
  assert.match(fails, /상세페이지 사진이 없습니다/, "상세페이지 없음");

  const dup = await runReviewChecks(base(), [{ ...(base() as unknown as ReviewRecord), model: "wr0002", submittedAt: "", status: "pending", memo: "", data: null, checks: [], checkedAt: "" }]);
  assert.match(text(dup, "warn"), /같은 상품명이 다른 모델\(wr0002\)/, "상품명 중복");
  console.log("verify-review-checks OK");
}

main().catch(error => { console.error(error); process.exit(1); });
