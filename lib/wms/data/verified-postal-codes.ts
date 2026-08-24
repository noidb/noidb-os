/**
 * 발주서 원본에는 우편번호 항목이 없고, 기존 한진 서식에도 과거 이용 이력이 없어 우편번호를
 * 확보할 수 없는 물류센터를 위한 영구 등록 목록(2026-08-24 신규).
 *
 * 각 항목은 "공식 도로명주소 안내시스템(juso.go.kr) 계열 공식 데이터"로 조회한 뒤, 조회 결과
 * 주소가 발주서 원본 주소와 정확히 일치하는 것을 직접 확인하고서만 등록했다 — 센터명만 보고
 * 추측하거나 다른 센터의 우편번호를 재사용한 값은 하나도 없다. 후보가 여러 개거나 건물번호가
 * 불일치하는 경우는 이 목록에 넣지 않고 수동 확인 대상으로 남긴다(현재 5곳 모두 단일 후보,
 * 건물번호 일치 확인 완료).
 *
 * matchAddress는 발주서 원본 주소의 "도로명(또는 지번)+건물번호"까지만 담는다 — 그 뒤에 붙는
 * 동/층/Dock번호 같은 상세정보는 건물 자체의 우편번호와 무관하므로 비교 대상에서 제외한다.
 * findVerifiedPostalCode()는 공백을 제거한 원본 주소가 이 matchAddress로 "시작"할 때만 일치로
 * 본다 — 건물번호가 다르면(예: 55가 아니라 57) 절대 일치하지 않는다. 일치하지 않으면 null을
 * 반환해 기존의 "우편번호 확인 안 됨" 처리로 자연스럽게 넘어간다(추측 금지, fail-closed).
 */

export interface VerifiedPostalCode {
  fulfillmentCenter: string;
  /** 우편번호 조회에 사용한 발주서 원본 주소(도로명/지번 + 건물번호까지, 동/층/Dock 등 상세 제외) */
  matchAddress: string;
  /** 검증 당시 확인한 발주서 원본 전체 주소(참고·재검증용, 그대로 보존) */
  sourceAddress: string;
  zip: string;
  /** 조회에 사용한 공식 출처(도로명주소 안내시스템 계열) */
  verifiedSource: string;
  verifiedAt: string;
}

export const VERIFIED_POSTAL_CODES: VerifiedPostalCode[] = [
  {
    fulfillmentCenter: "인천28",
    matchAddress: "인천광역시 서구 북항로 120번길 55",
    sourceAddress: "인천광역시 서구 북항로 120번길 55, B동 7F 30번 Dock",
    zip: "22853",
    verifiedSource: "https://dorojuso.kr/2826011100103910009000003/",
    verifiedAt: "2026-08-24",
  },
  {
    fulfillmentCenter: "이천2",
    matchAddress: "경기도 이천시 마장면 이장로 329-38",
    sourceAddress: "경기도 이천시 마장면 이장로 329-38",
    zip: "17383",
    verifiedSource: "https://dorojuso.kr/4150034025104490005000001/",
    verifiedAt: "2026-08-24",
  },
  {
    fulfillmentCenter: "이천4",
    matchAddress: "경기도 이천시 부발읍 송온리 442",
    sourceAddress: "경기도 이천시 부발읍 송온리 442 2층",
    zip: "17405",
    verifiedSource: "https://dorojuso.kr/4150025332104420000000001/ (지번→도로명: 경기도 이천시 부발읍 황무로 1901)",
    verifiedAt: "2026-08-24",
  },
  {
    fulfillmentCenter: "시흥2",
    matchAddress: "경기도 시흥시 정왕동 2123-3",
    sourceAddress: "경기도 시흥시 정왕동 2123-3 번지 (6F)",
    zip: "15074",
    verifiedSource: "https://dorojuso.kr/4139013200121230003035775/ (지번→도로명: 경기도 시흥시 만해로 43)",
    verifiedAt: "2026-08-24",
  },
  {
    fulfillmentCenter: "인천14",
    matchAddress: "인천광역시 중구 축항대로 165번길 20",
    sourceAddress: "인천광역시 중구 축항대로 165번길 20, 쿠팡14센터 7층",
    zip: "22335",
    verifiedSource: "https://dorojuso.kr/2811011800100310004190034/ (지번: 인천 중구 항동7가 31-4)",
    verifiedAt: "2026-08-24",
  },
];

function stripWhitespace(value: string): string {
  return value.replace(/\s+/g, "");
}

function normalizeCenterNameForLookup(value: string): string {
  return value.trim().replace(/\s+/g, "");
}

/**
 * 물류센터명이 일치하고, 대상 주소가 등록된 matchAddress로 시작할 때만 우편번호를 반환한다.
 * 둘 중 하나라도 어긋나면 null — 부분 일치나 다른 센터 값 재사용을 절대 허용하지 않는다.
 */
export function findVerifiedPostalCode(fulfillmentCenter: string, address: string): string | null {
  const normalizedCenter = normalizeCenterNameForLookup(fulfillmentCenter);
  const normalizedAddress = stripWhitespace(address);
  for (const entry of VERIFIED_POSTAL_CODES) {
    if (normalizeCenterNameForLookup(entry.fulfillmentCenter) !== normalizedCenter) continue;
    if (normalizedAddress.startsWith(stripWhitespace(entry.matchAddress))) return entry.zip;
  }
  return null;
}
