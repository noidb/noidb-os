import { NextRequest, NextResponse } from "next/server";
import { buildHanjinUploadFile, HanjinTemplateNotFoundError, type HanjinShipmentRequest } from "@/lib/wms/hanjin-upload";
import { ShipmentOutputValidationError } from "@/lib/wms/shipment-output-context";
import { generatedDriveSaveHeaders } from "@/lib/wms/google-drive-oauth-writer";

/**
 * 운송장 출력용(한진택배 고정형) 업로드파일 생성 API. 원본 서식은 절대 수정하지 않고
 * 새 행만 추가한 사본을 반환하고 지정 Drive 폴더에도 덮어쓰기 없이 저장한다.
 * 외부 Supplier Hub/한진 시스템에는 자동 제출하지 않는다.
 */
export const runtime = "nodejs";

interface RequestBody {
  requests?: HanjinShipmentRequest[];
  purchaseOrderNumbers?: string[];
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    const purchaseOrderNumbers = Array.isArray(body.purchaseOrderNumbers)
      ? body.purchaseOrderNumbers.map(String)
      : Array.isArray(body.requests) ? body.requests.map(item => item.purchaseOrderNumber) : [];
    if (purchaseOrderNumbers.length === 0) {
      return NextResponse.json({ error: "생성할 발주서/물류센터 목록이 없습니다." }, { status: 400 });
    }

    const result = await buildHanjinUploadFile(purchaseOrderNumbers);
    if (result.addedPurchaseOrderNumbers.length === 0) {
      return NextResponse.json(
        {
          error: "새로 추가할 수 있는 발주서가 없습니다.",
          skippedAlreadyPresent: result.skippedAlreadyPresent,
          skippedMissingDestination: result.skippedMissingDestination,
        },
        { status: 400 }
      );
    }

    const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
    const fileName = `한진택배_업로드_${timestamp}.xlsx`;
    const driveHeaders = await generatedDriveSaveHeaders(
      result.buffer,
      fileName,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ["쿠팡데이터", "한진택배 송장파일"],
    );

    return new NextResponse(result.buffer, {
      headers: {
        ...driveHeaders,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "X-Added-Po-Numbers": encodeURIComponent(result.addedPurchaseOrderNumbers.join(",")),
        "X-Skipped-Already-Present": encodeURIComponent(result.skippedAlreadyPresent.join(",")),
        "X-Skipped-Missing-Destination": encodeURIComponent(
          result.skippedMissingDestination.map(s => `${s.purchaseOrderNumber}(${s.fulfillmentCenter}): ${s.reason}`).join(" | ")
        ),
        "X-Source-File-Name": encodeURIComponent(result.sourceFileName),
      },
    });
  } catch (error) {
    if (error instanceof ShipmentOutputValidationError) {
      return NextResponse.json({ error: error.message, preview: error.preview }, { status: 409 });
    }
    if (error instanceof HanjinTemplateNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "한진택배 업로드파일 생성 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
