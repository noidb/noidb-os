import { NextRequest, NextResponse } from "next/server";
import { readDiscontinueCodeDraft, writeDiscontinueCodeDraft } from "@/lib/wms/discontinue-code-draft-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...(await readDiscontinueCodeDraft()) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "저장해 둔 단종 입력을 읽지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { text?: unknown };
    const text = typeof body.text === "string" ? body.text : "";
    if (text.length > 200_000) return NextResponse.json({ ok: false, error: "입력이 너무 깁니다." }, { status: 400 });
    return NextResponse.json({ ok: true, ...(await writeDiscontinueCodeDraft(text)) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "단종 입력을 저장하지 못했습니다." }, { status: 500 });
  }
}
