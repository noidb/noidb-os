import { NextRequest, NextResponse } from "next/server";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { mutateWeeklyWorkspace, readWeeklyWorkspace } from "@/lib/wms/weekly-work-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const ROUTINE_IDS = new Set(["new-orders", "receipts", "supply-status", "sheet-cleanup", "wims"]);

/** 작업센터 '매일 할 일'(2026-10-21): 항목별 마지막 완료 시각을 저장·조회한다. 회사·집·모바일에서 같은 값을 본다. */
export async function GET() {
  try {
    const workspace = await readWeeklyWorkspace();
    return NextResponse.json({ ok: true, doneAt: workspace.dailyRoutineDoneAt || {} }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "매일 할 일 기록을 읽지 못했습니다." }, { status: 500, headers });
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({ ok: false, error: "사이트 화면에서 다시 진행해 주세요." }, { status: 403, headers });
  try {
    const body = await request.json() as { id?: unknown; done?: unknown };
    const id = typeof body.id === "string" ? body.id : "";
    if (!ROUTINE_IDS.has(id)) throw new Error("항목을 확인해 주세요.");
    const doneAt = await mutateWeeklyWorkspace(workspace => {
      const next = { ...(workspace.dailyRoutineDoneAt || {}) };
      if (body.done === false) delete next[id]; else next[id] = new Date().toISOString();
      workspace.dailyRoutineDoneAt = next;
      return next;
    });
    return NextResponse.json({ ok: true, doneAt }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "저장하지 못했습니다." }, { status: 400, headers });
  }
}
