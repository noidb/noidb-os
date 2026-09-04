import { NextResponse } from "next/server";
import {
  applySupplyStatusAudit,
  ProductDbHeaderMissingError,
  SupplyStatusPreviewChangedError,
} from "@/lib/wms/supply-status-update";

export const runtime = "nodejs";

const APPLY_CONFIRMATION = "안전한 상품공급상태 변경 반영";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (body?.confirmation !== APPLY_CONFIRMATION || typeof body?.dryRunToken !== "string") {
    return NextResponse.json({ applied: false, error: "명시적 승인 문자열과 최신 진단 토큰이 필요합니다." }, { status: 423 });
  }
  try {
    const result = await applySupplyStatusAudit(body.dryRunToken);
    if (!("applied" in result)) return NextResponse.json({ applied: false, error: "상품공급상태 파일을 찾지 못했습니다." }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SupplyStatusPreviewChangedError) {
      return NextResponse.json({ applied: false, error: error.message }, { status: 409 });
    }
    if (error instanceof ProductDbHeaderMissingError) {
      return NextResponse.json({ applied: false, error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { applied: false, error: error instanceof Error ? error.message : "안전 항목 반영에 실패했습니다." },
      { status: 500 }
    );
  }
}
