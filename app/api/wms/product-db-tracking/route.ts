import { NextRequest, NextResponse } from "next/server";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { syncProductDbTrackingSafely } from "@/lib/wms/product-db-tracking-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };

/** 제품DB 발주·입고 칸 자동 입력(2026-10-23). 신규발주서·입고결과 화면을 열 때 뒤에서 부른다. */
export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({ ok: false, error: "사이트 화면에서 다시 진행해 주세요." }, { status: 403, headers });
  const result = await syncProductDbTrackingSafely();
  return NextResponse.json({ ok: !result.startsWith("error:"), result }, { headers });
}
