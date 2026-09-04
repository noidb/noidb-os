import { NextRequest, NextResponse } from "next/server";
import {
  applySupplyStatusUpdate,
  ApprovedStatusNotFoundError,
  ProductDbHeaderMissingError,
  SupplyStatusPreviewChangedError,
} from "@/lib/wms/supply-status-update";
import { hasNoidbActionSession, isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
/** 승인 문자열과 최신 dry-run 토큰이 모두 일치할 때만 반영한다.
 * 실제 쓰기 함수가 전체 백업, 대상 재검증, 중복·충돌 차단을 추가로 수행한다. */
export const runtime = "nodejs";

const APPLY_CONFIRMATION = "상품공급상태 업데이트 승인";

export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request) || !hasNoidbActionSession(request)) {
    return NextResponse.json({ applied: false, writtenCount: 0, error: "관리자 잠금 해제가 필요합니다." }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  if (body?.confirmation !== APPLY_CONFIRMATION || typeof body?.dryRunToken !== "string") {
    return NextResponse.json({ applied: false, writtenCount: 0, error: "명시적 승인 문자열과 최신 dry-run 토큰이 필요합니다." }, { status: 423 });
  }
  try {
    const result = await applySupplyStatusUpdate(body.dryRunToken);
    if (!("applied" in result)) return NextResponse.json({ error: "상품공급상태 파일을 찾지 못했습니다." }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SupplyStatusPreviewChangedError) return NextResponse.json({ applied: false, error: error.message }, { status: 409 });
    if (error instanceof ApprovedStatusNotFoundError || error instanceof ProductDbHeaderMissingError) {
      return NextResponse.json({ applied: false, error: error.message }, { status: 400 });
    }
    return NextResponse.json({ applied: false, error: error instanceof Error ? error.message : "상품공급상태 업데이트 실패" }, { status: 500 });
  }
}
