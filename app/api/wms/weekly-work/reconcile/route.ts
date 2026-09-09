import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { readWeeklyWorkspace, mutateWeeklyWorkspace } from "@/lib/wms/weekly-work-store";
import { requireWeeklyRun } from "@/lib/wms/weekly-work-state";
import { readPickingWaveStore } from "@/lib/wms/picking-wave/server-store";
import { listStatusRequests } from "@/lib/wms/vendor-order-actions";
import { planExistingWeeklyRoutes, applyExistingWeeklyRoutes } from "@/lib/wms/weekly-existing-route-links";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({ success: false, error: "주간업무 화면에서 다시 확인해 주세요." }, { status: 403 });
  try {
    const body = await request.json();
    if (typeof body.runId !== "string" || !Number.isSafeInteger(body.expectedRevision) || typeof body.allowExistingSku !== "boolean") throw new Error("현재 업무와 대조 기준을 확인해 주세요.");
    const [workspace, snapshot, requests] = await Promise.all([readWeeklyWorkspace(), readPickingWaveStore(), listStatusRequests()]);
    const run = requireWeeklyRun(workspace, body.runId, body.expectedRevision);
    const links = planExistingWeeklyRoutes(run, snapshot, requests, body.allowExistingSku);
    const token = createHash("sha256").update(JSON.stringify({ run, snapshot, requests, links, allowExistingSku: body.allowExistingSku })).digest("hex");
    if (body.apply !== true) return NextResponse.json({ success: true, links, token, revision: run.revision });
    if (body.token !== token) throw new Error("도착 목록이 변경되었습니다. 이동 기록을 다시 대조해 주세요.");
    const updated = await mutateWeeklyWorkspace(current => applyExistingWeeklyRoutes(requireWeeklyRun(current, body.runId, body.expectedRevision), links, new Date().toISOString()));
    return NextResponse.json({ success: true, run: updated, linkedCount: links.length });
  } catch (error) { return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "이동 기록 연결 실패" }, { status: 409 }); }
}
