import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { buildShipmentOutputContext, ShipmentOutputValidationError } from "@/lib/wms/shipment-output-context";
import { summarizeFulfillmentCenterLabels } from "@/lib/wms/fulfillment-center-label-summary";

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

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("물류센터라벨");
    sheet.columns = [
      { header: "물류센터", key: "fulfillmentCenter", width: 32 },
      { header: "입고예정일", key: "expectedDate", width: 24 },
      { header: "발주서번호", key: "purchaseOrderNumber", width: 42 },
      { header: "총SKU", key: "totalSku", width: 12 },
      { header: "총수량", key: "totalQuantity", width: 12 },
      { header: "라벨수량", key: "labelQuantity", width: 12 },
    ];

    for (const entry of labelSummaries) {
      sheet.addRow({
        fulfillmentCenter: entry.fulfillmentCenter,
        expectedDate: entry.expectedDate,
        purchaseOrderNumber: entry.purchaseOrderNumbers.join(" / "),
        totalSku: entry.totalSku,
        totalQuantity: entry.totalQuantity,
        labelQuantity: 1,
      });
    }

    sheet.getRow(1).font = { bold: true };
    sheet.getColumn(1).font = { name: "맑은 고딕", size: 36, bold: true };
    sheet.getColumn(3).alignment = { wrapText: true, vertical: "middle" };
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) sheet.getRow(rowNumber).height = 54;
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    const buffer = await workbook.xlsx.writeBuffer();
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date()).replace(/-/g, "");
    const asciiName = `fulfillment-center-labels_${date}.xlsx`;
    const koreanName = encodeURIComponent(`물류센터_바구니라벨_${date}.xlsx`);

    return new NextResponse(buffer as ArrayBuffer, {
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
