import type { WarehouseZone } from "@/lib/wms/types";

/**
 * 창고 설정/위치 등록 모듈 전용 샘플 데이터.
 * 기존 WMS 피킹 샘플 데이터(lib/wms/picking-sample-data.ts)와는 완전히 분리된 파일이며
 * 서로 참조하지 않는다.
 */

/** 기본 카테고리 코드 (사용자 확정 값) */
export const DEFAULT_ZONES: WarehouseZone[] = [
  { id: "E", name: "귀걸이 구역", category: "귀걸이", sortOrder: 1, status: "active", createdAt: "", updatedAt: "" },
  { id: "P", name: "피어싱 구역", category: "피어싱", sortOrder: 2, status: "active", createdAt: "", updatedAt: "" },
  { id: "N", name: "목걸이 구역", category: "목걸이", sortOrder: 3, status: "active", createdAt: "", updatedAt: "" },
  { id: "R", name: "반지 구역", category: "반지", sortOrder: 4, status: "active", createdAt: "", updatedAt: "" },
  { id: "B", name: "팔찌 구역", category: "팔찌", sortOrder: 5, status: "active", createdAt: "", updatedAt: "" },
  { id: "S", name: "세트 구역", category: "세트", sortOrder: 6, status: "active", createdAt: "", updatedAt: "" },
];

/** 제품 카탈로그(제품DB를 흉내낸 검색용 샘플). 실제 구글시트 연동 전까지 검색/조회에 사용한다. */
export interface SampleCatalogItem {
  skuId: string;
  modelName: string;
  productName: string;
  category: string;
  optionLabel: string;
  /** 기존 "창고번호"(자유 텍스트, 노이드비 내부 위치 정보) 값 */
  legacyLocation: string;
}

export const SAMPLE_CATALOG: SampleCatalogItem[] = [
  { skuId: "4001001", modelName: "GN-9001", productName: "GN-9001 나비 귀걸이", category: "귀걸이", optionLabel: "실버", legacyLocation: "귀걸이서랍2" },
  { skuId: "4001002", modelName: "GN-9001", productName: "GN-9001 나비 귀걸이", category: "귀걸이", optionLabel: "골드", legacyLocation: "귀걸이서랍2" },
  { skuId: "4001010", modelName: "GN-9004", productName: "GN-9004 하트 귀걸이", category: "귀걸이", optionLabel: "실버", legacyLocation: "귀걸이서랍1" },
  { skuId: "4001011", modelName: "GN-9004", productName: "GN-9004 하트 귀걸이", category: "귀걸이", optionLabel: "로즈골드", legacyLocation: "귀걸이서랍1" },

  { skuId: "4002001", modelName: "PC-1002", productName: "PC-1002 코인 피어싱", category: "피어싱", optionLabel: "실버", legacyLocation: "피어싱박스A" },
  { skuId: "4002002", modelName: "PC-1002", productName: "PC-1002 코인 피어싱", category: "피어싱", optionLabel: "골드", legacyLocation: "피어싱박스A" },

  { skuId: "4003001", modelName: "NC-3010", productName: "NC-3010 나비 목걸이", category: "목걸이", optionLabel: "실버", legacyLocation: "목걸이2층선반" },
  { skuId: "4003002", modelName: "NC-3010", productName: "NC-3010 나비 목걸이", category: "목걸이", optionLabel: "골드", legacyLocation: "목걸이2층선반" },
  { skuId: "4003003", modelName: "NC-3010", productName: "NC-3010 나비 목걸이", category: "목걸이", optionLabel: "로즈골드", legacyLocation: "목걸이2층선반" },

  { skuId: "4004001", modelName: "RG-5005", productName: "RG-5005 코인 반지", category: "반지", optionLabel: "9호", legacyLocation: "반지리빙박스" },
  { skuId: "4004002", modelName: "RG-5005", productName: "RG-5005 코인 반지", category: "반지", optionLabel: "11호", legacyLocation: "반지리빙박스" },
  { skuId: "4004003", modelName: "RG-5005", productName: "RG-5005 코인 반지", category: "반지", optionLabel: "14호", legacyLocation: "구창고-미정" },

  { skuId: "4005001", modelName: "BR-7002", productName: "BR-7002 하트 팔찌", category: "팔찌", optionLabel: "실버", legacyLocation: "팔찌지퍼백1" },
  { skuId: "4005002", modelName: "BR-7002", productName: "BR-7002 하트 팔찌", category: "팔찌", optionLabel: "골드", legacyLocation: "팔찌지퍼백1" },

  { skuId: "4006001", modelName: "ST-2001", productName: "ST-2001 나비 세트(목걸이+귀걸이)", category: "세트", optionLabel: "실버", legacyLocation: "세트전용박스" },
  { skuId: "4006002", modelName: "ST-2001", productName: "ST-2001 나비 세트(목걸이+귀걸이)", category: "세트", optionLabel: "골드", legacyLocation: "세트전용박스" },
];

export function listCatalogModelNames(): string[] {
  return [...new Set(SAMPLE_CATALOG.map(item => item.modelName))];
}
