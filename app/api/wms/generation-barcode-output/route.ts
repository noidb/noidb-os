import { NextRequest, NextResponse } from "next/server";
import { buildGenerationBarcodeWorkbook } from "@/lib/wms/shipment-output-files";
import { buildShipmentOutputContext, ShipmentOutputValidationError } from "@/lib/wms/shipment-output-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 2026-09-18 — 제품DB(구글시트) 연결 요구사항을 없앴다. 07_오늘작업기록_2026-09-17.md 실사용
 * 확정 최종 양식(모델명 열 없음, 제조국명 "중국" 고정)은 발주서 원본만으로 만들 수 있어
 * catalogItems 조회 자체가 필요 없다 — Google 연결이 끊겨도 이 파일은 항상 생성된다.
 * shipmentNumbersByGroupKey(물류센터+입고예정일 → 쉽먼트번호)는 선택값이며, 없으면
 * "미입력"으로 표시된다.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { purchaseOrderNumbers?: unknown[]; shipmentNumbersByGroupKey?: unknown };
    const purchaseOrderNumbers = Array.isArray(body.purchaseOrderNumbers) ? body.purchaseOrderNumbers.map(String) : [];
    const shipmentNumbersByGroupKey = body.shipmentNumbersByGroupKey && typeof body.shipmentNumbersByGroupKey === "object"
      ? Object.fromEntries(Object.entries(body.shipmentNumbersByGroupKey as Record<string, unknown>).map(([key, value]) => [key, String(value)]))
      : {};
    const context = await buildShipmentOutputContext(purchaseOrderNumbers, { requireDestination: false });
    if (!context.preview.canGenerate) throw new ShipmentOutputValidationError(context.preview);
    const buffer = await buildGenerationBarcodeWorkbook(context.groups, shipmentNumbersByGroupKey);
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date()).replace(/-/g, "");
    const fileName = encodeURIComponent(`바코드출력_${date}_최종.xlsx`);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="barcode-output_${date}.xlsx"; filename*=UTF-8''${fileName}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof ShipmentOutputValidationError) return NextResponse.json({ error: error.message, preview: error.preview }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "바코드 파일 생성에 실패했습니다." }, { status: 500 });
  }
}
