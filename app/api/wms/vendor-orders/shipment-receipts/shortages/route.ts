import { NextResponse } from "next/server";
import { loadSupplierHubPurchaseOrdersWithSnapshotTimes } from "@/lib/wms/supplier-hub-orders";
import { readWeeklyWorkspace } from "@/lib/wms/weekly-work-store";
import { calculateShipmentReceiptShortages } from "@/lib/wms/shipment-receipt-shortage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [{ orders, snapshotConflicts }, workspace] = await Promise.all([
      loadSupplierHubPurchaseOrdersWithSnapshotTimes(), readWeeklyWorkspace(),
    ]);
    const results = calculateShipmentReceiptShortages(orders.map(order => ({
      purchaseOrderNumber: order.purchaseOrderNumber,
      items: order.items.map(item => ({ productCode: item.productCode, productName: item.productName, vendorConfirmedQuantity: item.vendorConfirmedQuantity })),
    })), workspace.shipmentReceiptOrders || {});
    return NextResponse.json({ ok: true, source: "supplier-hub-shipments", results, snapshotConflicts });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "쉽먼트 기준 미납 미리보기를 불러오지 못했습니다." }, { status: 500 });
  }
}
