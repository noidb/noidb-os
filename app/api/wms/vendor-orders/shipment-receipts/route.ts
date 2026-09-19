import { NextResponse } from "next/server";
import { mutateWeeklyWorkspace, readWeeklyWorkspace } from "@/lib/wms/weekly-work-store";
import { mergeShipmentReceiptImport, parseShipmentReceiptImport, summarizeShipmentReceipt } from "@/lib/wms/shipment-receipts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET() {
  try {
    const workspace = await readWeeklyWorkspace();
    return NextResponse.json({ ok: true, status: "ready", source: "supplier-hub-shipments", schemaVersion: 1,
      orders: Object.values(workspace.shipmentReceiptOrders || {}).map(summarizeShipmentReceipt) }, { headers });
  } catch {
    return NextResponse.json({ ok: false, error: "쉽먼트 입고결과를 불러오지 못했습니다." }, { status: 500, headers });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.text();
    if (body.length > 2_000_000) return NextResponse.json({ ok: false, error: "한 번에 발주서 200건 이하로 가져와 주세요." }, { status: 413, headers });
    const input = parseShipmentReceiptImport(JSON.parse(body));
    const orders = await mutateWeeklyWorkspace(workspace => {
      workspace.shipmentReceiptOrders = mergeShipmentReceiptImport(workspace.shipmentReceiptOrders || {}, input);
      return input.orders.map(order => summarizeShipmentReceipt(workspace.shipmentReceiptOrders![order.purchaseOrderNumber]));
    });
    return NextResponse.json({ ok: true, orders }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "쉽먼트 자료를 저장하지 못했습니다." }, { status: 400, headers });
  }
}
