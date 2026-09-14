import { NextResponse } from "next/server";
import { loadSupplierHubPurchaseOrdersWithSnapshotTimes } from "@/lib/wms/supplier-hub-orders";
import { fetchProductCatalog } from "@/lib/wms/product-catalog";
import { computeActualInboundShortageLines } from "@/lib/wms/vendor-order/actual-inbound-shortage";
import {
  aggregateActualReceivedByPoSku,
  applyActualInboundHistory,
  getDefaultActualInboundHistoryLocalDir,
  isShortageConfirmedByLatestSnapshot,
  loadLatestActualInboundHistoryFile,
} from "@/lib/wms/vendor-order/actual-inbound-history";
import { mutateWeeklyWorkspace, readWeeklyWorkspace } from "@/lib/wms/weekly-work-store";
import type { ActualInboundShortageLine } from "@/lib/wms/vendor-order/actual-inbound-shortage";
import { queueActualInboundReorder } from "@/lib/wms/vendor-order/actual-inbound-routing";
import { calculateSupplierHubShortages } from "@/lib/wms/supplier-hub-shortage";
import { readPickingWaveStore } from "@/lib/wms/picking-wave/server-store";
import { normalizeSkuId } from "@/lib/wms/sku-normalize";
import { resolveDisplayOption } from "@/lib/wms/display-name";
import { UNASSIGNED_VENDOR_NAME } from "@/lib/wms/vendor-order/types";

/**
 * "실제 미납" 목록 읽기 전용 API. Supplier Hub 발주서리스트(로컬 폴더/Drive, 읽기 전용)와
 * 쿠팡 입고상세내역(Coupang_Stocked_Data_List, 로컬 폴더 중 최신 파일 1개, 읽기 전용)을 발주번호
 * +SKU 기준으로 교차 매칭해 실제 입고수량을 갱신한 뒤, 기존 계산 로직
 * (computeActualInboundShortageLines)을 그대로 재사용한다(2026-09-12 연결 — 계산 로직 자체는
 * 중복 구현하지 않음). 제품DB(구글시트)도 읽기 전용. 어디에도 쓰지 않는다 — picking shortage/
 * 거래처 발주 저장소는 전혀 건드리지 않는다.
 *
 * needsConfirmation: 해당 발주번호가 입고예정일보다 24시간 이상 지난 뒤 재확인된(재다운로드된)
 * 발주서리스트 스냅샷이 없으면 true — 미납으로 보이지만 실제로는 재확인을 안 한 것뿐일 수 있어
 * "확인필요"로만 표시하고, 화면에서 자동 처리(거래처 발주 등) 대상에서 제외해야 한다.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadLines() {
  const [{ orders, latestSnapshotTimeMsByPurchaseOrderNumber, snapshotConflicts }, catalog, stockedFile, workspace, pickingStore] = await Promise.all([
      loadSupplierHubPurchaseOrdersWithSnapshotTimes(),
      fetchProductCatalog(),
      loadLatestActualInboundHistoryFile(getDefaultActualInboundHistoryLocalDir()),
      readWeeklyWorkspace(),
      readPickingWaveStore(),
  ]);

    const statuses = pickingStore.supplierHubOrderStatuses || [];
    const events = pickingStore.supplierHubInboundEvents || [];
    if (statuses.length > 0 && events.length > 0) {
      const purchaseRows = [
        ["발주번호", "SKU ID", "상품명", "확정수량", "_주간원문검증오류"],
        ...orders.flatMap(order => order.items.map(item => [
          order.purchaseOrderNumber,
          item.productCode,
          item.productName,
          String(item.vendorConfirmedQuantity),
          "",
        ])),
      ];
      const calculation = calculateSupplierHubShortages({ statuses, events, purchaseRows });
      const catalogBySku = new Map(catalog.items.map(item => [normalizeSkuId(item.skuId), item]));
      const lines = calculation.shortagePairs.map(item => {
        const catalogEntry = catalogBySku.get(normalizeSkuId(item.skuId));
        const productName = catalogEntry?.productName || item.skuName;
        return {
          purchaseOrderNumber: item.orderNo,
          productCode: item.skuId,
          productName,
          confirmedQuantity: item.confirmedQuantity,
          receivedQuantity: item.receivedQuantity,
          shortageQuantity: item.shortageQuantity,
          vendorName: catalogEntry?.vendorName || UNASSIGNED_VENDOR_NAME,
          modelName: catalogEntry?.modelName || productName,
          category: catalogEntry?.category || "",
          optionLabel: resolveDisplayOption(productName, catalogEntry?.optionLabel),
          imageUrl: catalogEntry?.imageUrl || "",
          barcode: catalogEntry?.barcode || "",
          sourceType: "actual-inbound-shortage" as const,
          needsConfirmation: false,
        };
      });
      return { lines, stockedFile, snapshotConflicts, calculation };
    }

    const actualByKey = aggregateActualReceivedByPoSku(stockedFile?.rows || []);
    const { orders: mergedOrders } = applyActualInboundHistory(orders, actualByKey);

    const expectedDateByPo = new Map<string, string>();
    for (const order of orders) expectedDateByPo.set(order.purchaseOrderNumber, order.expectedDate);

    const routedReorders = new Set<string>();
    for (const run of workspace.runs) {
      for (const completed of run.reorderRequestedLines || []) routedReorders.add(JSON.stringify([completed.purchaseOrderNumber, completed.skuId]));
      for (const review of Object.values(run.reviews)) if (review.decision === "reorder") {
        const item = run.snapshot.vendorItems.find(row => row.skuId === review.skuId);
        for (const detail of item?.shortageDetails || []) routedReorders.add(JSON.stringify([detail.purchaseOrderNumber, review.skuId]));
      }
    }
    const lines = computeActualInboundShortageLines(mergedOrders, catalog.items).filter(line =>
      !routedReorders.has(JSON.stringify([line.purchaseOrderNumber, line.productCode]))
    ).map(line => ({
      ...line,
      needsConfirmation: !isShortageConfirmedByLatestSnapshot(
        expectedDateByPo.get(line.purchaseOrderNumber) || "",
        latestSnapshotTimeMsByPurchaseOrderNumber[line.purchaseOrderNumber]
      ),
    }));

  return { lines, stockedFile, snapshotConflicts, calculation: null };
}

export async function GET() {
  try {
    const { lines, stockedFile, snapshotConflicts, calculation } = await loadLines();
    return NextResponse.json({
      lines,
      snapshotConflicts,
      inboundHistorySourceFile: stockedFile?.fileName || null,
      inboundHistorySourceMtime: stockedFile?.mtime || null,
      calculation: calculation ? {
        statusCount: calculation.statusCount,
        excludedPurchaseTypeCount: calculation.excludedPurchaseTypeCount,
        exactSettledCount: calculation.exactSettledCount,
        inboundEventCount: calculation.inboundEventCount,
        uniqueInboundEventCount: calculation.uniqueInboundEventCount,
        duplicateInboundEventCount: calculation.duplicateInboundEventCount,
        unresolvedPairs: calculation.unresolvedPairs,
        missingSourceOrderNumbers: calculation.missingSourceOrderNumbers,
      } : null,
    });
  } catch (error) {
    return NextResponse.json(
      { lines: [], error: error instanceof Error ? error.message : "실제 미납 목록을 불러오는 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: string; purchaseOrderNumber?: string; skuId?: string };
    const purchaseOrderNumber = String(body.purchaseOrderNumber || "").trim();
    const skuId = String(body.skuId || "").trim();
    if (body.action !== "reorder" || !/^\d+$/.test(purchaseOrderNumber) || !/^\d+$/.test(skuId)) {
      throw new Error("재발주로 보낼 발주번호와 SKU를 확인해 주세요.");
    }
    const { lines } = await loadLines();
    const source = lines.find(line => line.purchaseOrderNumber === purchaseOrderNumber && line.productCode === skuId);
    if (!source) throw new Error("현재 실제미납 목록에서 해당 발주번호와 SKU를 찾지 못했습니다. 목록을 새로고침해 주세요.");
    if (source.needsConfirmation) throw new Error("입고예정일 이후 최신 발주서 확인이 필요한 상품입니다.");
    const result = await queueReorder(source);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "미납분 재발주 연결에 실패했습니다." }, { status: 400 });
  }
}

async function queueReorder(source: ActualInboundShortageLine) {
  return mutateWeeklyWorkspace(workspace => queueActualInboundReorder(workspace, source));
}
