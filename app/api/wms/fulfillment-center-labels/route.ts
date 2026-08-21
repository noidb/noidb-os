import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LabelInput {
  fulfillmentCenter?: unknown;
  expectedDate?: unknown;
  purchaseOrderNumber?: unknown;
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

/** 선택한 발주서에서 물류센터당 한 행을 만들어 BarTender 데이터 원본 XLSX로 내려준다. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { orders?: LabelInput[] };
    const orders = Array.isArray(body.orders) ? body.orders : [];
    const byCenter = new Map<string, { dates: Set<string>; poNumbers: Set<string> }>();

    for (const order of orders) {
      const center = text(order.fulfillmentCenter);
      if (!center) continue;
      const entry = byCenter.get(center) || { dates: new Set<string>(), poNumbers: new Set<string>() };
      const date = text(order.expectedDate);
      const poNumber = text(order.purchaseOrderNumber);
      if (date) entry.dates.add(date);
      if (poNumber) entry.poNumbers.add(poNumber);
      byCenter.set(center, entry);
    }

    if (byCenter.size === 0) {
      return NextResponse.json({ error: "라벨을 만들 물류센터가 없습니다." }, { status: 400 });
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("물류센터라벨");
    sheet.columns = [
      { header: "물류센터", key: "fulfillmentCenter", width: 32 },
      { header: "입고예정일", key: "expectedDate", width: 24 },
      { header: "발주서번호", key: "purchaseOrderNumber", width: 42 },
      { header: "라벨수량", key: "labelQuantity", width: 12 },
    ];

    for (const [center, entry] of [...byCenter.entries()].sort(([a], [b]) => a.localeCompare(b, "ko"))) {
      sheet.addRow({
        fulfillmentCenter: center,
        expectedDate: [...entry.dates].sort().join(", "),
        purchaseOrderNumber: [...entry.poNumbers].sort().join(", "),
        labelQuantity: 1,
      });
    }

    sheet.getRow(1).font = { bold: true };
    sheet.getColumn(1).font = { name: "맑은 고딕", size: 36, bold: true };
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "물류센터 라벨 파일 생성에 실패했습니다." },
      { status: 500 }
    );
  }
}
