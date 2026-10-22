import { NextRequest, NextResponse } from "next/server";
import { readDiscontinueCodeDraft, writeDiscontinueCodeDraft } from "@/lib/wms/discontinue-code-draft-store";
import { logDiscontinue } from "@/lib/wms/discontinue-log";
import { lookupCodesAnyTab } from "@/lib/wms/product-row-lookup";

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
    // 2026-10-22: 단종 신청 목록 입력칸에 새로 넣은 코드는 _WMS단종기록에 남긴다(목록을 비워도 기록은 남음).
    const before = new Set((await readDiscontinueCodeDraft().catch(() => ({ text: "" }))).text.split(/[\s,]+/).map(code => code.trim()).filter(Boolean));
    const saved = await writeDiscontinueCodeDraft(text);
    const added = [...new Set(text.split(/[\s,]+/).map(code => code.trim()).filter(code => code && !before.has(code)))];
    if (added.length) {
      const skuIds = await lookupCodesAnyTab(added).then(results => results.flatMap(result => result.matches.map(match => match.skuId))).catch(() => [] as string[]);
      // 입력 중인 일부 숫자가 기록되지 않도록, 탭에서 실제로 찾은 SKU만 남긴다.
      await logDiscontinue(skuIds, "단종 신청 목록 직접 입력");
    }
    return NextResponse.json({ ok: true, ...saved }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "단종 입력을 저장하지 못했습니다." }, { status: 500 });
  }
}
