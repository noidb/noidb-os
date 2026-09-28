import { NextRequest, NextResponse } from "next/server";
import { changeReregistrationExclusion, readReregistrationExclusions } from "@/lib/wms/reregistration-exclusions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ entries: await readReregistrationExclusions() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "재등록 제외 목록을 읽지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { modelName?: unknown; reason?: unknown };
    const modelName = typeof body.modelName === "string" ? body.modelName.trim() : "";
    const reason = body.reason === null ? null : typeof body.reason === "string" ? body.reason.trim() : "";
    if (!modelName || modelName.length > 100 || (reason !== null && (!reason || reason.length > 100))) {
      return NextResponse.json({ error: "모델명 또는 제외 사유가 올바르지 않습니다." }, { status: 400 });
    }
    return NextResponse.json({ entries: await changeReregistrationExclusion(modelName, reason) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "재등록 제외 상태를 저장하지 못했습니다." }, { status: 500 });
  }
}
