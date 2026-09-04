import { NextRequest, NextResponse } from "next/server";
import { applyWimsRegistrationAudit } from "@/lib/wms/wims-registration-audit";
import type { WimsRegistrationRow } from "@/lib/wms/wims-registration";
import { hasNoidbActionSession, isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    if (!isSameOriginActionRequest(request) || !hasNoidbActionSession(request)) return NextResponse.json({ error: "관리자 잠금 해제가 필요합니다." }, { status: 401 });
    const body = await request.json() as { rows?: WimsRegistrationRow[]; dryRunToken?: string; confirmation?: string };
    if (body.confirmation !== "WIMS 검수완료 상품 연결") return NextResponse.json({ error: "정확한 반영 확인 문구가 필요합니다." }, { status: 423 });
    if (!Array.isArray(body.rows) || body.rows.length === 0 || body.rows.length > 1000) return NextResponse.json({ error: "WIMS 행은 1~1,000건이어야 합니다." }, { status: 400 });
    return NextResponse.json(await applyWimsRegistrationAudit(body.rows, String(body.dryRunToken || "")));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "WIMS 검수완료 상품 연결에 실패했습니다." }, { status: 409 });
  }
}
