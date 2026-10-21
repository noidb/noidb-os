/**
 * 재등록이 '기존 상품과 중복'으로 반려될 때 쿠팡에 남아 있는 예전 SKU를 이름으로 찾는다(2026-10-21).
 * 상품명에서 쉼표 앞(옵션 제외)만 보고, 흔한 말(써지컬스틸·노이드비·컬러 수 등)을 뺀 낱말이
 * 2개 이상, 짧은 쪽 낱말의 60% 이상 겹치면 같은 상품 후보로 본다.
 */
const COMMON = new Set(["써지컬스틸", "써지컬", "노이드비", "신주", "자체제작", "특별제작", "세트", "패키지", "랜덤발송", "선물포장"]);

export function legacyNameTokens(name: string): string[] {
  const base = String(name || "").split(",")[0].replace(/노이드비/g, " ").replace(/[()\[\]+·/&]/g, " ");
  return [...new Set(base.split(/\s+/).map(token => token.trim()).filter(token => token.length >= 2 && !COMMON.has(token) && !/^\d+(p|pcs|종|컬러|개|세트)?$/i.test(token) && !/^\d+P세트$/i.test(token)))];
}

// 어느 상품에나 붙는 꾸밈말과 상품 종류(…목걸이·…귀걸이 등)는 겹쳐도 같은 상품이라는 근거가 약하다.
const WEAK = new Set(["심플", "데일리", "베이직", "기본", "여성", "남성", "남녀공용", "커플", "미니", "빅", "얇은", "굵은", "고급", "인기", "유광", "무광"]);
const isCategory = (token: string) => /(목걸이|귀걸이|반지|팔찌|발찌|피어싱|귀찌|이어커프|헤어핀|집게핀|세트)$/.test(token);

export function legacyNameScore(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  const shared = a.filter(token => setB.has(token));
  if (shared.length < 2) return 0;
  // 꾸밈말·상품 종류가 아닌 특징 낱말(예: 대나무체인)이 하나 이상 같아야 한다.
  if (!shared.some(token => !WEAK.has(token) && !isCategory(token))) return 0;
  return shared.length / Math.min(a.length, b.length);
}
