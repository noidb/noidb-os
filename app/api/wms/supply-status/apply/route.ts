import { NextResponse } from "next/server";
import {
  applySupplyStatusUpdate,
  ApprovedStatusNotFoundError,
  ProductDbHeaderMissingError,
} from "@/lib/wms/supply-status-update";

/**
 * 상품공급상태 업데이트 — 실제 반영 (2026-08-20 신규). 서버에서 매칭을 다시 계산해(클라이언트
 * 미리보기를 신뢰하지 않음) 안전 조건을 만족하는 행만 제품DB A열/H열에 쓴다. 대상이 0건이면
 * Google Sheets에 아무 요청도 보내지 않는다.
 */
export const runtime = "nodejs";

export async function POST() {
  try {
    const result = await applySupplyStatusUpdate();
    if (!("applied" in result)) {
      return NextResponse.json(
        { error: "상품공급상태관리 다운로드 폴더에서 사용할 수 있는 엑셀 파일을 찾지 못했습니다." },
        { status: 404 }
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApprovedStatusNotFoundError || error instanceof ProductDbHeaderMissingError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "상품공급상태 업데이트 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
