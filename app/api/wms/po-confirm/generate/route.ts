import { NextRequest, NextResponse } from "next/server";
import { buildConfirmedOrderFile, PoConfirmTemplateNotFoundError } from "@/lib/wms/po-confirm";

/**
 * 발주확정 서류(PO_FOR_CONFIRM 원본 + 확정수량만 채운 사본) 생성 API.
 * 원본 템플릿은 절대 수정하지 않고, 매번 새 파일을 만들어 반환한다.
 * 외부 Supplier Hub에는 아무것도 업로드하지 않는다 — 파일만 만들어 다운로드시킨다.
 */
export const runtime = "nodejs";

interface RequestBody {
  poNumber: string;
  confirmedQuantities: { skuId: string; confirmedQuantity: number }[];
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    const poNumber = String(body.poNumber || "").trim();
    if (!poNumber) {
      return NextResponse.json({ error: "발주번호가 없습니다." }, { status: 400 });
    }
    const confirmedQuantities = Array.isArray(body.confirmedQuantities) ? body.confirmedQuantities : [];

    const result = await buildConfirmedOrderFile(poNumber, confirmedQuantities);
    const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
    const fileName = `PO_FOR_CONFIRM(${poNumber})_확정_${timestamp}.xlsx`;

    const response = new NextResponse(result.buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "X-Matched-Sku-Count": String(result.matchedSkuCount),
        "X-Unmatched-Sku-Ids": encodeURIComponent(result.unmatchedSkuIds.join(",")),
        "X-Source-File-Name": encodeURIComponent(result.sourceFileName),
      },
    });
    return response;
  } catch (error) {
    if (error instanceof PoConfirmTemplateNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "발주확정 서류 생성 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
