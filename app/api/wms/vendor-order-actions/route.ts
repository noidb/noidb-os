import { NextRequest, NextResponse } from "next/server";
import {
  applyReceivingCost,
  completeStatusRequests,
  createStatusRequest,
  listReceivingDelaySummaries,
  listStatusRequests,
  recordReceivingDelay,
} from "@/lib/wms/vendor-order-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [statusRequests, delaySummaries] = await Promise.all([listStatusRequests(), listReceivingDelaySummaries()]);
    return NextResponse.json({ success: true, statusRequests, delaySummaries });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "이력 조회에 실패했습니다." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (body.action === "status") {
      const record = await createStatusRequest(body);
      return NextResponse.json({ success: true, record });
    }
    if (body.action === "complete-status") {
      const completedCount = await completeStatusRequests(Array.isArray(body.ids) ? body.ids : [], body.operator);
      return NextResponse.json({ success: true, completedCount });
    }
    if (body.action === "delay") {
      await recordReceivingDelay(body);
      return NextResponse.json({ success: true });
    }
    if (body.action === "receiving-cost") {
      const result = await applyReceivingCost(body);
      return NextResponse.json({ success: true, ...result });
    }
    return NextResponse.json({ success: false, error: "지원하지 않는 작업입니다." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "요청 처리에 실패했습니다." }, { status: 400 });
  }
}
