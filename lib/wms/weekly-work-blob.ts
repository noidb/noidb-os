import { getFreshPrivateBlob } from "./fresh-blob-get";

/** 캐시 없는 읽기가 막힌 계정에서도 최신 저장본을 읽는다(2026-10-11, fresh-blob-get 참고).
 * Mutable writes still use the returned ETag, so a stale read cannot overwrite newer data. */
export async function readWeeklyBlob(pathname: string) {
  return getFreshPrivateBlob(pathname);
}
