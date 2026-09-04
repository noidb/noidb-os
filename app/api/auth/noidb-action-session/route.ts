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

export async function GET(request: NextRequest) {
  return NextResponse.json({ configured: isNoidbActionAuthConfigured(), authenticated: hasNoidbActionSession(request) });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({ error: "같은 NOID-B 화면에서만 잠금을 해제할 수 있습니다." }, { status: 403 });
  if (!isNoidbActionAuthConfigured()) return NextResponse.json({ error: "관리자 연동번호가 서버에 설정되지 않았습니다." }, { status: 503 });
  const supplied = request.headers.get("x-noidb-action-code")?.trim() || "";
  if (!verifyNoidbActionCode(supplied)) return NextResponse.json({ error: "연동번호가 올바르지 않습니다." }, { status: 401 });

  const response = NextResponse.json({ authenticated: true });
  response.cookies.set({
    name: NOIDB_ACTION_SESSION_COOKIE,
    value: createNoidbActionSession(),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api",
    maxAge: NOIDB_ACTION_SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
