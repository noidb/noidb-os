import { NextResponse } from "next/server";
import asideBaseline from "@/lib/wms/logistics-aside-baseline.json";
import { readInvoiceGroupStore } from "@/lib/wms/invoice-group/server-store";
import {
  buildLogisticsReceiptBoard,
  collectDispatchReceiptTargets,
  mergeLogisticsReceiptSnapshot,
  mergeLogisticsReceiptTargets,
  type LogisticsAsideBaseline,
} from "@/lib/wms/logistics-receipts";
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

async function targets() {
  const snapshot = await readInvoiceGroupStore();
  const currentBaseline = baseline();
  return mergeLogisticsReceiptTargets(collectDispatchReceiptTargets(snapshot.groups), currentBaseline.pendingTargets)
    .filter(target => !currentBaseline.closedShipmentNumbers.includes(target.shipmentNumber));
}

async function responseBoard() {
  const [workspace, currentTargets] = await Promise.all([readWeeklyWorkspace(), targets()]);
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
      targets: currentTargets, board, followUp }, { headers });
  } catch {
    return NextResponse.json({ ok: false, error: "쉽먼트 입고 수집 대상과 기록을 불러오지 못했습니다." }, { status: 500, headers });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.text();
    if (body.length > 2_000_000) return NextResponse.json({ ok: false, error: "한 번에 수집할 쉽먼트 자료가 너무 큽니다." }, { status: 413, headers });
    const input = JSON.parse(body) as unknown;
    const currentTargets = await targets();
    const snapshot = await mutateWeeklyWorkspace(workspace => {
      workspace.logisticsReceipts = mergeLogisticsReceiptSnapshot(workspace.logisticsReceipts, input, currentTargets);
      return workspace.logisticsReceipts;
    });
    const workspace = await readWeeklyWorkspace();
    const board = buildLogisticsReceiptBoard({
      targets: currentTargets,
      snapshot,
      baseline: baseline(),
      routes: workspace.logisticsReceiptRoutes,
      excludedMarketingLineKeys: [...activeMarketingExclusionKeys(workspace)],
    });
    return NextResponse.json({ ok: true, status: "ready", source: "supplier-hub-shipments", schemaVersion: 3,
      targets: currentTargets, board }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "쉽먼트 수집 자료를 저장하지 못했습니다." }, { status: 400, headers });
  }
}
