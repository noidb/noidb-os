import { NextRequest, NextResponse } from "next/server";
import { isDriveOAuthConfigured, buildAuthUrl, createOAuthState, getOAuthEnv } from "@/lib/wms/google-drive-oauth";

/**
 * Google OAuth 동의 화면으로 리디렉션한다 (2026-08-20 신규). 최초 연결은 반드시 집 PC의
 * localhost에서 진행한다 — Cloudflare Quick Tunnel 주소는 재실행마다 바뀌므로 redirect URI로
 * 쓰지 않는다(GOOGLE_DRIVE_OAUTH_REDIRECT_URI에 하드코딩된 값만 허용).
 *
 * 보안: 이 라우트를 호출하는 요청의 origin이 localhost이거나, 등록된 redirect URI와 같은
 * origin일 때만 허용한다 — 휴대폰이 Cloudflare Tunnel로 접속한 화면에서는 "연결" 버튼이
 * 눌려도 서버가 거부한다(휴대폰은 이미 연결된 refresh token으로 업로드만 하면 되고, 최초
 * 연결/재연결은 항상 localhost에서 하기 때문).
 */
export const runtime = "nodejs";

function isAllowedOrigin(request: NextRequest, redirectUri: string): boolean {
  const host = request.nextUrl.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") return true;
  try {
    const redirectHost = new URL(redirectUri).hostname.toLowerCase();
    return host === redirectHost;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  if (!isDriveOAuthConfigured()) {
    return NextResponse.json(
      { error: "Google Drive OAuth 설정이 없습니다. GOOGLE_DRIVE_OAUTH_CLIENT_ID / CLIENT_SECRET / REDIRECT_URI 환경변수를 먼저 등록해주세요." },
      { status: 400 }
    );
  }

  const env = getOAuthEnv()!;
  if (!isAllowedOrigin(request, env.redirectUri)) {
    return NextResponse.json(
      { error: "이 주소에서는 Google Drive 연결을 시작할 수 없습니다. localhost(집 PC 로컬 개발 서버)에서 연결해주세요." },
      { status: 403 }
    );
  }

  const state = createOAuthState();
  const authUrl = buildAuthUrl(state);
  const response = NextResponse.redirect(authUrl);
  // 브라우저/CDN이 예전 state가 들어간 OAuth 리디렉션을 재사용하지 않게 한다.
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}
