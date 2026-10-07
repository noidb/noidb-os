import { NextResponse } from "next/server";
import { buildSupplyStatusAudit } from "@/lib/wms/supply-status-update";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await buildSupplyStatusAudit(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "상품공급상태 안전 진단에 실패했습니다." }, { status: 500 });
  }
}
