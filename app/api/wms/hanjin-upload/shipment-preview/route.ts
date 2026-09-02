import { NextRequest, NextResponse } from "next/server";
import { inspectAutoShipmentTracking } from "@/lib/wms/hanjin-shipment-auto";
import { buildShipmentOutputContext, ShipmentOutputValidationError } from "@/lib/wms/shipment-output-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const purchaseOrderNumbers = Array.isArray(body.purchaseOrderNumbers) ? body.purchaseOrderNumbers.map(String) : [];
    if (!purchaseOrderNumbers.length) return NextResponse.json({ error: "Shipment 대상 generation이 없습니다." }, { status: 400 });
    const context = await buildShipmentOutputContext(purchaseOrderNumbers, { requireDestination: false });
    if (!context.preview.canGenerate) throw new ShipmentOutputValidationError(context.preview);
    const requests = context.documents.map(document => ({
      purchaseOrderNumber: document.purchaseOrderNumber,
      fulfillmentCenter: document.fulfillmentCenterName,
      expectedDate: document.expectedArrivalDate,
    }));
    const preview = await inspectAutoShipmentTracking(requests);
    return NextResponse.json({ preview });
  } catch (error) {
    if (error instanceof ShipmentOutputValidationError) return NextResponse.json({ error: error.message, preview: error.preview }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "운송장 확인에 실패했습니다." }, { status: 500 });
  }
}
