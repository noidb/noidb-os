/**
 * 입고결과 확인 화면의 탭별 할 일 숫자를 메인(작업센터) 메뉴에 보여 주기 위한 작은 저장소 (2026-10-20).
 *
 * 메인화면을 열 때마다 서버를 다시 조회하면 느려서(사용자 확정: 느린 '불러오는 중' 싫음),
 * 입고결과 화면을 열었을 때 계산한 숫자를 이 브라우저에 기억해 두었다가 그대로 보여 준다.
 * 저장이 안 되는 환경(비공개 창 등)에서는 숫자 없이 버튼만 보인다.
 */

const KEY = "noidb:receipt-tab-counts:v1";

export type ReceiptTabCounts = { anytime: number; results: number; at: string };

export function saveReceiptTabCounts(counts: { anytime: number; results: number }): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...counts, at: new Date().toISOString() }));
  } catch {
    /* 저장할 수 없는 환경이면 숫자 표시만 생략한다 */
  }
}

export function readReceiptTabCounts(): ReceiptTabCounts | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ReceiptTabCounts>;
    if (typeof value.anytime !== "number" || typeof value.results !== "number") return null;
    return { anytime: value.anytime, results: value.results, at: String(value.at || "") };
  } catch {
    return null;
  }
}
