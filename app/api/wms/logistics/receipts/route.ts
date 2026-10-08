import { NextResponse } from "next/server";
import asideBaseline from "@/lib/wms/logistics-aside-baseline.json";
import {
  buildLogisticsReceiptBoard,
  LOGISTICS_RECEIPT_EPOCH,
  LOGISTICS_RECEIPT_SINCE,
  logisticsTargetsFromSnapshot,
  mergeHubClosedSnapshot,
  type LogisticsAsideBaseline,
} from "@/lib/wms/logistics-receipts";
import { resetLogisticsReceiptHistory } from "@/lib/wms/logistics-receipt-reset";
import { mutateWeeklyWorkspace, readWeeklyWorkspace } from "@/lib/wms/weekly-work-store";
import { activeMarketingExclusionKeys, logisticsFollowUpResponse } from "@/lib/wms/logistics-follow-up";
import { readWeeklyDiscontinueQueue } from "@/lib/wms/weekly-discontinue-queue";
import { previewFollowUpDiscontinue } from "@/lib/wms/logistics-discontinue-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0" };

function baseline(): LogisticsAsideBaseline {
  const raw = asideBaseline as typeof asideBaseline & { source?: unknown; sources?: unknown };
  return {
    closedShipmentNumbers: raw.closedShipmentNumbers,
    pendingTargets: raw.pendingTargets as unknown as LogisticsAsideBaseline["pendingTargets"],
    completedMarketingSkuIds: raw.completedMarketingSkuIds as unknown as string[],
    excludedMarketingSkuIds: raw.excludedMarketingSkuIds as unknown as string[],
    handledLines: raw.handledLines as unknown as LogisticsAsideBaseline["handledLines"],
    source: raw.source ?? raw.sources ?? {},
  };
}

/** 이전 기준의 처리기록은 화면에 보이지 않게 한다(실제 삭제는 첫 쿠팡 목록 수집 저장 때). */
function activeSnapshot(workspace: Awaited<ReturnType<typeof readWeeklyWorkspace>>) {
  return workspace.logisticsReceiptEpoch === LOGISTICS_RECEIPT_EPOCH ? workspace : { ...workspace, runs: [], logisticsReceipts: undefined, logisticsReceiptRoutes: undefined, logisticsFollowUp: undefined };
}

async function responseBoard() {
  const workspace = activeSnapshot(await readWeeklyWorkspace());
  const currentTargets = logisticsTargetsFromSnapshot(workspace.logisticsReceipts);
  const board = buildLogisticsReceiptBoard({
    targets: currentTargets,
    snapshot: workspace.logisticsReceipts,
    baseline: baseline(),
    routes: workspace.logisticsReceiptRoutes,
    excludedMarketingLineKeys: [...activeMarketingExclusionKeys(workspace)],
  });
  const followUp = logisticsFollowUpResponse(workspace, board);
  const source = await readWeeklyDiscontinueQueue();
  followUp.queues.discontinue.push(...previewFollowUpDiscontinue(source).map(row => ({ lineKey: `status::${row.requestId}`, sourceLineKey: row.requestId, shipmentNumber: "", boxId: "", purchaseOrderNumber: row.purchaseOrderNumber, skuId: row.skuId, productName: row.productName, barcode: "", kind: "shortage" as const, sourceFingerprint: row.requestId, state: "ready" as const })));
  return { currentTargets, board, followUp };
}

/** Read-only: listing current dispatched and preserved Aside targets does not create business records. */
export async function GET() {
  try {
    const { currentTargets, board, followUp } = await responseBoard();
    return NextResponse.json({ ok: true, status: "ready", source: "supplier-hub-shipments", schemaVersion: 3,
      collectionMode: "hub-closed", since: LOGISTICS_RECEIPT_SINCE, targets: currentTargets, board, followUp }, { headers });
  } catch {
    return NextResponse.json({ ok: false, error: "쉽먼트 입고 수집 대상과 기록을 불러오지 못했습니다." }, { status: 500, headers });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.text();
    if (body.length > 2_000_000) return NextResponse.json({ ok: false, error: "한 번에 수집할 쉽먼트 자료가 너무 큽니다." }, { status: 413, headers });
    const input = JSON.parse(body) as unknown;
    const snapshot = await mutateWeeklyWorkspace(workspace => {
      resetLogisticsReceiptHistory(workspace);
      workspace.logisticsReceipts = mergeHubClosedSnapshot(workspace.logisticsReceipts, input);
      return workspace.logisticsReceipts;
    });
    const currentTargets = logisticsTargetsFromSnapshot(snapshot);
    const workspace = await readWeeklyWorkspace();
    const board = buildLogisticsReceiptBoard({
      targets: currentTargets,
      snapshot,
      baseline: baseline(),
      routes: workspace.logisticsReceiptRoutes,
      excludedMarketingLineKeys: [...activeMarketingExclusionKeys(workspace)],
    });
    return NextResponse.json({ ok: true, status: "ready", source: "supplier-hub-shipments", schemaVersion: 3,
      collectionMode: "hub-closed", since: LOGISTICS_RECEIPT_SINCE, count: snapshot.shipments.length, targets: currentTargets, board }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "쉽먼트 수집 자료를 저장하지 못했습니다." }, { status: 400, headers });
  }
}
