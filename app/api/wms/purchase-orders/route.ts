import { NextResponse } from "next/server";
import { isWmsGoogleSheetsConfigured } from "@/lib/wms/google-sheets";
import { fetchPurchaseOrderView } from "@/lib/wms/purchase-orders";

/**
 * NOID WMS 전용 읽기 전용 API. 기존 app/api/google-sheet, app/api/coupang-data와
 * 완전히 분리되어 있으며, 이 라우트에는 GET만 존재한다 (POST/PUT/DELETE 없음 = 쓰기 불가).
 */
export const runtime = "nodejs";
// 환경변수(서비스 계정 설정 여부)를 요청마다 다시 확인해야 하므로 정적 최적화를 막는다.
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isWmsGoogleSheetsConfigured()) {
    return NextResponse.json({ configured: false, items: [] });
  }
  try {
    const items = await fetchPurchaseOrderView();
    return NextResponse.json({ configured: true, items });
  } catch (error) {
    return NextResponse.json(
      {
        configured: true,
        items: [],
        error: error instanceof Error ? error.message : "구글시트 조회 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}
