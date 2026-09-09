import { NextRequest, NextResponse } from "next/server";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { routeWeeklyItem } from "@/lib/wms/weekly-item-routing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({ success: false, error: "주간업무 화면에서 다시 진행해 주세요." }, { status: 403 });
  try {
    const body = await request.json();
    if (typeof body.runId !== "string" || typeof body.skuId !== "string" || !Number.isSafeInteger(body.expectedRevision)) throw new Error("최신 상품 선택을 확인해 주세요.");
    const run = await routeWeeklyItem(body.runId, body.expectedRevision, body.skuId, body.decision);
    return NextResponse.json({ success: true, run }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "상품을 이동하지 못했습니다." }, { status: 409 }); }
}
