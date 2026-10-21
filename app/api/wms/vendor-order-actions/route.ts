import { NextRequest, NextResponse } from "next/server";
import { readSavedStatusList } from "@/lib/wms/status-list-cache";
import { readWeeklyWorkspace } from "@/lib/wms/weekly-work-store";
import { readPickingWaveStore, mutatePickingWaveStore } from "@/lib/wms/picking-wave/server-store";
import { isVendorLineResolved } from "@/lib/wms/vendor-order/receiving-state";
import { appendDiscontinueCodes } from "@/lib/wms/discontinue-code-draft-store";
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
    // 2026-10-21 사용자 요청: 거래처 발주서의 '단종으로 이동'은 수시 처리 '단종 신청 목록'에 SKU를 모은다.
    // 이미 단종됐거나 처리한 SKU여도 막지 않고 발주서에서는 빼며, 목록에서 '빼기'로 지울 수 있다.
    if (body.action === "discontinue-list") {
      const skuId = String(body.skuId || "").trim();
      if (!/^\d+$/.test(skuId)) throw new Error("단종 신청 목록에 넣을 SKU ID를 확인해 주세요.");
      const { added } = await appendDiscontinueCodes([skuId]);
      if (!body.sourceLineId) return NextResponse.json({ success: true, added: added.length > 0 });
      const store = await readPickingWaveStore();
      const source = store.vendorOrderLines.find(line => line.id === body.sourceLineId);
      if (!source) throw new Error("단종 신청 목록에는 넣었지만 발주서 상품을 찾지 못했습니다. 새로고침해 주세요.");
      if (isVendorLineResolved(source)) return NextResponse.json({ success: true, line: source, added: added.length > 0 });
      const saved = await mutatePickingWaveStore({ action: "resolveSentVendorLine", lineId: source.id, expectedUpdatedAt: source.updatedAt, kind: "discontinue", destinationId: `discontinue-list:${skuId}`, now: new Date().toISOString() });
      return NextResponse.json({ success: true, added: added.length > 0, line: saved.vendorOrderLines.find(line => line.id === source.id) });
    }
    if (body.action === "queue-discontinue") {
      const store = body.sourceLineId ? await readPickingWaveStore() : null;
      const source = store?.vendorOrderLines.find(line => line.id === body.sourceLineId);
      if (source?.sentResolution?.kind === "discontinue") return NextResponse.json({ success: true, line: source, reused: true });
      if (body.sourceLineId && (!source || source.updatedAt !== body.expectedUpdatedAt || isVendorLineResolved(source) || store!.deletedVendorLineIds[source.id] || store!.deletedVendorDraftIds[source.draftId] || !store!.vendorOrderDrafts.some(d => d.id === source.draftId && d.status === "sent"))) throw new Error("단종으로 이동할 원본 발주서를 다시 확인해 주세요.");
      const record = await queueDiscontinueCandidate(source ? { ...body, skuId: source.skuId, purchaseOrderNumber: source.relatedPurchaseOrderNumbers.join(","), fallbackProductName: source.productName, fallbackOptionLabel: source.optionLabel } : body);
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
