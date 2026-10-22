import { NextResponse } from "next/server";
import { readDiscontinueSentDates } from "@/lib/wms/discontinue-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 읽기 전용: SKU별로 처음 단종으로 보낸 날과 보낸 날 수(단종 신청 목록에 '이전에 보냄'으로 표시, 2026-10-22). */
export async function GET() {
  try { return NextResponse.json({ ok: true, sent: await readDiscontinueSentDates() }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "단종 기록을 읽지 못했습니다." }, { status: 500 }); }
}
