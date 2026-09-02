import { NextRequest, NextResponse } from "next/server";
import { buildShipmentOutputContext, ShipmentOutputValidationError } from "@/lib/wms/shipment-output-context";
import { summarizeFulfillmentCenterLabels } from "@/lib/wms/fulfillment-center-label-summary";
import { buildFulfillmentCenterLabelWorkbook } from "@/lib/wms/shipment-output-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LabelInput {
  fulfillmentCenter?: unknown;
  expectedDate?: unknown;
  purchaseOrderNumber?: unknown;
  items?: Array<{
    productCode?: unknown;
    skuId?: unknown;
    vendorConfirmedQuantity?: unknown;
    orderedQuantity?: unknown;
    quantity?: unknown;
  }>;
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

/** 선택한 발주서에서 물류센터당 한 행을 만들어 BarTender 데이터 원본 XLSX로 내려준다. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { orders?: LabelInput[]; purchaseOrderNumbers?: string[] };
    const purchaseOrderNumbers = Array.isArray(body.purchaseOrderNumbers)
      ? body.purchaseOrderNumbers.map(String)
      : Array.isArray(body.orders) ? body.orders.map(order => text(order.purchaseOrderNumber)).filter(Boolean) : [];
    const context = await buildShipmentOutputContext(purchaseOrderNumbers, { requireDestination: false });
    if (!context.preview.canGenerate) throw new ShipmentOutputValidationError(context.preview);
    const labelSummaries = summarizeFulfillmentCenterLabels(context.records);

    if (labelSummaries.length === 0) {
      return NextResponse.json({ error: "라벨을 만들 물류센터가 없습니다." }, { status: 400 });
    }

    const buffer = await buildFulfillmentCenterLabelWorkbook(context.records);
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date()).replace(/-/g, "");
    const asciiName = `fulfillment-center-labels_${date}.xlsx`;
    const koreanName = encodeURIComponent(`물류센터_라벨_${date}.xlsx`);

    return new NextResponse(buffer as unknown as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${koreanName}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof ShipmentOutputValidationError) return NextResponse.json({ error: error.message, preview: error.preview }, { status: 409 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "물류센터 라벨 파일 생성에 실패했습니다." },
      { status: 500 }
    );
  }
}
