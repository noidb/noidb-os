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
import { knownClosedShipmentNumbers, resetLogisticsReceiptHistory } from "@/lib/wms/logistics-receipt-reset";
import { fetchProductCatalog } from "@/lib/wms/product-catalog";
import { getCachedPurchaseOrderIndex } from "@/lib/wms/purchase-order-source/index";
import { normalizeSkuId } from "@/lib/wms/sku-normalize";
import { readPickingWaveStore } from "@/lib/wms/picking-wave/server-store";
import { openVendorOrdersBySku } from "@/lib/wms/open-vendor-orders";
import { reconcileIncompleteVendorRoutes } from "@/lib/wms/logistics-receipt-routing";
import { buildStatusLists, lastClearedBatch } from "@/lib/wms/discontinue-lists";
import { loadReregistrationLookup } from "@/lib/wms/reregistration-lookup";
import { loadStatusSourceItems } from "@/lib/wms/status-list-sources";
import { expandMarketingExclusions, marketingExcludedListed, MARKETING_PERMANENT_EXCLUDED_SKU_IDS } from "@/lib/wms/marketing-permanent-exclusions";
import { mutateWeeklyWorkspace, readWeeklyWorkspace } from "@/lib/wms/weekly-work-store";
import { activeMarketingExclusionKeys, logisticsFollowUpResponse } from "@/lib/wms/logistics-follow-up";
import { readWeeklyDiscontinueQueue } from "@/lib/wms/weekly-discontinue-queue";
import { previewFollowUpDiscontinue } from "@/lib/wms/logistics-discontinue-adapter";
import { missedListReviewedView } from "@/lib/wms/missed-list-review";

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

/**
 * 2026-10-11 사용자 요청: 초도 1개 입고 후 이미 품절돼 쿠팡이 추가 발주를 낸 SKU는 쿠폰·광고가 필요 없다.
 * 마케팅 후보 줄마다, 그 입고예정일보다 뒤의 다른 발주서(저장된 쿠팡 발주서 목록)에 같은 SKU가 있으면 알려 준다.
 */
type StoredOrder = { purchaseOrderNumber: string; expectedDate: string; items: { productCode: string; orderedQuantity: number }[] };
function laterOrdersForMarketing(lines: readonly { lineKey: string; kind: string; skuId: string; purchaseOrderNumber: string; target: { expectedDate: string } }[], orders: readonly StoredOrder[]) {
  const bySku = new Map<string, { purchaseOrderNumber: string; expectedDate: string; quantity: number }[]>();
  for (const order of orders) for (const item of order.items || []) {
    const skuId = String(item.productCode || "").trim();
    if (!skuId || !(Number(item.orderedQuantity) > 0)) continue;
    const list = bySku.get(skuId) || [];
    list.push({ purchaseOrderNumber: String(order.purchaseOrderNumber), expectedDate: String(order.expectedDate || ""), quantity: Number(item.orderedQuantity) });
    bySku.set(skuId, list);
  }
  const result: Record<string, { orderCount: number; quantity: number; latestExpectedDate: string }> = {};
  for (const line of lines) {
    if (line.kind !== "marketing") continue;
    const since = line.target?.expectedDate || "";
    const later = (bySku.get(line.skuId) || []).filter(order => order.purchaseOrderNumber !== line.purchaseOrderNumber && (!since || order.expectedDate > since));
    if (!later.length) continue;
    const unique = new Map(later.map(order => [order.purchaseOrderNumber, order]));
    result[line.lineKey] = { orderCount: unique.size, quantity: [...unique.values()].reduce((sum, order) => sum + order.quantity, 0), latestExpectedDate: [...unique.values()].map(order => order.expectedDate).sort().at(-1) || "" };
  }
  return result;
}

async function responseBoard() {
  // 2026-10-21: 화면을 열 때 오래 걸려(거래처발주·단종관리가 빈 화면처럼 보임) 서로 상관없는 읽기는 처음에 함께 시작한다.
  const indexPromise = getCachedPurchaseOrderIndex().catch(() => null);
  const discontinueQueuePromise = readWeeklyDiscontinueQueue();
  discontinueQueuePromise.catch(() => {});
  const [firstRead, catalog, vendorStore, rereg] = await Promise.all([readWeeklyWorkspace(), readCatalog(), readPickingWaveStore().catch(() => null), loadReregistrationLookup()]);
  const statusSource = catalog ? await loadStatusSourceItems(catalog.items) : null;
  const openOrders = vendorStore ? openVendorOrdersBySku(vendorStore) : {};
  // 끊긴 거래처발주 예약 정리(실제 발주서에 있으면 완료, 없으면 예약 삭제)
  let stored = firstRead;
  if (vendorStore && reconcileIncompleteVendorRoutes(structuredClone(firstRead), vendorStore) > 0) {
    await mutateWeeklyWorkspace(workspace => { reconcileIncompleteVendorRoutes(workspace, vendorStore); });
    stored = await readWeeklyWorkspace();
  }
  const workspace = activeSnapshot(await fillMissingStatuses(stored, catalog));
  const currentTargets = logisticsTargetsFromSnapshot(workspace.logisticsReceipts);
  // 무조건 제외(같은 모델 전체). 제품DB를 못 읽으면 지정 SKU만 뺀다.
  const exclusions = expandMarketingExclusions(catalog?.items || [], marketingExcludedListed(workspace.marketingExcludedSkuIds));
  const base = baseline();
  const board = buildLogisticsReceiptBoard({
    targets: currentTargets,
    snapshot: workspace.logisticsReceipts,
    baseline: { ...base, excludedMarketingSkuIds: [...new Set([...base.excludedMarketingSkuIds, ...exclusions.skuIds])] },
    routes: workspace.logisticsReceiptRoutes,
    excludedMarketingLineKeys: [...activeMarketingExclusionKeys(workspace)],
  });
  const followUp = logisticsFollowUpResponse(workspace, board);
  const source = await discontinueQueuePromise;
  followUp.queues.discontinue.push(...previewFollowUpDiscontinue(source).map(row => ({ lineKey: `status::${row.requestId}`, sourceLineKey: row.requestId, shipmentNumber: "", boxId: "", purchaseOrderNumber: row.purchaseOrderNumber, skuId: row.skuId, productName: row.productName, barcode: "", kind: "shortage" as const, sourceFingerprint: row.requestId, state: "ready" as const })));
  const shownSkuIds = [...board.lines.map(line => line.skuId), ...(board.unavailableSkus || []).map(item => item.skuId)];
  // 2026-10-11 사용자 요청: 마케팅 SKU에 발주상태(제품DB 발주가능상태, 없으면 쿠팡 조회값)를 보여 실수 단종을 찾는다.
  const orderStatuses: Record<string, string> = {};
  for (const status of workspace.logisticsReceipts?.skuStatuses || []) if (status.orderStatus) orderStatuses[status.skuId] = status.orderStatus;
  const marketingSkuIds = new Set(board.lines.filter(line => line.kind === "marketing").map(line => line.skuId));
  // 2026-10-21: 미납 SKU 리스트도 지금 발주가능상태로 단종 여부를 가린다(거래처발주로 보낸 뒤 단종된 SKU 등).
  const statusSkuIds = new Set([...marketingSkuIds, ...board.lines.filter(line => line.kind === "shortage" && line.skuId).map(line => line.skuId)]);
  for (const item of catalog?.items || []) if (statusSkuIds.has(item.skuId) && item.orderableStatus?.trim()) orderStatuses[item.skuId] = item.orderableStatus.trim();
  for (const key of Object.keys(orderStatuses)) if (!statusSkuIds.has(key)) delete orderStatuses[key];
  // 2026-10-11 사용자 요청: 마케팅 SKU에도 원발주서 매입가(공급가 > 매입가, 부가세 포함 단가)를 보여 준다. 못 읽으면 표시만 빠진다.
  // 그 발주의 원발주서가 폴더에 없으면 같은 SKU의 가장 최근 원발주서 매입가로 채우고 표시를 구분한다(2026-10-11 사용자 확정).
  const marketingPrices: Record<string, { price: number; fromOtherOrder?: boolean }> = {};
  try {
    const marketingRows = board.lines.filter(line => line.kind === "marketing");
    if (marketingRows.length) {
      const index = await indexPromise;
      if (!index) throw new Error("원발주서 색인 없음");
      const latestBySku = new Map<string, { price: number; date: string }>();
      for (const document of index.byPurchaseOrderNumber.values()) for (const record of document.records) {
        if (!record.unitPrice) continue;
        const skuId = record.skuId.trim(), previous = latestBySku.get(skuId);
        if (!previous || (document.expectedArrivalDate || "") >= previous.date) latestBySku.set(skuId, { price: record.unitPrice, date: document.expectedArrivalDate || "" });
      }
      for (const line of marketingRows) {
        const document = index.byPurchaseOrderNumber.get(normalizeSkuId(line.purchaseOrderNumber));
        const price = document?.records.find(record => record.skuId.trim() === line.skuId)?.unitPrice;
        if (price) marketingPrices[line.lineKey] = { price };
        else if (latestBySku.has(line.skuId)) marketingPrices[line.lineKey] = { price: latestBySku.get(line.skuId)!.price, fromOtherOrder: true };
      }
    }
  } catch { /* 원발주서를 못 읽어도 화면은 그대로 */ }
  // 2026-10-11 사용자 요청: 제외 이력 등 화면에 SKU만 보이는 곳의 상품명 — 제품DB, 보관·창고재확인 등 상태 탭, 재등록 탭, 가져온 쉽먼트 순으로 찾는다.
  const wantedNames = new Set([...(followUp.exclusionHistory || []).map(item => item.skuId), ...(workspace.marketingExcludedSkuIds || []).map(item => item.skuId)]);
  const skuNames: Record<string, string> = {};
  const offerName = (skuId: string, name: string | undefined) => { if (wantedNames.has(skuId) && name?.trim() && !skuNames[skuId]) skuNames[skuId] = name.trim(); };
  for (const item of catalog?.items || []) offerName(item.skuId, [item.productName, item.optionLabel].filter(Boolean).join(", "));
  for (const item of statusSource?.items || []) offerName(item.skuId, [item.productName, item.optionLabel].filter(Boolean).join(", "));
  for (const [skuId, name] of Object.entries(rereg.names)) offerName(skuId, name);
  for (const shipment of workspace.logisticsReceipts?.shipments || []) for (const line of shipment.lines) offerName(line.skuId, line.productName);
  const laterOrders = laterOrdersForMarketing(board.lines, (vendorStore?.supplierHubPurchaseOrders || []) as StoredOrder[]);
  // 2026-10-15: '가져온 쉽먼트'에서 쉽먼트번호를 누르면 보여 줄 내역과 처음 가져온 시각.
  const receipts = workspace.logisticsReceipts;
  const shipmentDetails = Object.fromEntries((receipts?.shipments || []).map(shipment => [shipment.shipmentNumber, {
    firstSeenAt: receipts?.shipmentFirstSeenAt?.[shipment.shipmentNumber] || "",
    totalDelivered: shipment.totalDelivered, totalReceived: shipment.totalReceived,
    lines: shipment.lines.map(line => ({ purchaseOrderNumber: line.purchaseOrderNumber, skuId: line.skuId, productName: line.productName, deliveredQuantity: line.deliveredQuantity, receivedQuantity: line.receivedQuantity })),
  }]));
  return { shipmentDetails, currentTargets, board, followUp, laterOrders, orderStatuses, marketingPrices, skuNames, productDbStatuses: productDbStatusBySku(catalog, shownSkuIds), productDbLooks: productDbLooksBySku(catalog, shownSkuIds),
    supplyStatusChecks: stored.supplyStatusChecks || {},
    coveredByVendorOrder: stored.coveredByVendorOrder || {},
    reorderExcluded: stored.reorderExcluded || {},
    missedListReviewed: missedListReviewedView(stored),
    // 가장 최근에 한꺼번에 비운 묶음(되살리기 버튼용). 하나씩 지운 1건은 되살리기 대상으로 보지 않는다.
    statusListLastCleared: Object.fromEntries((["discontinue", "release"] as const).map(kind => {
      const batch = lastClearedBatch(stored.statusListCleared?.[kind]);
      // 비운 지 3일이 지나면 버튼을 숨긴다(계속 남아 있으면 헷갈림).
      const recent = batch && Date.now() - Date.parse(batch.at) < 3 * 24 * 60 * 60 * 1000;
      return [kind, batch && recent && batch.keys.length > 1 ? { at: batch.at, count: batch.keys.length } : null];
    })),
    statusListRequested: stored.statusListRequested || {},
    statusLists: statusSource ? buildStatusLists(statusSource.items, {
      releaseFromScreen: Object.fromEntries(Object.entries(stored.supplyStatusChecks || {}).filter(([, check]) => check.decision === "release" && !check.releasedListClearedAt)),
      cleared: stored.statusListCleared,
      nameFallback: { ...rereg.names, ...Object.fromEntries((stored.logisticsReceipts?.shipments || []).flatMap(shipment => shipment.lines.map(line => [line.skuId, line.productName]))) },
      reregisteredSkuIds: rereg.reregisteredSkuIds,
    }) : null,
    openVendorOrders: Object.fromEntries(board.lines.filter(line => line.kind === "shortage" && openOrders[line.skuId]).map(line => [line.skuId, openOrders[line.skuId]])),
    marketingExclusion: { listedSkuCount: MARKETING_PERMANENT_EXCLUDED_SKU_IDS.length, models: exclusions.models, skuCount: exclusions.skuIds.size, userSkus: workspace.marketingExcludedSkuIds || [] } };
}

/** Read-only: listing current dispatched and preserved Aside targets does not create business records. */
export async function GET(request: Request) {
  // 확장프로그램(설치된 0.9.8)은 이 주소를 그대로 부른다 → 시작 기준만 바로 알려 준다.
  // 사이트 화면은 ?view=board 로 무거운 목록 계산을 요청한다.
  if (new URL(request.url).searchParams.get("view") !== "board") {
    // 0.9.9(2026-10-11): 이미 받은 마감 쉽먼트 번호를 알려 줘, 확장이 새로 마감된 것만 상세를 열게 한다(마감은 다시 바뀌지 않음).
    // 0.9.8은 이 값을 모르고 예전처럼 전부 읽는다. 읽기에 실패하면 빈 목록 = 전부 읽기로 안전하게 돌아간다.
    let knownShipmentNumbers: string[] = [];
    try { knownShipmentNumbers = knownClosedShipmentNumbers(await readWeeklyWorkspace()); } catch { /* 전부 읽기 */ }
    return NextResponse.json({ ok: true, status: "ready", source: "supplier-hub-shipments", schemaVersion: 3,
      collectionMode: "hub-closed", since: LOGISTICS_RECEIPT_SINCE, targets: [], knownShipmentNumbers }, { headers: withCors(request) });
  }
  try {
    const { shipmentDetails, currentTargets, board, followUp, laterOrders, orderStatuses, marketingPrices, skuNames, productDbStatuses, productDbLooks, marketingExclusion, supplyStatusChecks, coveredByVendorOrder, reorderExcluded, missedListReviewed, openVendorOrders, statusLists, statusListLastCleared, statusListRequested } = await responseBoard();
    return NextResponse.json({ ok: true, status: "ready", source: "supplier-hub-shipments", schemaVersion: 3, shipmentDetails,
      collectionMode: "hub-closed", since: LOGISTICS_RECEIPT_SINCE, targets: currentTargets, board, followUp, laterOrders, orderStatuses, marketingPrices, skuNames, productDbStatuses, productDbLooks, marketingExclusion, supplyStatusChecks, coveredByVendorOrder, reorderExcluded, missedListReviewed, openVendorOrders, statusLists, statusListLastCleared, statusListRequested }, { headers });
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
