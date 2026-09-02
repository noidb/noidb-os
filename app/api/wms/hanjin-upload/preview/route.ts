import { NextRequest, NextResponse } from "next/server";
import { buildShipmentOutputContext } from "@/lib/wms/shipment-output-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const purchaseOrderNumbers = Array.isArray(body.purchaseOrderNumbers) ? body.purchaseOrderNumbers.map(String) : [];
    if (!purchaseOrderNumbers.length) return NextResponse.json({ error: "검사할 발주번호가 없습니다." }, { status: 400 });
    const context = await buildShipmentOutputContext(purchaseOrderNumbers);
    return NextResponse.json({ ok: true, preview: context.preview });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "송장 완전성 검사에 실패했습니다." }, { status: 500 });
  }
}
