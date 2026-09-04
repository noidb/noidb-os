import { NextResponse } from "next/server";
import { buildSupplyStatusAudit, ProductDbHeaderMissingError } from "@/lib/wms/supply-status-update";

export const runtime = "nodejs";

/** 읽기 전용 상품공급상태 진단. Google Sheet나 운영 파일을 수정하지 않는다. */
export async function GET() {
  try {
    const audit = await buildSupplyStatusAudit();
    if (!audit.fileFound) {
      return NextResponse.json(
        { error: "상품공급상태관리 다운로드 폴더에서 사용할 수 있는 엑셀 파일을 찾지 못했습니다." },
        { status: 404 }
      );
    }
    return NextResponse.json(audit);
  } catch (error) {
    if (error instanceof ProductDbHeaderMissingError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "상품공급상태 안전 진단 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
