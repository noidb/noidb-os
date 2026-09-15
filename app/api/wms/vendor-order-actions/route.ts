import { NextRequest, NextResponse } from "next/server";
import { readSavedStatusList } from "@/lib/wms/status-list-cache";
import { readWeeklyWorkspace } from "@/lib/wms/weekly-work-store";
import { readPickingWaveStore, mutatePickingWaveStore } from "@/lib/wms/picking-wave/server-store";
import { isVendorLineResolved } from "@/lib/wms/vendor-order/receiving-state";
import {
  applyReceivingCost,
  completeStatusRequests,
  queueDiscontinueCandidate,
  queueStatusCandidate,
  listStatusFileGenerations,
  listReceivingDelaySummaries,
  listStatusRequests,
  recordReceivingDelay,
  recordStatusFileGeneration,
} from "@/lib/wms/vendor-order-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    if (request?.nextUrl.searchParams.get("scope") === "status") {
      const saved = await readSavedStatusList();
      const workspace = await readWeeklyWorkspace();
      const moved = new Set(Object.values(workspace.workTransfers || {}).filter(move => move.source === "status" && move.completed).map(move=>move.sourceId));
      const items = workspace.materialSnapshot?.vendorItems || workspace.runs.flatMap(run=>run.snapshot.vendorItems);
      return NextResponse.json({ success: true, statusRequests: saved.requests.filter(row=>!moved.has(row.id)), statusFileGenerations: saved.generations, catalogItems: items.map(item=>({skuId:item.skuId,imageUrl:item.imageUrl,currentStatus:item.discontinued?"단종":""})), savedAt:saved.at }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (request?.nextUrl.searchParams.get("scope") === "delays") return NextResponse.json({ success: true, delaySummaries: await listReceivingDelaySummaries() });
    const [statusRequests, delaySummaries, statusFileGenerations] = await Promise.all([listStatusRequests(), listReceivingDelaySummaries(), listStatusFileGenerations()]);
    return NextResponse.json({ success: true, statusRequests, delaySummaries, statusFileGenerations });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "이력 조회에 실패했습니다." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (body.action === "status") return NextResponse.json({ success: false, error: "제품DB를 바로 바꾸는 단종 처리는 중단되었습니다. 먼저 단종·해제 대기에 추가해 주세요." }, { status: 400 });
    if (body.action === "queue-discontinue") {
      const store = body.sourceLineId ? await readPickingWaveStore() : null;
      const source = store?.vendorOrderLines.find(line => line.id === body.sourceLineId);
      if (source?.sentResolution?.kind === "discontinue") return NextResponse.json({ success: true, line: source, reused: true });
      if (body.sourceLineId && (!source || source.updatedAt !== body.expectedUpdatedAt || isVendorLineResolved(source) || store!.deletedVendorLineIds[source.id] || store!.deletedVendorDraftIds[source.draftId] || !store!.vendorOrderDrafts.some(d => d.id === source.draftId && d.status === "sent"))) throw new Error("단종으로 이동할 원본 발주서를 다시 확인해 주세요.");
      const record = await queueDiscontinueCandidate(source ? { ...body, skuId: source.skuId, purchaseOrderNumber: source.relatedPurchaseOrderNumbers.join(",") } : body);
      const saved = source ? await mutatePickingWaveStore({ action: "resolveSentVendorLine", lineId: source.id, expectedUpdatedAt: source.updatedAt, kind: "discontinue", destinationId: record.id, now: new Date().toISOString() }) : null;
      return NextResponse.json({ success: true, record, line: saved?.vendorOrderLines.find(line => line.id === source!.id) });
    }
    if (body.action === "queue-status") {
      const record = await queueStatusCandidate(body);
      return NextResponse.json({ success: true, record });
    }
    if (body.action === "complete-status") {
      const completedCount = await completeStatusRequests(Array.isArray(body.ids) ? body.ids : [], body.operator);
      return NextResponse.json({ success: true, completedCount });
    }
    if (body.action === "record-status-files") {
      const record = await recordStatusFileGeneration(body);
      return NextResponse.json({ success: true, record });
    }
    if (body.action === "delay") {
      const summary = await recordReceivingDelay(body);
      return NextResponse.json({ success: true, summary });
    }
    if (body.action === "receiving-cost") {
      const result = await applyReceivingCost(body);
      return NextResponse.json({ success: true, ...result });
    }
    return NextResponse.json({ success: false, error: "지원하지 않는 작업입니다." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "요청 처리에 실패했습니다." }, { status: 400 });
  }
}
