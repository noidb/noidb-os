import { NextRequest, NextResponse } from "next/server";
import { fetchProductCatalog } from "@/lib/wms/product-catalog";
import { buildGenerationBarcodeWorkbook } from "@/lib/wms/shipment-output-files";
import { buildShipmentOutputContext, ShipmentOutputValidationError } from "@/lib/wms/shipment-output-context";
import { generatedDriveSaveHeaders } from "@/lib/wms/google-drive-oauth-writer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { purchaseOrderNumbers?: unknown[] };
    const purchaseOrderNumbers = Array.isArray(body.purchaseOrderNumbers) ? body.purchaseOrderNumbers.map(String) : [];
    const context = await buildShipmentOutputContext(purchaseOrderNumbers, { requireDestination: false });
    if (!context.preview.canGenerate) throw new ShipmentOutputValidationError(context.preview);
    const catalog = await fetchProductCatalog();
    if (!catalog.configured) return NextResponse.json({ error: "제품DB가 연결되지 않아 바코드 파일 생성을 차단했습니다." }, { status: 503 });
    const buffer = await buildGenerationBarcodeWorkbook(context.groups, catalog.items);
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date()).replace(/-/g, "");
    const koreanFileName = `바코드출력_${date}_최종.xlsx`;
    const fileName = encodeURIComponent(koreanFileName);
    const driveHeaders = await generatedDriveSaveHeaders(buffer, koreanFileName, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ["쿠팡데이터", "쉽먼트업로드완성", "쉽먼트출력세트"]);
    return new NextResponse(buffer, {
      headers: {
        ...driveHeaders,
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
