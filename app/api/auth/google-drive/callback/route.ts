import { NextRequest, NextResponse } from "next/server";
import { consumeOAuthState, exchangeCodeForRefreshToken } from "@/lib/wms/google-drive-oauth";

/**
 * Google OAuth 콜백 (2026-08-20 신규). authorization code를 refresh token으로 교환해
 * 로컬 비밀파일에 저장한다. 토큰 원문은 절대 이 응답의 HTML에 노출하지 않는다 — 성공/실패
 * 여부만 안내하는 화면을 직접 렌더링한다(별도 리디렉션 목적지가 없어도 되도록).
 */
export const runtime = "nodejs";

function resultPage(title: string, message: string, ok: boolean, retryHref?: string): NextResponse {
  const retryLink = retryHref
    ? `<a href="${retryHref}" class="action">Google Drive 다시 연결</a>`
    : "";
  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Malgun Gothic", sans-serif; background: #f5f1ea; color: #2c2c2c; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; box-sizing: border-box; }
  .card { background: #fff; border-radius: 16px; padding: 28px; max-width: 360px; text-align: center; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
  h1 { font-size: 17px; margin: 0 0 10px; color: ${ok ? "#2f6d4f" : "#b23b3b"}; }
  p { font-size: 13px; line-height: 1.6; color: #555; margin: 0; }
  .action { display: inline-flex; min-height: 44px; align-items: center; justify-content: center; margin-top: 18px; border-radius: 10px; background: #343a3d; color: #fff; padding: 0 16px; text-decoration: none; font-size: 13px; font-weight: 800; }
</style></head>
<body><div class="card"><h1>${ok ? "✅" : "❌"} ${title}</h1><p>${message}</p>${retryLink}</div></body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store, max-age=0" } });
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const errorParam = request.nextUrl.searchParams.get("error");

  if (errorParam) {
    return resultPage("Google Drive 연결 취소됨", "Google 동의 화면에서 연결을 취소하셨습니다. 다시 연결하려면 화면의 연결 버튼을 다시 눌러주세요.", false);
  }

  if (!consumeOAuthState(state)) {
    return resultPage(
      "Google Drive 연결 시간이 지났습니다",
      "기존 연결 요청이 만료되었습니다. 아래 버튼을 누르면 새 요청으로 바로 다시 시작합니다.",
      false,
      "/api/auth/google-drive/start?returnTo=/wms/settings/folder-connections"
    );
  }

  if (!code) {
    return resultPage("Google Drive 연결 실패", "Google로부터 인증 코드를 받지 못했습니다. 다시 시도해주세요.", false);
  }

  try {
    await exchangeCodeForRefreshToken(code);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "알 수 없는 오류";
    return resultPage("Google Drive 연결 실패", detail, false);
  }

  return resultPage("Google Drive 연결 완료", "noidb2017@gmail.com 계정으로 연결되었습니다. 이 창을 닫고 원래 화면으로 돌아가 다시 시도해주세요.", true);
}
