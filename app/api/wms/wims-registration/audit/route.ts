import { NextResponse } from "next/server";
import { buildWimsRegistrationAudit } from "@/lib/wms/wims-registration-audit";
import type { WimsRegistrationRow } from "@/lib/wms/wims-registration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { rows?: WimsRegistrationRow[] };
    if (!Array.isArray(body.rows) || body.rows.length === 0 || body.rows.length > 1000) return NextResponse.json({ error: "WIMS 행은 1~1,000건이어야 합니다." }, { status: 400 });
    return NextResponse.json(await buildWimsRegistrationAudit(body.rows));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "WIMS 등록상태 대조에 실패했습니다." }, { status: 500 });
  }
}
