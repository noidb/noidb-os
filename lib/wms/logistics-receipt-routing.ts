import { createHash } from "node:crypto";
import baselineData from "./logistics-aside-baseline.json";
import { buildLogisticsReceiptBoard, collectDispatchReceiptTargets, mergeLogisticsReceiptTargets, logisticsReceiptSourceFingerprint,
  type LogisticsAsideBaseline, type LogisticsReceiptBoardLine, type LogisticsReceiptRoute, type LogisticsReceiptTarget } from "./logistics-receipts";
import { readInvoiceGroupStore } from "./invoice-group/server-store";
import { mutateWeeklyWorkspace } from "./weekly-work-store";
import { mutatePickingWaveStore } from "./picking-wave/server-store";
import { WEEKLY_RULES_VERSION, type WeeklyRun, type WeeklyWorkspace } from "./weekly-work-types";
import { UNASSIGNED_VENDOR_NAME, type VendorOrderDraftLine } from "./vendor-order/types";

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
  const id = `LOGISTICS-${hash(line.lineKey).slice(0, 24)}`;
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

function vendorLine(run: WeeklyRun): VendorOrderDraftLine {
  const item = run.snapshot.vendorItems[0];
  return { id: `${run.id}::${item.skuId}`, draftId: `${run.id}::${item.vendorName}`, waveId: run.id,
    vendorName: item.vendorName, skuId: item.skuId, modelName: "", category: "", optionLabel: "", productName: item.productName,
    imageUrl: "", barcode: item.barcode, actualShortageQuantity: item.shortageQuantity, shortageQuantity: item.shortageQuantity,
    currentStock: "", relatedPurchaseOrderNumbers: item.relatedPurchaseOrderNumbers,
    memo: `쉽먼트 ${run.logisticsReceiptLine!.shipmentNumber} · 거래처/이미지/주문수량 검토 필요`, isManuallyAdded: true,
    sourceType: "actual-inbound-shortage", actualInboundDetails: item.shortageDetails,
    shipmentReceiptDetails: [run.logisticsReceiptLine!], createdAt: run.updatedAt, updatedAt: run.updatedAt };
}

const dependencies = { readInvoiceGroupStore, mutateWeeklyWorkspace, mutatePickingWaveStore };
export async function routeLogisticsReceipt(input: RouteLogisticsReceiptInput, deps = dependencies) {
  const groups = await deps.readInvoiceGroupStore();
  const targets = mergeLogisticsReceiptTargets(collectDispatchReceiptTargets(groups.groups), baseline.pendingTargets)
    .filter(target => !baseline.closedShipmentNumbers.includes(target.shipmentNumber));
  const reservation = await deps.mutateWeeklyWorkspace(workspace => reserveLogisticsReceiptRoute(workspace, targets, input));
  if (input.decision === "vendor" && !reservation.route.completed) {
    const source = vendorLine(reservation.run);
    const store = await deps.mutatePickingWaveStore({ action: "consolidateVendorOrders", operationId: reservation.run.id, lines: [source], now: reservation.route.at });
    const receipt = store.vendorQueueReceipts?.[reservation.run.id];
    if (!receipt || !store.vendorOrderLines.some(line => !store.deletedVendorLineIds[line.id] && !line.orderExclusion
      && line.shipmentReceiptDetails?.some(detail => detail.lineKey === input.lineKey))) throw new Error("거래처 초안 저장을 확인하지 못했습니다. 같은 분류로 다시 시도해 주세요.");
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
