import { NextResponse } from "next/server";
import { clearLocalRefreshToken, hasEnvRefreshToken } from "@/lib/wms/google-drive-oauth-store";

/**
 * 사용자가 명시적으로 "연결 해제"를 눌렀을 때만 호출된다 (2026-08-20 신규). 로컬 비밀파일의
 * refresh token만 지운다 — 기존에 Drive에 올라간 이미지 파일이나 Google Sheets의 이미지
 * URL은 전혀 건드리지 않는다.
 */
export const runtime = "nodejs";

export async function POST() {
  await clearLocalRefreshToken();
  const envStillSet = hasEnvRefreshToken();
  return NextResponse.json({
    success: true,
    note: envStillSet
      ? "GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN 환경변수가 설정되어 있어 이 값은 계속 사용됩니다. 완전히 해제하려면 배포 환경변수에서 직접 제거해주세요."
      : undefined,
  });
}
