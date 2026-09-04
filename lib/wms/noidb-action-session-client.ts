"use client";

const ACTION_CODE_STORAGE_KEY = "noidb-quick-detail-sync-code";

/** 제품DB 쓰기 전에 서버의 관리자 세션을 확인하고, 필요할 때만 연동번호를 받는다. */
export async function ensureNoidbActionSession(): Promise<boolean> {
  const statusResponse = await fetch("/api/auth/noidb-action-session", { cache: "no-store" });
  const status = await statusResponse.json().catch(() => ({}));
  if (statusResponse.ok && status.authenticated) return true;
  if (statusResponse.ok && !status.configured) throw new Error("서버 관리자 연동번호가 아직 설정되지 않았습니다.");

  let code = window.localStorage.getItem(ACTION_CODE_STORAGE_KEY)?.trim() || "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!code) {
      code = window.prompt("제품DB 상태 변경 보호를 위해 기존 상세페이지 연동번호를 입력해주세요. 이 PC에서는 한 번만 확인합니다.")?.trim() || "";
    }
    if (!code) return false;
    const response = await fetch("/api/auth/noidb-action-session", {
      method: "POST",
      headers: { "x-noidb-action-code": code },
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.authenticated) {
      window.localStorage.setItem(ACTION_CODE_STORAGE_KEY, code);
      return true;
    }
    window.localStorage.removeItem(ACTION_CODE_STORAGE_KEY);
    code = "";
    if (attempt === 1) throw new Error(data.error || "관리자 잠금을 해제하지 못했습니다.");
  }
  return false;
}
