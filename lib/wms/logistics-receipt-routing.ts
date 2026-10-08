import { createHash } from "node:crypto";
import baselineData from "./logistics-aside-baseline.json";
import { buildLogisticsReceiptBoard, logisticsTargetsFromSnapshot, logisticsReceiptSourceFingerprint,
  type LogisticsAsideBaseline, type LogisticsReceiptBoardLine, type LogisticsReceiptRoute, type LogisticsReceiptTarget } from "./logistics-receipts";
import { readInvoiceGroupStore } from "./invoice-group/server-store";
import { mutateWeeklyWorkspace } from "./weekly-work-store";
import { mutatePickingWaveStore, readPickingWaveStore } from "./picking-wave/server-store";
import type { PickingWaveStoreSnapshot } from "./picking-wave/shared-store-types";
import { WEEKLY_RULES_VERSION, type WeeklyRun, type WeeklyWorkspace } from "./weekly-work-types";
import { UNASSIGNED_VENDOR_NAME, type VendorOrderDraftLine } from "./vendor-order/types";
import { fetchProductCatalog, type ProductCatalogItem } from "./product-catalog";
import { normalizeSkuId } from "./sku-normalize";

const baseline = baselineData as unknown as LogisticsAsideBaseline;
export type LogisticsReceiptDecision = LogisticsReceiptRoute["decision"];
export interface RouteLogisticsReceiptInput {
  lineKey: string;
  decision: LogisticsReceiptDecision;
  expectedCollectedAt: string;
  confirmMarketing?: boolean;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const receiptSourceFingerprint = logisticsReceiptSourceFingerprint;
export function logisticsRouteHref(decision: LogisticsReceiptDecision, runId: string) {
  return decision === "vendor" ? "/wms/vendor-orders/manage" : decision === "reorder" ? "/wms/inbound/reorder"
    : `/wms/inbound/weekly?runId=${encodeURIComponent(runId)}`;
}

function makeRun(line: LogisticsReceiptBoardLine, decision: LogisticsReceiptDecision, at: string): WeeklyRun {
  // 같은 줄을 지웠다가 다시 보내도 예전 '삭제된 줄' 번호와 겹치지 않도록 예약 시각을 넣는다(재시도는 기존 예약을 그대로 씀).
  const id = `LOGISTICS-${hash([line.lineKey, at]).slice(0, 24)}`;
  const quantity = decision === "marketing" ? 1 : line.remainingQuantity!;
  const vendorName = UNASSIGNED_VENDOR_NAME;
  const reviewDecision = decision === "vendor" ? "order" : decision === "marketing" ? "hold" : decision;
  return {
    id, revision: 0, updatedAt: at, sentVendors: {},
    logisticsReceiptLine: { lineKey: line.lineKey, shipmentNumber: line.shipmentNumber, boxId: line.boxId,
      purchaseOrderNumber: line.purchaseOrderNumber, skuId: line.skuId, deliveredQuantity: line.deliveredQuantity!,
      receivedQuantity: line.receivedQuantity!, shortageQuantity: quantity, handledQuantity: line.handledQuantity },
    snapshot: {
      id, rulesVersion: WEEKLY_RULES_VERSION, sourceToken: receiptSourceFingerprint(line), operationalToken: receiptSourceFingerprint(line), createdAt: at,
      period: { startDate: line.target.expectedDate, endDate: line.target.expectedDate },
      source: { files: [`쉽먼트 ${line.shipmentNumber} / 박스 ${line.boxId}`], latestActualDate: "", firstActualDate: "",
        eventCount: 0, duplicateCount: 0, selectedEventCount: 0, mode: "browser" },
      couponItems: decision === "marketing" ? [{ skuId: line.skuId, productName: line.productName, productLink: "" }] : [],
      vendorItems: decision === "marketing" ? [] : [{ skuId: line.skuId, productName: line.productName, productLink: "", vendorName,
        imageUrl: "", optionLabel: "", modelName: "", barcode: line.barcode, shortageQuantity: quantity,
        openOrderQuantity: 0, suggestedQuantity: quantity,
        // Legacy export arithmetic uses the remaining source quantity, not PO confirmed quantity.
        confirmedQuantity: quantity + line.receivedQuantity!, receivedQuantity: line.receivedQuantity!,
        shortageDetails: [{ purchaseOrderNumber: line.purchaseOrderNumber, confirmedQuantity: quantity + line.receivedQuantity!,
          receivedQuantity: line.receivedQuantity!, shortageQuantity: quantity }], relatedPurchaseOrderNumbers: [line.purchaseOrderNumber],
        issues: [], discontinued: false }],
      warnings: decision === "marketing" ? ["쉽먼트 수량 1개 후보를 사용자가 검토해 보냈습니다. 실제 입고일은 쉽먼트 조회시각과 다릅니다."] : [], blockers: [],
    },
    reviews: decision === "marketing" ? {} : { [line.skuId]: { skuId: line.skuId, vendorName, imageUrl: "", quantity,
      quantityConfirmed: true, decision: reviewDecision } },
    reviewedSkuIds: decision === "marketing" ? [] : [line.skuId],
    itemRoutes: decision === "marketing" ? {} : { [line.skuId]: { decision: reviewDecision, at, completed: decision !== "vendor" } },
  };
}

/** Pure reservation; retries keep the exact same source and cannot change destination. */
export function reserveLogisticsReceiptRoute(workspace: WeeklyWorkspace, targets: LogisticsReceiptTarget[], input: RouteLogisticsReceiptInput,
  initial: LogisticsAsideBaseline = baseline, at = new Date().toISOString()) {
  if (!input || typeof input.lineKey !== "string" || !["vendor", "discontinue", "reorder", "marketing"].includes(input.decision)) throw new Error("처리할 상품과 분류를 확인해 주세요.");
  if (!workspace.logisticsReceipts || input.expectedCollectedAt !== workspace.logisticsReceipts.collectedAt) throw new Error("입고결과가 바뀌었습니다. 새로고침 후 분류해 주세요.");
  const board = buildLogisticsReceiptBoard({ targets, snapshot: workspace.logisticsReceipts, baseline: initial });
  const line = board.lines.find(item => item.lineKey === input.lineKey);
  if (!line || !["ready", "review"].includes(line.state)) throw new Error("현재 처리할 수 있는 마감 상품이 아닙니다.");
  if (input.decision === "marketing") {
    if (workspace.logisticsFollowUp?.blockedMarketingSkuIds?.includes(line.skuId)) throw new Error("단종 분류된 SKU는 쿠폰·광고 후보로 다시 보낼 수 없습니다.");
    if (!line.firstArrivalCandidate || !input.confirmMarketing) throw new Error("누적 입고·기존 쿠폰/광고를 확인한 후보만 보내 주세요.");
    const other = Object.entries(workspace.logisticsReceiptRoutes || {}).find(([key, route]) => key !== input.lineKey && route.decision === "marketing"
      && workspace.runs.find(run => run.id === route.runId)?.snapshot.couponItems.some(item => item.skuId === line.skuId));
    if (other) throw new Error("이 SKU는 이미 쿠폰·광고 검토 목록에 있습니다.");
  } else if (line.kind !== "shortage" || line.state !== "ready" || !line.remainingQuantity || line.remainingQuantity <= 0) {
    throw new Error("확정된 미납수량이 있는 상품만 분류할 수 있습니다.");
  }
  const existing = workspace.logisticsReceiptRoutes?.[input.lineKey];
  const fingerprint = receiptSourceFingerprint(line);
  if (existing) {
    if (existing.decision !== input.decision) throw new Error("이미 다른 목록으로 보낸 상품입니다. 해당 목록에서 확인해 주세요.");
    if (existing.sourceFingerprint !== fingerprint) throw new Error("분류 이후 쉽먼트 수량이 바뀌었습니다. 연결된 업무를 확인해 주세요.");
    const run = workspace.runs.find(item => item.id === existing.runId);
    if (!run) throw new Error("분류 기록의 후속 업무를 찾지 못했습니다.");
    return { route: existing, run, line };
  }
  // An old PO-based review has no box identity; do not silently duplicate or consume it.
  if (input.decision !== "marketing" && workspace.runs.some(run => !run.logisticsReceiptLine && !run.logisticsReceiptLines?.length && run.snapshot.vendorItems.some(item =>
    item.skuId === line.skuId && item.relatedPurchaseOrderNumbers.includes(line.purchaseOrderNumber)))) {
    throw new Error("같은 발주·SKU의 기존 업무가 있습니다. 기존 처리 기록을 연결한 뒤 진행해 주세요.");
  }
  const run = makeRun(line, input.decision, at);
  if (workspace.runs.some(item => item.id === run.id)) throw new Error("동일 상품의 후속 업무가 이미 있습니다. 연결 기록을 확인해 주세요.");
  const route: LogisticsReceiptRoute = { decision: input.decision, runId: run.id, at, completed: input.decision !== "vendor",
    quantity: input.decision === "marketing" ? 1 : line.remainingQuantity!, sourceFingerprint: fingerprint };
  workspace.runs.push(run);
  workspace.logisticsReceiptRoutes = { ...workspace.logisticsReceiptRoutes, [line.lineKey]: route };
  if (input.decision === "discontinue") {
    const exclusions = [...(workspace.logisticsFollowUp?.exclusions || [])];
    for (const marketing of workspace.runs.filter(item => item.id !== run.id && item.logisticsReceiptLine?.skuId === line.skuId && item.snapshot.couponItems.length && !item.couponUploadedAt && !item.completedAt)) {
      const lineKey = marketing.logisticsReceiptLine!.lineKey;
      if (exclusions.some(item => item.lineKey === lineKey && !item.restoredAt)) continue;
      exclusions.push({ lineKey, sourceFingerprint: workspace.logisticsReceiptRoutes?.[lineKey]?.sourceFingerprint || "", skuId: line.skuId, at });
    }
    for (const candidate of board.lines.filter(item => item.kind === "marketing" && item.skuId === line.skuId)) {
      if (exclusions.some(item => item.lineKey === candidate.lineKey && !item.restoredAt)) continue;
      exclusions.push({ lineKey: candidate.lineKey, sourceFingerprint: receiptSourceFingerprint(candidate), skuId: line.skuId, at });
    }
    workspace.logisticsFollowUp = { ...workspace.logisticsFollowUp,
      exclusions,
      blockedMarketingSkuIds: [...new Set([...(workspace.logisticsFollowUp?.blockedMarketingSkuIds || []), line.skuId])].sort() };
  }
  return { route, run, line };
}

/** 제품DB에서 거래처·모델명·바코드·사진·옵션을 채운다. 거래처 카드에 들어갈 메모는 비워 둔다(쉽먼트 출처는 shipmentReceiptDetails에 남음). */
type CatalogRow = Pick<ProductCatalogItem, "skuId" | "vendorName" | "modelSku" | "modelName" | "category" | "optionLabel" | "productName" | "imageUrl" | "barcode" | "currentStock">;
function vendorLine(run: WeeklyRun, catalog?: CatalogRow): VendorOrderDraftLine {
  const item = run.snapshot.vendorItems[0];
  const vendorName = catalog?.vendorName.trim() || item.vendorName;
  return { id: `${run.id}::${item.skuId}`, draftId: `${run.id}::${vendorName}`, waveId: run.id,
    vendorName, skuId: item.skuId, modelName: catalog?.modelSku || catalog?.modelName || "", category: catalog?.category || "",
    optionLabel: catalog?.optionLabel || "", productName: catalog?.productName || item.productName,
    imageUrl: catalog?.imageUrl || "", barcode: catalog?.barcode || item.barcode, actualShortageQuantity: item.shortageQuantity, shortageQuantity: item.shortageQuantity,
    currentStock: catalog?.currentStock || "", relatedPurchaseOrderNumbers: item.relatedPurchaseOrderNumbers,
    memo: "", isManuallyAdded: true,
    sourceType: "actual-inbound-shortage", actualInboundDetails: item.shortageDetails,
    shipmentReceiptDetails: [run.logisticsReceiptLine!], createdAt: run.updatedAt, updatedAt: run.updatedAt };
}

/**
 * 이미 분류한 미납 줄을 '미납분 재발주요청'으로 바꾼다(실수로 단종·거래처발주·기존 발주 처리한 줄 바로잡기, 2026-10-08).
 * - 기존 발주로 처리: 그 기록을 지운다
 * - 단종: 아직 단종신청 파일을 만들거나 완료하지 않았을 때만 바꾼다
 * - 거래처발주: 분류 기록은 지우고 바꾼다. 거래처 발주서에 들어간 그 상품은 사용자가 발주서에서 직접 지워야 한다(안내 문구 반환)
 */
export function rerouteToReorder(workspace: WeeklyWorkspace, targets: LogisticsReceiptTarget[], input: { lineKey: string; expectedCollectedAt: string }, at = new Date().toISOString()) {
  let note = "";
  if (workspace.coveredByVendorOrder?.[input.lineKey]) {
    const covered = { ...workspace.coveredByVendorOrder };
    delete covered[input.lineKey];
    workspace.coveredByVendorOrder = covered;
  }
  const existing = workspace.logisticsReceiptRoutes?.[input.lineKey];
  if (existing) {
    if (existing.decision === "reorder") throw new Error("이미 재발주요청 목록에 있습니다.");
    if (existing.decision === "marketing") throw new Error("쿠폰·광고 줄은 바꿀 수 없습니다.");
    const run = workspace.runs.find(item => item.id === existing.runId);
    if (existing.decision === "discontinue") {
      const filed = workspace.logisticsFollowUp?.proofs?.some(proof => proof.kind === "discontinue" && proof.sourceKeys.includes(input.lineKey));
      if (run?.discontinueSubmittedAt || run?.completedAt || run?.discontinueSubmittedSkuIds?.length || filed) {
        throw new Error("이미 단종신청 파일을 만들었거나 신청을 마친 상품이라 바꿀 수 없습니다. 쿠팡 단종신청에서 먼저 빼 주세요.");
      }
    }
    if (existing.decision === "vendor") note = "거래처 발주서에 들어간 이 상품은 발주서에서 직접 지워 주세요.";
    const routes = { ...workspace.logisticsReceiptRoutes };
    delete routes[input.lineKey];
    workspace.logisticsReceiptRoutes = routes;
    workspace.runs = workspace.runs.filter(item => item.id !== existing.runId);
  }
  const reservation = reserveLogisticsReceiptRoute(workspace, targets, { lineKey: input.lineKey, decision: "reorder", expectedCollectedAt: input.expectedCollectedAt }, baseline, at);
  return { runId: reservation.run.id, note };
}

/**
 * 거래처발주는 ①분류 예약 ②거래처 발주서에 넣기 ③완료 표시 세 단계로 저장된다.
 * 중간에 저장이 끊기면 '완료 안 된 거래처발주 예약'이 남아, 줄은 계속 보이는데 다른 버튼은 막힌다(2026-10-08 실사용).
 * 실제 거래처 발주서에 들어가 있으면 완료로 고치고, 안 들어갔으면(2분 지난 예약) 예약을 지워 다시 고를 수 있게 한다.
 */
export function reconcileIncompleteVendorRoutes(workspace: WeeklyWorkspace, store: Pick<PickingWaveStoreSnapshot, "vendorOrderLines" | "deletedVendorLineIds" | "vendorQueueReceipts">, now = Date.now()): number {
  let changed = 0;
  for (const [lineKey, route] of Object.entries(workspace.logisticsReceiptRoutes || {})) {
    if (route.decision !== "vendor" || route.completed) continue;
    const placed = (store.vendorOrderLines || []).some(line => !store.deletedVendorLineIds?.[line.id] && !line.orderExclusion
      && line.shipmentReceiptDetails?.some(detail => detail.lineKey === lineKey));
    const receipt = store.vendorQueueReceipts?.[route.runId];
    const run = workspace.runs.find(item => item.id === route.runId);
    if (placed && receipt && run) {
      route.completed = true;
      const skuId = run.logisticsReceiptLine?.skuId;
      if (skuId && run.itemRoutes?.[skuId]) run.itemRoutes[skuId].completed = true;
      run.vendorQueueTransfers = [{ id: run.id, at: route.at, completed: true, queueId: receipt.queueId, lines: receipt.sourceLines }];
      run.revision++; run.updatedAt = new Date(now).toISOString();
      changed++;
    } else if (!placed && now - Date.parse(route.at) > 120_000) {
      const routes = { ...workspace.logisticsReceiptRoutes };
      delete routes[lineKey];
      workspace.logisticsReceiptRoutes = routes;
      workspace.runs = workspace.runs.filter(item => item.id !== route.runId);
      changed++;
    }
  }
  return changed;
}

const loadCatalogRow = async (skuId: string): Promise<CatalogRow | undefined> => {
  const catalog = await fetchProductCatalog().catch(() => ({ configured: false, items: [] as ProductCatalogItem[] }));
  return catalog.items.find(item => item.skuId === skuId);
};
const dependencies = { readInvoiceGroupStore, mutateWeeklyWorkspace, mutatePickingWaveStore, readPickingWaveStore, loadCatalogRow };
export async function routeLogisticsReceipt(input: RouteLogisticsReceiptInput, deps = dependencies) {
  const vendorStore = await (deps.readPickingWaveStore ? deps.readPickingWaveStore() : Promise.resolve(null)).catch(() => null);
  const reservation = await deps.mutateWeeklyWorkspace(workspace => {
    if (vendorStore) reconcileIncompleteVendorRoutes(workspace, vendorStore);
    return reserveLogisticsReceiptRoute(workspace, logisticsTargetsFromSnapshot(workspace.logisticsReceipts), input);
  });
  if (input.decision === "vendor" && !reservation.route.completed) {
    const source = vendorLine(reservation.run, deps.loadCatalogRow ? await deps.loadCatalogRow(reservation.line.skuId) : undefined);
    const store = await deps.mutatePickingWaveStore({ action: "consolidateVendorOrders", operationId: reservation.run.id, lines: [source], now: reservation.route.at });
    const receipt = store.vendorQueueReceipts?.[reservation.run.id];
    const placed = store.vendorOrderLines.filter(line => !store.deletedVendorLineIds[line.id] && line.shipmentReceiptDetails?.some(detail => detail.lineKey === input.lineKey));
    if (!receipt || !placed.some(line => !line.orderExclusion)) {
      // 발주서가 이 줄을 받지 않은 이유를 알려 준다.
      const sku = normalizeSkuId(reservation.line.skuId);
      const excluded = placed.find(line => line.orderExclusion)?.orderExclusion;
      const reason = excluded ? `${excluded.reason} 기록이 있어 거래처 발주에서 빠졌습니다`
        : store.suppressedVendorSkuIds?.[sku] ? "이 SKU는 거래처 발주에서 제외(과재고 등)로 지정돼 있습니다"
        : store.deletedVendorLineIds[source.id] ? "예전에 발주서에서 삭제한 줄과 겹쳤습니다"
        : store.vendorQueueConsumedLineIds?.[source.id] ? "이미 발주 처리된 줄입니다"
        : "발주서에 넣지 못했습니다";
      // 받지 않은 예약은 지워서 다른 버튼(단종·재발주요청·기존 발주로 처리)을 바로 고를 수 있게 한다.
      await deps.mutateWeeklyWorkspace(workspace => {
        const route = workspace.logisticsReceiptRoutes?.[input.lineKey];
        if (!route || route.completed || route.runId !== reservation.run.id) return;
        const routes = { ...workspace.logisticsReceiptRoutes };
        delete routes[input.lineKey];
        workspace.logisticsReceiptRoutes = routes;
        workspace.runs = workspace.runs.filter(item => item.id !== reservation.run.id);
      });
      throw new Error(`SKU ${reservation.line.skuId}: ${reason}. 단종·재발주요청·기존 발주로 처리 중에서 골라 주세요.`);
    }
    await deps.mutateWeeklyWorkspace(workspace => {
      const route = workspace.logisticsReceiptRoutes?.[input.lineKey];
      const run = workspace.runs.find(item => item.id === reservation.run.id);
      if (!route || !run || route.decision !== "vendor") throw new Error("거래처 이동 기록이 바뀌었습니다.");
      route.completed = true;
      run.itemRoutes![reservation.line.skuId].completed = true;
      run.vendorQueueTransfers = [{ id: run.id, at: route.at, completed: true, queueId: receipt.queueId, lines: [source] }];
      run.revision++; run.updatedAt = new Date().toISOString();
    });
  }
  return { runId: reservation.run.id, href: logisticsRouteHref(input.decision, reservation.run.id) };
}
