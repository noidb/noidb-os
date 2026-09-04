import { NextResponse } from "next/server";
import { applyWimsRejectionDecision } from "@/lib/wms/wims-registration-audit";
import type { WimsRegistrationRow } from "@/lib/wms/wims-registration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { rows?: WimsRegistrationRow[]; dryRunToken?: string; sheetRowNumber?: number; decision?: string };
    if (!Array.isArray(body.rows) || body.rows.length === 0 || body.rows.length > 1000) return NextResponse.json({ error: "WIMS 행은 1~1,000건이어야 합니다." }, { status: 400 });
    if (!Number.isInteger(body.sheetRowNumber) || Number(body.sheetRowNumber) < 2) return NextResponse.json({ error: "제품DB 대상 행이 올바르지 않습니다." }, { status: 400 });
    return NextResponse.json(await applyWimsRejectionDecision(body.rows, String(body.dryRunToken || ""), Number(body.sheetRowNumber), String(body.decision || "")));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "반려 상태 변경에 실패했습니다." }, { status: 409 });
  }
}
