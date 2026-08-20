import { NextResponse } from "next/server";
import {
  buildSupplyStatusPreview,
  ApprovedStatusNotFoundError,
  ProductDbHeaderMissingError,
} from "@/lib/wms/supply-status-update";

/**
 * 상품공급상태 업데이트 — 읽기 전용 미리보기 (2026-08-20 신규). 아무것도 쓰지 않는다.
 */
export const runtime = "nodejs";

export async function GET() {
  try {
    const preview = await buildSupplyStatusPreview();
    if (!preview.fileFound) {
      return NextResponse.json(
        { error: "상품공급상태관리 다운로드 폴더에서 사용할 수 있는 엑셀 파일을 찾지 못했습니다." },
        { status: 404 }
      );
    }
    return NextResponse.json(preview);
  } catch (error) {
    if (error instanceof ApprovedStatusNotFoundError || error instanceof ProductDbHeaderMissingError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "상품공급상태 미리보기 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
