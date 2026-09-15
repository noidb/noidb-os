import { NextResponse } from "next/server";
import { readPickingWaveStore } from "@/lib/wms/picking-wave/server-store";
import { readWeeklyWorkspace } from "@/lib/wms/weekly-work-store";
import { fetchProductCatalog } from "@/lib/wms/product-catalog";
import { buildClearanceStatus } from "@/lib/wms/clearance-status";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const [store, workspace, catalog] = await Promise.all([readPickingWaveStore(), readWeeklyWorkspace(), fetchProductCatalog()]);
    if (!catalog.configured) throw new Error("제품DB 연결을 확인해 주세요.");
    return NextResponse.json({ success: true, ...buildClearanceStatus({ orders: store.supplierHubPurchaseOrders || [], store, workspace, catalog: catalog.items }) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) { return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "청산 현황 조회 실패" }, { status: 409 }); }
}
