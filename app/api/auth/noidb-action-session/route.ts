import { NextRequest, NextResponse } from "next/server";
import {
  createNoidbActionSession,
  hasNoidbActionSession,
  isNoidbActionAuthConfigured,
  isSameOriginActionRequest,
  NOIDB_ACTION_SESSION_COOKIE,
  NOIDB_ACTION_SESSION_MAX_AGE_SECONDS,
  verifyNoidbActionCode,
} from "@/lib/wms/noidb-action-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    configured: isNoidbActionAuthConfigured(),
    authenticated: hasNoidbActionSession(request),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) {
    return NextResponse.json({ error: "같은 사이트에서만 관리자 잠금을 해제할 수 있습니다." }, { status: 403 });
  }
  if (!isNoidbActionAuthConfigured()) {
    return NextResponse.json({ error: "NOID-B 관리자 연동번호가 서버에 설정되지 않았습니다." }, { status: 503 });
  }
  let code = "";
  try {
    const body = await request.json();
    code = typeof body?.code === "string" ? body.code.trim() : "";
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  if (!verifyNoidbActionCode(code)) {
    return NextResponse.json({ error: "관리자 연동번호가 올바르지 않습니다." }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true, authenticated: true });
  response.cookies.set(
    NOIDB_ACTION_SESSION_COOKIE,
    createNoidbActionSession(),
    cookieOptions(NOIDB_ACTION_SESSION_MAX_AGE_SECONDS),
  );
  return response;
}
