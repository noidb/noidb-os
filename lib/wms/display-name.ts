/**
 * 화면 표시용 상품명 정리 — Google Sheets/원본 상품명은 절대 바꾸지 않고, 렌더링 시에만
 * 불필요한 단어를 제거해 뒤쪽 옵션(컬러/사이즈/호수)이 잘 보이게 한다 (2026-08-19 사용자 확정).
 *
 * 2026-08-20 추가: "NOID-B"/"NOIDB" 계열 브랜드 표기를 대소문자·하이픈 유무와 무관하게 함께
 * 제거한다(발주확정 서류·카카오톡 공유 이미지·거래처 발주서 초안에서 브랜드명이 노출되지 않게
 * 하기 위한 실사용 요청). "노이드비"/"여성용"/"남성용"은 기존과 동일하게 단순 문자열 치환.
 */
const NOISE_WORDS = ["노이드비", "여성용", "남성용"];
/** 대소문자·공백/하이픈 유무를 무시하고 제거할 브랜드 표기(2026-08-20 신규). */
const NOISE_PATTERNS = [/noid[\s-]?b/gi, /noidb/gi];

export function cleanDisplayProductName(name: string): string {
  let result = name || "";
  for (const word of NOISE_WORDS) {
    result = result.split(word).join("");
  }
  for (const pattern of NOISE_PATTERNS) {
    result = result.replace(pattern, "");
  }
  return result
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,/\-–—]+|[\s,/\-–—]+$/g, "")
    .trim();
}

/**
 * 제품DB "옵션명" 컬럼이 비어있는 옛 상품 중 일부는 옵션이 상품명 끝에 쉼표로 붙어 있다
 * (예: "... 1pcs, D2925로즈골드" → 마지막 옵션은 "D2925로즈골드"). 실제로 존재하는 값을
 * 그대로 읽어내는 것뿐이며, 없는 값을 새로 만들어내지 않는다 (2026-08-19 2차 실사용 테스트
 * 요청 — 옵션 최우선순위 4단계 최종 대안). 마지막 조각이 너무 길면(문장처럼 보이면)
 * 옵션이 아니라고 보고 빈 문자열을 돌려준다.
 */
export function extractTrailingOptionFromName(productName: string): string {
  const name = (productName || "").trim();
  if (!name.includes(",")) return "";
  const lastSegment = name.slice(name.lastIndexOf(",") + 1).trim();
  if (!lastSegment || lastSegment.length > 20) return "";
  if (/\s{3,}/.test(lastSegment)) return "";
  return lastSegment;
}

/**
 * 옵션명 표시 우선순위: 1) 최신 제품DB(구글시트) 옵션명 → 2) 저장된(발주서 생성 시점) 옵션명 →
 * 3) 상품명 끝에 명확히 붙은 옵션 추출 → 4) 없음("").  화면에서 "옵션 없음"으로 보여줄지는
 * 호출한 쪽이 빈 문자열 여부로 판단한다 (2026-08-19 2차 실사용 테스트 반영).
 */
export function resolveDisplayOption(productName: string, storedOptionLabel?: string, liveOptionLabel?: string): string {
  return resolveDisplayNameAndOption(productName, storedOptionLabel, liveOptionLabel).option;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 상품명 끝부분이 옵션명과 (대소문자·연속 공백 차이를 무시하고) 정확히 일치할 때만 그 부분과
 * 그 앞의 구분기호(쉼표/슬래시/하이픈/공백)를 함께 제거한다. 옵션이 상품명 중간에 있거나
 * 끝부분과 정확히 일치하지 않으면 아무것도 지우지 않는다 — 임의 추측 없이 "확실히 판별되는
 * 경우"만 처리한다 (2026-08-19 4차 실사용 테스트 반영: 상품명/옵션명 중복 표시 수정).
 */
function stripTrailingOptionFromName(name: string, option: string): string {
  const trimmedOption = option.trim();
  if (!trimmedOption) return name;
  const optionPattern = escapeRegExp(trimmedOption).replace(/\s+/g, "\\s+");
  const trailingMatch = new RegExp(`[\\s,/\\-–—]+${optionPattern}\\s*$`, "i").exec(name);
  if (!trailingMatch) return name;
  return name.slice(0, trailingMatch.index).replace(/[\s,/\-–—]+$/, "").trim();
}

/**
 * 상품명 정리 + 옵션 추출을 한 번에 돌려준다. 확정된 옵션명(제품DB 실제 값이든, 상품명 끝에서
 * 추출한 값이든)이 상품명 끝부분과 겹치면 그 중복 부분을 상품명에서 제거해 "상품명 / 옵션"이
 * 두 줄에 중복 표시되지 않게 한다 — 화면(거래처 발주서 초안 카드, 수동 상품검색 결과)과 카카오톡
 * 공유/이미지 저장 발주서가 항상 이 함수 하나만 거치므로 서로 다른 결과가 나오지 않는다
 * (2026-08-19 4차 실사용 테스트 반영). Google Sheets 원본 상품명 자체는 바꾸지 않는다 — 이 함수는
 * 화면 표시용 문자열만 새로 계산해서 돌려준다.
 */
export function resolveDisplayNameAndOption(
  productName: string,
  storedOptionLabel?: string,
  liveOptionLabel?: string
): { name: string; option: string } {
  const cleanedName = cleanDisplayProductName(productName);
  const live = (liveOptionLabel || "").trim();
  const stored = (storedOptionLabel || "").trim();
  const knownOption = live || stored;

  if (knownOption) {
    return { name: stripTrailingOptionFromName(cleanedName, knownOption), option: knownOption };
  }

  const extracted = extractTrailingOptionFromName(cleanedName);
  if (!extracted) return { name: cleanedName, option: "" };
  const strippedName = stripTrailingOptionFromName(cleanedName, extracted);
  return { name: strippedName || cleanedName, option: extracted };
}
