/**
 * SKU ID/모델SKU 정규화 — 순수 문자열 함수만 모아둔 의존성 없는 모듈 (2026-08-20 신규).
 *
 * 이 함수들은 브라우저(클라이언트 컴포넌트)에서도 쓰인다(예: lib/wms/picking-wave/live-catalog.ts,
 * "제품DB 새로고침" 매칭). product-catalog.ts에서 직접 가져오면 그 파일이 import하는
 * google-sheets.ts → google-service-account.ts → node:crypto까지 클라이언트 번들에 함께
 * 딸려 들어가 "Reading from node:crypto is not handled" 웹팩 오류가 난다(2026-08-20 실제 확인) —
 * 그래서 정규화 로직만 이 의존성 없는 파일로 분리했다. product-catalog.ts는 이 파일의 함수를
 * 그대로 재노출(re-export)해 기존 서버 쪽 호출부(product-catalog-write.ts 등)는 바꿀 필요 없다.
 */

/** 숫자/문자/쉼표 형식이 달라도 같은 SKU ID로 비교할 수 있게 정규화한다. */
export function normalizeSkuId(value: string | undefined): string {
  return String(value ?? "").trim().replace(/^'/, "").replace(/[\s,]/g, "").replace(/\.0+$/, "");
}

/** 모델SKU 비교용 정규화 — 앞뒤 공백 제거 + 대소문자 무시(비교/맵 키 용도로만 소문자화, 표시용
 *  원본 값은 별도로 그대로 둔다). 부분일치는 절대 허용하지 않는다(정확히 같은 문자열만 일치). */
export function normalizeModelSkuKey(value: string | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}
