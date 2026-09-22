"use client";

/** 혼자 쓰는 내부 도구라 PIN 확인 팝업은 없앴다(2026-09-23, 사용자 요청).
 *  호출부를 전부 고치지 않도록 항상 true를 반환하는 자리만 남겨둔다. */
export async function ensureNoidbActionSession(): Promise<boolean> {
  return true;
}
