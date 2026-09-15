import { NextRequest, NextResponse } from "next/server";
import {
  loadSupplierHubPurchaseOrdersWithSnapshotTimes,
  summarizeUpcomingInboundByDate,
} from "@/lib/wms/supplier-hub-orders";
import { readPickingWaveStore } from "@/lib/wms/picking-wave/server-store";
import { readWeeklyWorkspace } from "@/lib/wms/weekly-work-store";
import { summarizeSupplierHubInboundByMonth, supplierHubInboundEventFiveFieldKey } from "@/lib/wms/supplier-hub-active-orders";
import { summarizeCombinedInboundByMonth } from "@/lib/wms/supplier-hub-active-orders";
import { projectInboundLifecycle } from "@/lib/wms/inbound-lifecycle";
import { readSavedInboundHistory, refreshSavedInboundHistory } from "@/lib/wms/saved-inbound-history";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";

/** GET reads saved snapshots. Only explicit POST refreshes historical source files. */
export const runtime = "nodejs";
// 폴더 안 파일 목록이 매 요청마다 바뀔 수 있으므로 정적 최적화를 막는다.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const includeHistorical = request.nextUrl.searchParams.get("includeHistorical") === "1";
    const [{ orders: allOrders, snapshotConflicts }, store, workspace, historicalResult] = await Promise.all([
      loadSupplierHubPurchaseOrdersWithSnapshotTimes({ savedOnly: true }), readPickingWaveStore(), readWeeklyWorkspace(),
      includeHistorical ? readSavedInboundHistory()
        .then(value => ({ value, error: "" }))
        .catch(error => ({ value: { events: [], fileCount: 0, sourceFiles: [], parseFailures: [] }, error: error instanceof Error ? error.message : "과거 입고 파일을 불러오지 못했습니다." }))
        : Promise.resolve({ value: { events: [], fileCount: 0, sourceFiles: [], parseFailures: [] }, error: "" }),
    ]);
    const historical = historicalResult.value;
    const projection = projectInboundLifecycle({ orders: allOrders, store, workspace });
    // 신규 작업 선택 화면은 오늘 이후 발주만 보여주되, 이미 만들어진 출고작업을 다시
    // 열 때는 입고예정일이 지난 원본도 반드시 조회할 수 있어야 한다.
    const includePast = request.nextUrl.searchParams.get("includePast") === "1";
    const orders = includePast ? allOrders : projection.activeOrders;
    return NextResponse.json({
      orders,
      lifecycleResults: projection.rows,
      snapshotConflicts,
      completedPurchaseOrderNumbers: projection.completedPurchaseOrderNumbers,
      monthlyInboundBySku: summarizeSupplierHubInboundByMonth(store.supplierHubInboundEvents),
      ...(includeHistorical ? {
        cumulativeInboundBySku: summarizeCombinedInboundByMonth(store.supplierHubInboundEvents, historical.events),
        historicalInboundStats: (() => {
          const historicalKeys = new Set(historical.events.map(event => supplierHubInboundEventFiveFieldKey(event)));
          const currentKeys = new Set(store.supplierHubInboundEvents.map(event => supplierHubInboundEventFiveFieldKey(event)));
          const overlap = [...historicalKeys].filter(key => currentKeys.has(key)).length;
          return { fileCount: historical.fileCount, uniqueEventCount: historicalKeys.size, currentEventCount: currentKeys.size, crossSourceDuplicateCount: overlap, mergedEventCount: new Set([...historicalKeys, ...currentKeys]).size, parseFailures: historical.parseFailures, sourceError: historicalResult.error || undefined };
        })(),
      } : {}),
      upcomingInboundSummary: summarizeUpcomingInboundByDate(projection.activeOrders),
    });
  } catch (error) {
    return NextResponse.json(
      {
        orders: [],
        upcomingInboundSummary: [],
        error: error instanceof Error ? error.message : "발주서 파일을 읽는 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({ error: "입고 누적 화면에서 다시 진행해 주세요." }, { status: 403 });
  try {
    const body = await request.json();
    if (body.action !== "refresh-history") throw new Error("갱신할 원본을 확인해 주세요.");
    const result = await refreshSavedInboundHistory();
    return NextResponse.json({ success: true, changed: result.changed, warning: result.warning });
  } catch (error) { return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "과거 원본 갱신 실패" }, { status: 409 }); }
}
