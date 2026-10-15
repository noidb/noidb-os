import { NextRequest, NextResponse } from "next/server";
import { normalizeWimsLastSnapshot, readWimsLastSnapshot, writeWimsLastSnapshot } from "@/lib/wms/wims-last-snapshot-store";

/** WIMS 마지막 가져온 결과. GET: 저장본 읽기만. POST: 방금 가져온 결과 저장(2026-10-15). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET() {
  try {
    return NextResponse.json({ ok: true, saved: await readWimsLastSnapshot() }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "저장된 WIMS 결과를 읽지 못했습니다." }, { status: 500, headers: noStoreHeaders });
  }
}

export async function POST(request: NextRequest) {
  try {
    const value = normalizeWimsLastSnapshot(await request.json().catch(() => null));
    if (!value) return NextResponse.json({ ok: false, error: "저장 요청 형식이 올바르지 않습니다." }, { status: 400, headers: noStoreHeaders });
    await writeWimsLastSnapshot(value);
    return NextResponse.json({ ok: true }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "WIMS 결과를 저장하지 못했습니다." }, { status: 500, headers: noStoreHeaders });
  }
}
