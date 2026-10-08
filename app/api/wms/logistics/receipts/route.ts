import { NextResponse } from "next/server";
import asideBaseline from "@/lib/wms/logistics-aside-baseline.json";
import {
  buildLogisticsReceiptBoard,
  LOGISTICS_RECEIPT_EPOCH,
  LOGISTICS_RECEIPT_SINCE,
  fillSkuStatusesFromProductDb,
  logisticsTargetsFromSnapshot,
  mergeHubClosedSnapshot,
  needsProductDbStatusFill,
  type LogisticsAsideBaseline,
} from "@/lib/wms/logistics-receipts";
import { resetLogisticsReceiptHistory } from "@/lib/wms/logistics-receipt-reset";
import { fetchProductCatalog } from "@/lib/wms/product-catalog";
import { readPickingWaveStore } from "@/lib/wms/picking-wave/server-store";
import { openVendorOrdersBySku, type OpenVendorOrder } from "@/lib/wms/open-vendor-orders";
import { expandMarketingExclusions, MARKETING_PERMANENT_EXCLUDED_SKU_IDS } from "@/lib/wms/marketing-permanent-exclusions";
import { mutateWeeklyWorkspace, readWeeklyWorkspace } from "@/lib/wms/weekly-work-store";
import { activeMarketingExclusionKeys, logisticsFollowUpResponse } from "@/lib/wms/logistics-follow-up";
import { readWeeklyDiscontinueQueue } from "@/lib/wms/weekly-discontinue-queue";
import { previewFollowUpDiscontinue } from "@/lib/wms/logistics-discontinue-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0" };
// 쿠팡 쉽먼트 화면의 확장프로그램이 직접 보내고 받도록 허용(크롬 백그라운드가 중간에 꺼지는 문제 방지).
const supplierOrigin = "https://supplier.coupang.com";
function withCors(request: Request, init: Record<string, string> = headers): Record<string, string> {
  return request.headers.get("origin") === supplierOrigin
    ? { ...init, "Access-Control-Allow-Origin": supplierOrigin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" }
    : init;
}
export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: withCors(request, { "Access-Control-Max-Age": "600" }) });
}

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

type Catalog = Awaited<ReturnType<typeof fetchProductCatalog>>;
async function readCatalog(): Promise<Catalog | null> {
  try { const catalog = await fetchProductCatalog(); return catalog.configured ? catalog : null; } catch { return null; }
}

/** 쿠팡에서 공급상태가 조회되지 않은 SKU를 제품DB 발주가능상태로 한 번 채워 저장한다. */
async function fillMissingStatuses(workspace: Awaited<ReturnType<typeof readWeeklyWorkspace>>, catalog: Catalog | null) {
  if (!catalog || workspace.logisticsReceiptEpoch !== LOGISTICS_RECEIPT_EPOCH || !needsProductDbStatusFill(workspace.logisticsReceipts)) return workspace;
  const statusBySku = new Map(catalog.items.map(item => [item.skuId, item.orderableStatus]));
  const collectedAt = workspace.logisticsReceipts!.collectedAt;
  await mutateWeeklyWorkspace(next => {
    if (next.logisticsReceipts?.collectedAt === collectedAt && needsProductDbStatusFill(next.logisticsReceipts)) {
      fillSkuStatusesFromProductDb(next.logisticsReceipts, statusBySku, new Date().toISOString());
    }
  });
  return readWeeklyWorkspace();
}

/** 제품DB에서 화면에 표시할 값: 현재상태 과재고·단종, 누적입고 100개 이상. SKU별 표시 목록. */
const shownProductDbStatuses = ["과재고", "단종"];
const CUMULATIVE_INBOUND_BADGE = 100;
function productDbStatusBySku(catalog: Catalog | null, skuIds: Iterable<string>): Record<string, string[]> {
  if (!catalog) return {};
  const wanted = new Set(skuIds), result: Record<string, string[]> = {};
  for (const item of catalog.items) {
    if (!wanted.has(item.skuId)) continue;
    const badges: string[] = [];
    const status = shownProductDbStatuses.find(value => item.currentStatus.includes(value));
    if (status) badges.push(status);
    const inbound = Number(String(item.cumulativeInbound || "").replace(/,/g, ""));
    if (Number.isFinite(inbound) && inbound >= CUMULATIVE_INBOUND_BADGE) badges.push(`누적입고 ${inbound.toLocaleString("ko-KR")}`);
    if (badges.length) result[item.skuId] = badges;
  }
  return result;
}

/** 화면에서 상품을 알아보기 쉽게 제품DB 이미지·제품링크를 SKU별로 넘긴다. */
function productDbLooksBySku(catalog: Catalog | null, skuIds: Iterable<string>): Record<string, { imageUrl: string; productLink: string }> {
  if (!catalog) return {};
  const wanted = new Set(skuIds), result: Record<string, { imageUrl: string; productLink: string }> = {};
  for (const item of catalog.items) {
    if (wanted.has(item.skuId) && (item.imageUrl || item.productLink)) result[item.skuId] = { imageUrl: item.imageUrl || "", productLink: item.productLink || "" };
  }
  return result;
}

async function responseBoard() {
  const [stored, catalog, openOrders] = await Promise.all([readWeeklyWorkspace(), readCatalog(),
    readPickingWaveStore().then(openVendorOrdersBySku).catch(() => ({} as Record<string, OpenVendorOrder>))]);
  const workspace = activeSnapshot(await fillMissingStatuses(stored, catalog));
  const currentTargets = logisticsTargetsFromSnapshot(workspace.logisticsReceipts);
  // 무조건 제외(같은 모델 전체). 제품DB를 못 읽으면 지정 SKU만 뺀다.
  const exclusions = expandMarketingExclusions(catalog?.items || []);
  const base = baseline();
  const board = buildLogisticsReceiptBoard({
    targets: currentTargets,
    snapshot: workspace.logisticsReceipts,
    baseline: { ...base, excludedMarketingSkuIds: [...new Set([...base.excludedMarketingSkuIds, ...exclusions.skuIds])] },
    routes: workspace.logisticsReceiptRoutes,
    excludedMarketingLineKeys: [...activeMarketingExclusionKeys(workspace)],
  });
  const followUp = logisticsFollowUpResponse(workspace, board);
  const source = await readWeeklyDiscontinueQueue();
  followUp.queues.discontinue.push(...previewFollowUpDiscontinue(source).map(row => ({ lineKey: `status::${row.requestId}`, sourceLineKey: row.requestId, shipmentNumber: "", boxId: "", purchaseOrderNumber: row.purchaseOrderNumber, skuId: row.skuId, productName: row.productName, barcode: "", kind: "shortage" as const, sourceFingerprint: row.requestId, state: "ready" as const })));
  const shownSkuIds = [...board.lines.map(line => line.skuId), ...(board.unavailableSkus || []).map(item => item.skuId)];
  return { currentTargets, board, followUp, productDbStatuses: productDbStatusBySku(catalog, shownSkuIds), productDbLooks: productDbLooksBySku(catalog, shownSkuIds),
    supplyStatusChecks: stored.supplyStatusChecks || {},
    coveredByVendorOrder: stored.coveredByVendorOrder || {},
    openVendorOrders: Object.fromEntries(board.lines.filter(line => line.kind === "shortage" && openOrders[line.skuId]).map(line => [line.skuId, openOrders[line.skuId]])),
    marketingExclusion: { listedSkuCount: MARKETING_PERMANENT_EXCLUDED_SKU_IDS.length, models: exclusions.models, skuCount: exclusions.skuIds.size } };
}

/** Read-only: listing current dispatched and preserved Aside targets does not create business records. */
export async function GET(request: Request) {
  // 확장프로그램(설치된 0.9.8)은 이 주소를 그대로 부른다 → 시작 기준만 바로 알려 준다.
  // 사이트 화면은 ?view=board 로 무거운 목록 계산을 요청한다.
  if (new URL(request.url).searchParams.get("view") !== "board") {
    return NextResponse.json({ ok: true, status: "ready", source: "supplier-hub-shipments", schemaVersion: 3,
      collectionMode: "hub-closed", since: LOGISTICS_RECEIPT_SINCE, targets: [] }, { headers: withCors(request) });
  }
  try {
    const { currentTargets, board, followUp, productDbStatuses, productDbLooks, marketingExclusion, supplyStatusChecks, coveredByVendorOrder, openVendorOrders } = await responseBoard();
    return NextResponse.json({ ok: true, status: "ready", source: "supplier-hub-shipments", schemaVersion: 3,
      collectionMode: "hub-closed", since: LOGISTICS_RECEIPT_SINCE, targets: currentTargets, board, followUp, productDbStatuses, productDbLooks, marketingExclusion, supplyStatusChecks, coveredByVendorOrder, openVendorOrders }, { headers });
  } catch {
    return NextResponse.json({ ok: false, error: "쉽먼트 입고 수집 대상과 기록을 불러오지 못했습니다." }, { status: 500, headers });
  }
}

export async function POST(request: Request) {
  const responseHeaders = withCors(request);
  try {
    const body = await request.text();
    if (body.length > 4_000_000) return NextResponse.json({ ok: false, error: "한 번에 수집할 쉽먼트 자료가 너무 큽니다." }, { status: 413, headers: responseHeaders });
    const input = JSON.parse(body) as unknown;
    const snapshot = await mutateWeeklyWorkspace(workspace => {
      resetLogisticsReceiptHistory(workspace);
      workspace.logisticsReceipts = mergeHubClosedSnapshot(workspace.logisticsReceipts, input);
      return workspace.logisticsReceipts;
    });
    // 저장만 하고 바로 답한다. 화면은 새로고침 때 목록을 계산한다.
    return NextResponse.json({ ok: true, count: snapshot.shipments.length, collectedAt: snapshot.collectedAt }, { headers: responseHeaders });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "쉽먼트 수집 자료를 저장하지 못했습니다." }, { status: 400, headers: responseHeaders });
  }
}
