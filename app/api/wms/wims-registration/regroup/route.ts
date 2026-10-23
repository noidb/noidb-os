import { NextRequest, NextResponse } from "next/server";
import { regroupApprovalPendingModels } from "@/lib/wms/wims-registration-audit";
import { hasNoidbActionSession, isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 제품DB에서 기존상품승인대기 옵션 아래로 같은 모델의 다른 옵션 줄을 붙인다(줄 위치만 이동, 내용 변경 없음). */
export async function POST(request: NextRequest) {
  try {
    if (!isSameOriginActionRequest(request) || !hasNoidbActionSession(request)) return NextResponse.json({ error: "관리자 잠금 해제가 필요합니다." }, { status: 401 });
    return NextResponse.json(await regroupApprovalPendingModels());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "모델별 정렬에 실패했습니다." }, { status: 409 });
  }
}
