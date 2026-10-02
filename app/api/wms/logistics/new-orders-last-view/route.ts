import { NextRequest, NextResponse } from "next/server";
import { readNewOrdersLastView, writeNewOrdersLastView } from "@/lib/wms/new-orders-last-view-store";

/**
 * 신규 발주서 화면 "마지막으로 불러온 목록" 공유 API (2026-10-02 신규).
 * GET: 저장본을 읽기만 한다(발주서 파일 조회 없음). POST: 사용자가 방금 불러온 결과를 저장한다.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET() {
  try {
    return NextResponse.json({ ok: true, view: await readNewOrdersLastView() }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "저장된 발주서 목록을 읽지 못했습니다." }, { status: 500, headers: noStoreHeaders });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as { savedAt?: unknown; orders?: unknown; importResult?: unknown } | null;
    if (!body || typeof body.savedAt !== "string" || !Array.isArray(body.orders)) {
      return NextResponse.json({ ok: false, error: "저장 요청 형식이 올바르지 않습니다." }, { status: 400, headers: noStoreHeaders });
    }
    await writeNewOrdersLastView({ savedAt: body.savedAt, orders: body.orders, importResult: body.importResult ?? null });
    return NextResponse.json({ ok: true }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "발주서 목록을 저장하지 못했습니다." }, { status: 500, headers: noStoreHeaders });
  }
}
