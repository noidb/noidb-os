import { NextRequest, NextResponse } from "next/server";
import {
  filterCurrentPurchaseOrders,
  loadSupplierHubPurchaseOrders,
  summarizeUpcomingInboundByDate,
} from "@/lib/wms/supplier-hub-orders";

/**
 * NOID WMS 서플라이어 허브 발주서 읽기 전용 API. 기존 app/api/wms/purchase-orders(구글시트 기반)와
 * 완전히 분리되어 있으며, lib/wms/data/incoming-purchase-orders/ 폴더의 엑셀 파일을 읽는다.
 * 이 라우트에는 GET만 존재한다 (POST/PUT/DELETE 없음 = 쓰기 불가).
 */
export const runtime = "nodejs";
// 폴더 안 파일 목록이 매 요청마다 바뀔 수 있으므로 정적 최적화를 막는다.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const allOrders = await loadSupplierHubPurchaseOrders();
    // 신규 작업 선택 화면은 오늘 이후 발주만 보여주되, 이미 만들어진 출고작업을 다시
    // 열 때는 입고예정일이 지난 원본도 반드시 조회할 수 있어야 한다.
    const includePast = request.nextUrl.searchParams.get("includePast") === "1";
    const orders = includePast ? allOrders : filterCurrentPurchaseOrders(allOrders);
    return NextResponse.json({ orders, upcomingInboundSummary: summarizeUpcomingInboundByDate(allOrders) });
  } catch (error) {
    return NextResponse.json(
      {
        orders: [],
        upcomingInboundSummary: [],
        error: error instanceof Error ? error.message : "발주서 파일을 읽는 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}
