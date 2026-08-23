import { NextResponse } from "next/server";
import { applyClassificationBackfill, previewClassificationBackfill } from "@/lib/wms/product-classification-backfill";

export async function GET() {
  try { return NextResponse.json({ dryRun: true, ...(await previewClassificationBackfill()) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "자동보완 미리보기 실패" }, { status: 500 }); }
}
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body.confirm !== "APPLY_EMPTY_CLASSIFICATION_CELLS") return NextResponse.json({ error: "확인 문자열이 필요합니다." }, { status: 400 });
    return NextResponse.json({ dryRun: false, ...(await applyClassificationBackfill()) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "자동보완 적용 실패" }, { status: 500 }); }
}
