import { NextRequest, NextResponse } from "next/server";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { routeLogisticsReceipt } from "@/lib/wms/logistics-receipt-routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!isSameOriginActionRequest(request)) return NextResponse.json({ ok: false, error: "입고결과 화면에서 다시 진행해 주세요." }, { status: 403, headers });
  try {
    const result = await routeLogisticsReceipt(await request.json());
    return NextResponse.json({ ok: true, ...result }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "상품을 이동하지 못했습니다." }, { status: 409, headers });
  }
}
