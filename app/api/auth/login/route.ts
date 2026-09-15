import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  SessionConfigError,
  createSessionToken,
  sessionCookieOptions,
  verifySiteAccessPassword,
} from "@/lib/auth/session";

/**
 * 사이트 로그인 API. 이번 단계에서는 어떤 기존 업무 API도 이 세션을 요구하지 않는다 —
 * 로그인/쿠키 발급 기반만 만든다.
 */
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let password = "";
  try {
    const body = await request.json();
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ ok: false, error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  if (!password) {
    return NextResponse.json({ ok: false, error: "비밀번호를 입력해주세요." }, { status: 400 });
  }

  try {
    if (!verifySiteAccessPassword(password)) {
      return NextResponse.json({ ok: false, error: "비밀번호가 올바르지 않습니다." }, { status: 401 });
    }

    const token = createSessionToken();
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions(SESSION_MAX_AGE_SECONDS));
    return response;
  } catch (error) {
    if (error instanceof SessionConfigError) {
      return NextResponse.json(
        { ok: false, error: "서버에 로그인 기능이 아직 설정되지 않았습니다. 관리자에게 문의해주세요." },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: false, error: "로그인 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
