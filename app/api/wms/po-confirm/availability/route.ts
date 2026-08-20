import { NextRequest, NextResponse } from "next/server";
import { checkPoConfirmAvailability } from "@/lib/wms/po-confirm";

/**
 * 발주서번호별로 PO_FOR_CONFIRM 원본을 자동으로 찾을 수 있는지(프로젝트 폴더/실제 원본 보관
 * 폴더) 미리 확인하는 조회 전용 API — 아무 파일도 만들지 않는다. 화면이 이 결과로 "생성" 버튼과
 * "원본 업로드" 영역 중 무엇을 보여줄지 결정한다 (2026-08-19 5차 실사용 테스트 신규).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const poNumbers: string[] = Array.isArray(body.poNumbers) ? body.poNumbers.map((n: unknown) => String(n).trim()).filter(Boolean) : [];

    const results = await Promise.all(
      poNumbers.map(async poNumber => ({ poNumber, ...(await checkPoConfirmAvailability(poNumber)) }))
    );

    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "발주확정 원본 확인 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
