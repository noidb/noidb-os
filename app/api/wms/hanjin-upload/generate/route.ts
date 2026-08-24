import { NextRequest, NextResponse } from "next/server";
import { buildHanjinUploadFile, HanjinTemplateNotFoundError, type HanjinShipmentRequest } from "@/lib/wms/hanjin-upload";

/**
 * 운송장 출력용(한진택배 고정형) 업로드파일 생성 API. 원본 서식은 절대 수정하지 않고
 * 새 행만 추가한 사본을 반환한다. 외부 Supplier Hub/한진 시스템에는 아무것도 업로드하지 않는다.
 */
export const runtime = "nodejs";

interface RequestBody {
  requests: HanjinShipmentRequest[];
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    const requests = Array.isArray(body.requests) ? body.requests : [];
    if (requests.length === 0) {
      return NextResponse.json({ error: "생성할 발주서/물류센터 목록이 없습니다." }, { status: 400 });
    }

    const result = await buildHanjinUploadFile(requests);
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

    return new NextResponse(result.buffer, {
      headers: {
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
    if (error instanceof HanjinTemplateNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "한진택배 업로드파일 생성 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
