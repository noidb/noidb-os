import { NextRequest, NextResponse } from "next/server";
import { applySupplyStatusAudit, SupplyStatusPreviewChangedError } from "@/lib/wms/supply-status-update";
import type { SupplyStatusTableCapture } from "@/lib/wms/supply-status-update";
import { hasNoidbActionSession, isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request) || !hasNoidbActionSession(request)) {
    return NextResponse.json({ applied: false, error: "관리자 잠금 해제가 필요합니다." }, { status: 401 });
  }
  const body = await request.json().catch(() => ({})) as {
    confirmation?: string;
    dryRunToken?: string;
    capture?: SupplyStatusTableCapture;
  };
  if (body.confirmation !== "안전한 상품공급상태 변경 반영" || typeof body.dryRunToken !== "string") {
    return NextResponse.json({ applied: false, error: "명시적 승인 문구와 최신 안전 진단 토큰이 필요합니다." }, { status: 423 });
  }
  try {
    const capture = body.capture && Array.isArray(body.capture.headers) && Array.isArray(body.capture.rows) ? body.capture : undefined;
    const result = await applySupplyStatusAudit(body.dryRunToken, capture);
    if (!("audit" in result)) return NextResponse.json({ applied: false, error: "상품공급상태 원본을 찾지 못했습니다." }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SupplyStatusPreviewChangedError) return NextResponse.json({ applied: false, error: error.message }, { status: 409 });
    return NextResponse.json({ applied: false, error: error instanceof Error ? error.message : "상품공급상태 안전 반영에 실패했습니다." }, { status: 500 });
  }
}
