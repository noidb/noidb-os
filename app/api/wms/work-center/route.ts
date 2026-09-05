import { NextRequest, NextResponse } from "next/server";
import { readPickingWaveStore, mutatePickingWaveStore } from "@/lib/wms/picking-wave/server-store";
import { buildWorkCenterOverview } from "@/lib/wms/work-center";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0" };

/** One read, compact projection; no localStorage migration, Drive scan or Sheet writes. */
export async function GET() {
  try { return NextResponse.json({ overview: buildWorkCenterOverview(await readPickingWaveStore()) }, { headers }); }
  catch { return NextResponse.json({ error: "저장된 출고작업을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요." }, { status: 503, headers }); }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({ error: "작업센터 화면에서 다시 선택해 주세요." }, { status: 403, headers });
  const input = await request.json().catch(() => null);
  if (!input || input.confirmed !== true || typeof input.waveId !== "string" || !input.waveId.trim()
    || !["active", "completed", "archived"].includes(input.status) || !(input.expectedUpdatedAt === null || typeof input.expectedUpdatedAt === "string")) {
    return NextResponse.json({ error: "변경할 출고작업과 상태를 확인해 주세요." }, { status: 400, headers });
  }
  try {
    const snapshot = await mutatePickingWaveStore({ action: "setOutboundWorkState", waveId: input.waveId, status: input.status, expectedUpdatedAt: input.expectedUpdatedAt, now: new Date().toISOString() });
    return NextResponse.json({ overview: buildWorkCenterOverview(snapshot) }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const safe = /^(다른 기기에서|미처리 피킹|저장된 출고작업)/.test(message);
    return NextResponse.json({ error: safe ? message : "상태를 저장하지 못했습니다. 다시 확인해 주세요." }, { status: safe ? 409 : 503, headers });
  }
}
