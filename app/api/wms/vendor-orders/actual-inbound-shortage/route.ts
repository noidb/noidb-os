import { NextRequest, NextResponse } from "next/server";
import { loadSupplierHubPurchaseOrdersWithSnapshotTimes } from "@/lib/wms/supplier-hub-orders";
import { fetchProductCatalog } from "@/lib/wms/product-catalog";
import { readWeeklyWorkspace, mutateWeeklyWorkspace } from "@/lib/wms/weekly-work-store";
import { readPickingWaveStore } from "@/lib/wms/picking-wave/server-store";
import { completedShortagePairs } from "@/lib/wms/weekly-completion-summary";
import { historicalShortageEvidence } from "@/lib/wms/historical-shortage-clearance";
import { calculateSupplierHubShortages } from "@/lib/wms/supplier-hub-shortage";
import { inboundPairKey, inboundOwnership, inboundPurchaseRows, projectInboundLifecycle, type InboundDestination } from "@/lib/wms/inbound-lifecycle";
import { classifyActualInbound } from "@/lib/wms/actual-inbound-classification";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { normalizeSkuId } from "@/lib/wms/sku-normalize";
import { resolveDisplayOption } from "@/lib/wms/display-name";
import { UNASSIGNED_VENDOR_NAME } from "@/lib/wms/vendor-order/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadLines() {
  const [{ orders, snapshotConflicts }, catalog, workspace, store] = await Promise.all([
    loadSupplierHubPurchaseOrdersWithSnapshotTimes({ savedOnly: true }), fetchProductCatalog(), readWeeklyWorkspace(), readPickingWaveStore(),
  ]);
  if (!catalog.configured) throw new Error("제품DB 연결을 확인해 주세요.");
  if (!store.supplierHubOrderStatuses?.length || !store.supplierHubInboundEvents?.length) throw new Error("저장된 발주상태와 실제 입고 이벤트를 먼저 확인해 주세요.");
  const calculation = calculateSupplierHubShortages({ statuses: store.supplierHubOrderStatuses, events: store.supplierHubInboundEvents, purchaseRows: inboundPurchaseRows(orders) });
  const completed = new Set(completedShortagePairs(workspace.runs.map(run => ({ ...run }))));
  const activeStore = { ...store, vendorOrderLines: store.vendorOrderLines.filter(l => !store.deletedVendorLineIds[l.id] && !store.deletedVendorDraftIds[l.draftId]) };
  for (const item of historicalShortageEvidence(workspace, activeStore)) if (item.status === "already_resolved" || item.status === "discontinued") completed.add(inboundPairKey(item.purchaseOrderNumber, item.skuId));
  const ownership = inboundOwnership(workspace, store);
  const products = new Map(catalog.items.map(item => [normalizeSkuId(item.skuId), item]));
  const allLines = calculation.shortagePairs.map(item => {
    const product = products.get(item.skuId), productName = product?.productName || item.skuName;
    return { purchaseOrderNumber: item.orderNo, productCode: item.skuId, productName,
      confirmedQuantity: item.confirmedQuantity, receivedQuantity: item.receivedQuantity, shortageQuantity: item.shortageQuantity,
      vendorName: product?.vendorName || UNASSIGNED_VENDOR_NAME, modelName: product?.modelName || productName,
      category: product?.category || "", optionLabel: resolveDisplayOption(productName, product?.optionLabel), imageUrl: product?.imageUrl || "", barcode: product?.barcode || "",
      expectedDate: orders.find(order => order.purchaseOrderNumber === item.orderNo)?.expectedDate || "", sourceType: "actual-inbound-shortage" as const, needsConfirmation: false };
  });
  const pending = allLines.filter(line => !completed.has(inboundPairKey(line.purchaseOrderNumber, line.productCode)) && !/단종/.test(products.get(line.productCode)?.currentStatus || ""));
  const lines = pending.filter(line => !ownership.has(inboundPairKey(line.purchaseOrderNumber, line.productCode)));
  const lifecycle = projectInboundLifecycle({ orders, store, workspace, catalog: catalog.items });
  const needsEvidenceLines = allLines.filter(line => !ownership.has(inboundPairKey(line.purchaseOrderNumber, line.productCode)) && /단종/.test(products.get(line.productCode)?.currentStatus || "") && lifecycle.rows.some(r => r.purchaseOrderNumber === line.purchaseOrderNumber && r.skuId === line.productCode && r.blockers.includes("미납 최종처리 대기")));
  const delayedLines = workspace.runs.flatMap(run => {
    const route = run.actualInboundRoute, item = run.snapshot.vendorItems[0];
    if (!route || route.resolvedAt || !item || route.decision !== "delay" && route.completed) return [];
    const po = item.relatedPurchaseOrderNumbers[0];
    const result = lifecycle.rows.find(r => r.purchaseOrderNumber === po && r.skuId === item.skuId);
    const raw = allLines.find(l => l.purchaseOrderNumber === po && l.productCode === item.skuId);
    const releaseAvailable = Boolean(result && result.actualReceivedQuantity >= result.confirmedQuantity && !result.blockers.some(b => /정산|수량|계산|원본|입고데이터/.test(b)));
    return [{ ...(raw || { purchaseOrderNumber: po, productCode: item.skuId, productName: item.productName, vendorName: item.vendorName, shortageQuantity: 0, needsConfirmation: false }), route, runId: run.id, releaseAvailable }];
  });
  return { lines, allLines, pending, delayedLines, needsEvidenceLines, workspace, snapshotConflicts, calculation };
}
export async function GET() {
  try {
    const { lines, pending, delayedLines, needsEvidenceLines, snapshotConflicts, calculation } = await loadLines();
    return NextResponse.json({ lines, delayedLines, needsEvidenceLines, snapshotConflicts, calculation,
      pendingBeforeRouting: { count: pending.length, quantity: pending.reduce((s,l) => s + l.shortageQuantity, 0) }, inboundHistorySourceFile: "저장된 Supplier Hub 입고 이벤트" }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({ success: false, error: "실제 미납 화면에서 다시 진행해 주세요." }, { status: 403 });
  try {
    const body = await request.json();
    const po = String(body.purchaseOrderNumber || "").trim(), sku = String(body.skuId || "").trim();
    if (!/^\d+$/.test(po) || !/^\d+$/.test(sku)) throw new Error("발주번호와 SKU를 확인해 주세요.");
    const data = await loadLines();
    if (body.action === "receive-delay") {
      const delayed = data.delayedLines.find(l => l.purchaseOrderNumber === po && l.productCode === sku && l.releaseAvailable && l.route.decision === "delay");
      if (!delayed) throw new Error("원발주의 실제입고 완료를 확인하지 못했습니다.");
      await mutateWeeklyWorkspace(workspace => {
        const run = workspace.runs.find(r => r.id === delayed.runId);
        if (!run?.actualInboundRoute || run.actualInboundRoute.decision !== "delay" || run.updatedAt !== data.workspace.runs.find(r => r.id === delayed.runId)?.updatedAt) throw new Error("지연 상태가 변경됐습니다. 다시 확인해 주세요.");
        run.actualInboundRoute.resolvedAt = new Date().toISOString(); run.updatedAt = run.actualInboundRoute.resolvedAt; run.revision++;
      });
      return NextResponse.json({ success: true });
    }
    const prior = data.workspace.runs.find(run => run.actualInboundRoute && run.snapshot.vendorItems.some(i => i.skuId === sku && i.relatedPurchaseOrderNumbers.includes(po)));
    const source = (prior ? data.allLines : [...data.lines, ...(body.action === "discontinue" ? data.needsEvidenceLines : [])]).find(l => l.purchaseOrderNumber === po && l.productCode === sku);
    if (!source || data.snapshotConflicts.some(c => c.purchaseOrderNumber === po)) throw new Error("현재 미처리 원발주와 수량을 확인하지 못했습니다. 목록을 다시 확인해 주세요.");
    return NextResponse.json({ success: true, ...await classifyActualInbound(source, body.action as InboundDestination, String(body.memo || "")) });
  } catch (error) { return failure(error); }
}
function failure(error: unknown) { return NextResponse.json({ success: false, lines: [], error: error instanceof Error ? error.message : "실제 미납 처리에 실패했습니다." }, { status: 409 }); }
