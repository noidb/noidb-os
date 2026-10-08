import { NextRequest, NextResponse } from "next/server";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { mutateWeeklyWorkspace } from "@/lib/wms/weekly-work-store";
import { logisticsTargetsFromSnapshot } from "@/lib/wms/logistics-receipts";
import { rerouteToReorder } from "@/lib/wms/logistics-receipt-routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/** 미납 줄을 재발주요청으로 넣거나(미분류), 잘못 보낸 분류를 재발주요청으로 바꾼다. */
export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({ ok: false, error: "사이트 화면에서 다시 진행해 주세요." }, { status: 403, headers });
  try {
    const body = await request.json() as { lineKey?: unknown; expectedCollectedAt?: unknown };
    if (typeof body.lineKey !== "string" || typeof body.expectedCollectedAt !== "string") throw new Error("처리할 상품을 확인해 주세요.");
    const input = { lineKey: body.lineKey, expectedCollectedAt: body.expectedCollectedAt };
    const result = await mutateWeeklyWorkspace(workspace => rerouteToReorder(workspace, logisticsTargetsFromSnapshot(workspace.logisticsReceipts), input));
    return NextResponse.json({ ok: true, ...result }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "재발주요청으로 바꾸지 못했습니다." }, { status: 409, headers });
  }
}
