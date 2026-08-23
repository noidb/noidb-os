import { NextResponse } from "next/server";
import {
  applySupplyStatusUpdate,
  ApprovedStatusNotFoundError,
  ProductDbHeaderMissingError,
  SupplyStatusPreviewChangedError,
} from "@/lib/wms/supply-status-update";
/**
 * 복구 dry-run 승인 전에는 어떤 호출도 Google Sheet 쓰기로 이어지지 않는다.
 * 전체 백업과 상품 단위 원자 검증을 포함한 별도 승인 반영 경로가 준비될 때까지 잠근다.
 */
export const runtime = "nodejs";

const APPLY_CONFIRMATION = "상품공급상태 업데이트 승인";

export async function POST(request: Request) {
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
