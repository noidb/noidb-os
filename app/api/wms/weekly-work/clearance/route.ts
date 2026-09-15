import { NextRequest, NextResponse } from "next/server";
import { fetchProductCatalog } from "@/lib/wms/product-catalog";
import { readPickingWaveStore } from "@/lib/wms/picking-wave/server-store";
import { readWeeklyWorkspace, mutateWeeklyWorkspace } from "@/lib/wms/weekly-work-store";
import { addWeeklyRun } from "@/lib/wms/weekly-work-state";
import { buildClearanceCouponSnapshot } from "@/lib/wms/clearance-coupons";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
async function snapshot() {
  const [store, catalog] = await Promise.all([readPickingWaveStore(), fetchProductCatalog()]);
  if (!catalog.configured) throw new Error("제품DB 연결을 확인해 주세요.");
  return buildClearanceCouponSnapshot(store.supplierHubInboundEvents || [], catalog.items);
}
function failure(error: unknown) {
  return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "과거청산 집계를 불러오지 못했습니다." }, { status: 409, headers });
}
export async function GET() {
  try {
    const [workspace, source] = await Promise.all([readWeeklyWorkspace(), snapshot()]);
    // Only the clone is reconciled: opening the screen does not save a review.
    const run = addWeeklyRun(structuredClone(workspace), source);
    return NextResponse.json({ success: true, ...workspace, run }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({ success: false, error: "과거청산 화면에서 다시 진행해 주세요." }, { status: 403 });
  try {
    const body = await request.json();
    const source = await snapshot();
    if (source.sourceToken !== body.sourceToken) throw new Error("입고내역이 변경됐습니다. 새로고침 후 집계를 확인해 주세요.");
    if (source.blockers.length) throw new Error(source.blockers.join(" "));
    const run = await mutateWeeklyWorkspace(workspace => addWeeklyRun(workspace, source));
    return NextResponse.json({ success: true, run }, { headers });
  } catch (error) { return failure(error); }
}
