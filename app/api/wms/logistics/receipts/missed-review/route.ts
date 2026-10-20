import { NextRequest, NextResponse } from "next/server";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { mutateWeeklyWorkspace } from "@/lib/wms/weekly-work-store";
import { hideReviewedMissedLines, undoLastMissedReview } from "@/lib/wms/missed-list-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/** 전체 미납 목록 '검토 완료로 정리'(hide) / '방금 정리한 것 되돌리기'(undo). 목록 표시만 바꾼다. */
export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({ ok: false, error: "사이트 화면에서 다시 진행해 주세요." }, { status: 403, headers });
  try {
    const body = await request.json() as { action?: unknown; lineKeys?: unknown };
    if (body.action === "undo") {
      const result = await mutateWeeklyWorkspace(workspace => undoLastMissedReview(workspace));
      return NextResponse.json({ ok: true, ...result }, { headers });
    }
    if (body.action !== "hide" || !Array.isArray(body.lineKeys)) throw new Error("정리할 줄을 확인해 주세요.");
    const lineKeys = body.lineKeys.filter((key): key is string => typeof key === "string");
    const result = await mutateWeeklyWorkspace(workspace => hideReviewedMissedLines(workspace, lineKeys));
    return NextResponse.json({ ok: true, ...result }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "목록을 정리하지 못했습니다." }, { status: 409, headers });
  }
}
