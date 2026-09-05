import { NextRequest, NextResponse } from "next/server";
import {
  applyReceivingCost,
  completeStatusRequests,
  queueDiscontinueCandidate,
  queueStatusCandidate,
  listStatusFileGenerations,
  listReceivingDelaySummaries,
  listStatusRequests,
  recordReceivingDelay,
  recordStatusFileGeneration,
} from "@/lib/wms/vendor-order-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    if (request?.nextUrl.searchParams.get("scope") === "delays") return NextResponse.json({ success: true, delaySummaries: await listReceivingDelaySummaries() });
    const [statusRequests, delaySummaries, statusFileGenerations] = await Promise.all([listStatusRequests(), listReceivingDelaySummaries(), listStatusFileGenerations()]);
    return NextResponse.json({ success: true, statusRequests, delaySummaries, statusFileGenerations });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "이력 조회에 실패했습니다." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (body.action === "status") return NextResponse.json({ success: false, error: "제품DB를 바로 바꾸는 단종 처리는 중단되었습니다. 먼저 단종·해제 대기에 추가해 주세요." }, { status: 400 });
    if (body.action === "queue-discontinue") {
      const record = await queueDiscontinueCandidate(body);
      return NextResponse.json({ success: true, record });
    }
    if (body.action === "queue-status") {
      const record = await queueStatusCandidate(body);
      return NextResponse.json({ success: true, record });
    }
    if (body.action === "complete-status") {
      const completedCount = await completeStatusRequests(Array.isArray(body.ids) ? body.ids : [], body.operator);
      return NextResponse.json({ success: true, completedCount });
    }
    if (body.action === "record-status-files") {
      const record = await recordStatusFileGeneration(body);
      return NextResponse.json({ success: true, record });
    }
    if (body.action === "delay") {
      const summary = await recordReceivingDelay(body);
      return NextResponse.json({ success: true, summary });
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
