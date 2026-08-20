"use client";

/**
 * 피킹 목록(그룹별 보기 / 전체 체크리스트 / 완료 웨이브 수정)에서 제품링크를 열 때 쓰는 공용
 * 헬퍼. 상품마다 새 탭을 계속 만들지 않고 이름이 같은 창(NOIDB_PRODUCT_PREVIEW) 하나를 계속
 * 재사용한다 — window.open을 같은 이름으로 다시 호출하면 브라우저가 기존 창을 새 URL로
 * 이동시키고 앞으로 가져온다(2026-08-20 신규). 팝업 차단을 피하려면 반드시 사용자의 실제
 * 클릭 이벤트 핸들러 안에서 동기적으로 호출해야 한다.
 */
const PRODUCT_PREVIEW_WINDOW_NAME = "NOIDB_PRODUCT_PREVIEW";
let previewWindowRef: Window | null = null;

export function openProductLinkPreview(url: string | undefined | null) {
  if (!url) return;
  if (previewWindowRef && !previewWindowRef.closed) {
    previewWindowRef.location.href = url;
    previewWindowRef.focus();
    return;
  }
  previewWindowRef = window.open(url, PRODUCT_PREVIEW_WINDOW_NAME, "noopener");
}
