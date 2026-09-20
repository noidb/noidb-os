import { NextRequest, NextResponse } from "next/server";
import { buildSupplyStatusAudit } from "@/lib/wms/supply-status-update";
import type { SupplyStatusTableCapture } from "@/lib/wms/supply-status-update";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function captureFromBody(body: unknown): SupplyStatusTableCapture | undefined {
  const capture = (body as { capture?: SupplyStatusTableCapture } | null)?.capture;
  return capture && Array.isArray(capture.headers) && Array.isArray(capture.rows) ? capture : undefined;
}

export async function GET() {
  try {
    return NextResponse.json(await buildSupplyStatusAudit(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "상품공급상태 안전 진단에 실패했습니다." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await buildSupplyStatusAudit(captureFromBody(body)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "상품공급상태 안전 진단에 실패했습니다." }, { status: 500 });
  }
}
