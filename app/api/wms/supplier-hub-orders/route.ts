import { NextResponse } from "next/server";
import { filterCurrentPurchaseOrders, loadSupplierHubPurchaseOrders } from "@/lib/wms/supplier-hub-orders";

/**
 * NOID WMS 서플라이어 허브 발주서 읽기 전용 API. 기존 app/api/wms/purchase-orders(구글시트 기반)와
 * 완전히 분리되어 있으며, lib/wms/data/incoming-purchase-orders/ 폴더의 엑셀 파일을 읽는다.
 * 이 라우트에는 GET만 존재한다 (POST/PUT/DELETE 없음 = 쓰기 불가).
 */
export const runtime = "nodejs";
// 폴더 안 파일 목록이 매 요청마다 바뀔 수 있으므로 정적 최적화를 막는다.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const orders = filterCurrentPurchaseOrders(await loadSupplierHubPurchaseOrders());
    return NextResponse.json({ orders });
  } catch (error) {
    return NextResponse.json(
      {
        orders: [],
        error: error instanceof Error ? error.message : "발주서 파일을 읽는 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}
