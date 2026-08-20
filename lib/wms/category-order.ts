/**
 * 실제 창고 동선 순서로 카테고리를 배치하는 모듈 (2026-08-19 2차 실사용 테스트 반영).
 *
 * 제품DB "카테고리" 값은 표기가 일정하지 않다 — 짧은 라벨("목걸이", "반지")과 쿠팡 전체
 * 카테고리 경로("패션의류잡화>남성패션>남성쥬얼리>...")가 섞여 있고, 성별 표시가 있는 것과
 * 없는 것이 섞여 있다 (2026-08-19 실제 데이터 확인). 아래는 키워드 매칭으로 실제 값을
 * 11단계 창고 버킷에 매핑한다 — 철자/표기 차이(세트/세트 상품/SET 등)만 흡수하고, 상품 카테고리
 * 자체를 임의로 바꾸지 않는다.
 *
 * 중요한 데이터 한계 + 최종 결정(2026-08-19): "목걸이"(449개)·"반지"(283개)·"팔찌"(220개)·
 * "발찌"(158개) 등 성별 표시가 전혀 없는 카테고리가 카탈로그의 대부분을 차지한다. 처음에는
 * 이런 상품을 "기타/미분류"로 보내기로 했으나, 사용자가 "성별이 없는 기존 카테고리에만 임시
 * 여성 기본 매핑 적용"으로 최종 확정했다 — 이 브랜드 카탈로그가 대부분 여성 상품이기 때문에
 * 여성 버킷을 임시 기본값으로 쓰고, 실제로 남성 상품인데 표시가 안 된 것이 있으면 제품DB에
 * "여성"/"남성"을 명시해 바로잡는 방식이다. 이 함수는 상태를 저장하지 않는 순수 계산이라,
 * 제품DB 카테고리 값이 바뀌면(구글시트 수정 → 새로고침) 다음 계산부터 즉시 반영된다 — 예전에
 * 계산한 버킷 값을 어디에도 캐시/저장하지 않는다.
 */

export const WAREHOUSE_CATEGORY_ORDER = [
  "세트상품 BOX",
  "남자팔찌",
  "남자반지",
  "남자목걸이",
  "남녀공용목걸이",
  "귀걸이",
  "피어싱",
  "이어커프",
  "여성목걸이",
  "여성반지",
  "여성팔찌",
  "여성발찌",
] as const;

export const UNCATEGORIZED_BUCKET = "기타/미분류";

/** 제품DB 원본 카테고리 문자열 → 12단계 창고 버킷(+ 기타/미분류). 매핑 안 되면 UNCATEGORIZED_BUCKET. */
export function resolveWarehouseCategoryBucket(rawCategory: string | undefined): string {
  const cat = (rawCategory || "").trim();
  if (!cat) return UNCATEGORIZED_BUCKET;

  if (/세트|SET/i.test(cat)) return "세트상품 BOX";

  // 목걸이는 "공용" 표시를 남성/여성보다 먼저 확인한다(2026-08-19 사용자 확정 우선순위).
  const isUnisex = /남녀공용|공용|유니섹스/.test(cat);
  const isMale = /남성|남자/.test(cat);
  const isFemale = /여성|여자/.test(cat);

  if (/이어커프/.test(cat)) return "이어커프";
  if (/피어싱/.test(cat)) return "피어싱";
  if (/귀걸이/.test(cat)) return "귀걸이"; // 성별 표기와 무관하게 하나의 귀걸이 버킷(주문 목록 6번)으로 통합

  if (/목걸이/.test(cat)) {
    if (isUnisex) return "남녀공용목걸이";
    if (isMale) return "남자목걸이";
    if (isFemale) return "여성목걸이";
    // 성별 표시가 없으면 "임시" 여성 기본값 — 이 브랜드 카탈로그가 대부분 여성 상품이기 때문
    // (2026-08-19 사용자 최종 확정). 실제로 남성/공용 상품이면 제품DB 카테고리에 명시해야 정확히 분류된다.
    return "여성목걸이";
  }
  if (/반지/.test(cat)) return isMale ? "남자반지" : "여성반지";
  if (/팔찌/.test(cat)) return isMale ? "남자팔찌" : "여성팔찌";
  if (/발찌/.test(cat)) return "여성발찌"; // 남자발찌 버킷은 주문 목록에 없음 — 남성 표시가 있어도 이 버킷으로

  return UNCATEGORIZED_BUCKET;
}

/** 정렬용 우선순위 인덱스. 목록에 없는 버킷(기타/미분류)은 항상 맨 뒤. */
export function warehouseCategorySortIndex(bucket: string): number {
  const idx = (WAREHOUSE_CATEGORY_ORDER as readonly string[]).indexOf(bucket);
  return idx === -1 ? WAREHOUSE_CATEGORY_ORDER.length : idx;
}
