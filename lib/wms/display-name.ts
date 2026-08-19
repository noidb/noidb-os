/**
 * 화면 표시용 상품명 정리 — Google Sheets/원본 상품명은 절대 바꾸지 않고, 렌더링 시에만
 * 불필요한 단어를 제거해 뒤쪽 옵션(컬러/사이즈/호수)이 잘 보이게 한다 (2026-08-19 사용자 확정).
 */
const NOISE_WORDS = ["노이드비", "여성용", "남성용"];

export function cleanDisplayProductName(name: string): string {
  let result = name || "";
  for (const word of NOISE_WORDS) {
    result = result.split(word).join("");
  }
  return result.replace(/\s{2,}/g, " ").trim();
}
