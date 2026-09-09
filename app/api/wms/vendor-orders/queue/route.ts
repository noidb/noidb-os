import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { readPickingWaveStore, mutatePickingWaveStore } from "@/lib/wms/picking-wave/server-store";
import { transferWeeklyVendorQueue } from "@/lib/wms/weekly-vendor-queue";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET() {
  try {
    const store = await readPickingWaveStore();
    return NextResponse.json({ success: true, queueId: store.activeVendorQueueId || null, consumedLineIds: Object.keys(store.vendorQueueConsumedLineIds || {}), deletedDraftIds: store.deletedVendorDraftIds, draftUpdatedAtById: Object.fromEntries(store.vendorOrderDrafts.map(draft => [draft.id, draft.updatedAt])) }, { headers });
  } catch (e) { return failure(e); }
}
export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({ success: false, error: "발주대기 화면에서 다시 진행해 주세요." }, { status: 403 });
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("발주대기 요청을 다시 확인해 주세요.");
    if (body.action === "saveLineImage") {
      const store = await mutatePickingWaveStore({ action: "saveVendorLineImage", lineId: body.lineId, imageUrl: body.imageUrl, expectedImageUrl: body.expectedImageUrl, now: new Date().toISOString() });
      return NextResponse.json({ success: true, line: store.vendorOrderLines.find(line => line.id === body.lineId) }, { headers });
    }
    if (body.action !== undefined) throw new Error("지원하지 않는 발주대기 요청입니다.");
    if (body.runId) {
      if (typeof body.runId !== "string" || !Number.isSafeInteger(body.expectedRevision)) throw new Error("주간 업무를 다시 확인해 주세요.");
      if (body.skuIds !== undefined && (!Array.isArray(body.skuIds) || body.skuIds.some((id: unknown) => typeof id !== "string"))) throw new Error("이동할 SKU 목록을 확인해 주세요.");
      return NextResponse.json({ success: true, ...await transferWeeklyVendorQueue(body.runId, body.expectedRevision, body.skuIds) }, { headers });
    }
    const operationId = randomUUID();
    const store = await mutatePickingWaveStore({ action: "consolidateVendorOrders", operationId, lines: [], now: new Date().toISOString() });
    const { queueId, added, duplicates } = store.vendorQueueReceipts![operationId];
    return NextResponse.json({ success: true, receipt: { queueId, added, duplicates } }, { headers });
  } catch (e) { return failure(e); }
}
function failure(e: unknown) { return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "발주대기를 취합하지 못했습니다." }, { status: 409, headers }); }
