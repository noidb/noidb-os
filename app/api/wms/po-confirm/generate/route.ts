import { NextRequest, NextResponse } from "next/server";
import {
  buildConfirmedOrderFile,
  buildConfirmedOrderFileFromUpload,
  PoConfirmColumnNotFoundError,
  PoConfirmDuplicateFileError,
  PoConfirmFileReadError,
  PoConfirmMismatchError,
  PoConfirmQuantityExceededError,
  PoConfirmSelfCheckFailedError,
  PoConfirmTemplateNotFoundError,
} from "@/lib/wms/po-confirm";

/**
 * 발주확정 서류(PO_FOR_CONFIRM 원본 + 확정수량만 채운 사본) 생성 API.
 * 원본 템플릿은 절대 수정하지 않고, 매번 새 파일을 만들어 반환한다.
 * 외부 Supplier Hub에는 아무것도 업로드하지 않는다 — 파일만 만들어 다운로드시킨다.
 *
 * 2026-08-19 5차 실사용 테스트 반영: uploadedFileBase64를 함께 보내면(프로젝트 폴더/실제 원본
 * 보관 폴더 어디에도 없는 발주서용) 그 파일을 원본으로 대신 쓴다. 업로드 파일의 실제 발주번호가
 * 요청한 poNumber와 다르면 400으로 거부하고 아무 파일도 만들지 않는다 — 다른 발주서 원본을
 * 잘못 써서 확정수량이 엉뚱한 파일에 채워지는 것을 막기 위함이다. 업로드 파일은 메모리에서만
 * 처리하고 어디에도 저장하지 않는다(실제 원본을 덮어쓰거나 이동시키지 않음).
 */
export const runtime = "nodejs";

interface RequestBody {
  poNumber: string;
  confirmedQuantities: { skuId: string; confirmedQuantity: number }[];
  /** data:...;base64,... 또는 순수 base64 문자열. 있으면 자동 검색 대신 이 파일을 원본으로 쓴다. */
  uploadedFileBase64?: string;
}

function decodeBase64(input: string): Buffer {
  const commaIndex = input.indexOf(",");
  const raw = input.startsWith("data:") && commaIndex >= 0 ? input.slice(commaIndex + 1) : input;
  return Buffer.from(raw, "base64");
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    const poNumber = String(body.poNumber || "").trim();
    if (!poNumber) {
      return NextResponse.json({ error: "발주번호가 없습니다." }, { status: 400 });
    }
    const confirmedQuantities = Array.isArray(body.confirmedQuantities) ? body.confirmedQuantities : [];

    const result = body.uploadedFileBase64
      ? await buildConfirmedOrderFileFromUpload(decodeBase64(body.uploadedFileBase64), poNumber, confirmedQuantities)
      : await buildConfirmedOrderFile(poNumber, confirmedQuantities);

    const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
    const fileName = `PO_FOR_CONFIRM(${poNumber})_확정_${timestamp}.xlsx`;

    return new NextResponse(result.buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "X-Matched-Sku-Count": String(result.matchedSkuCount),
        "X-Unmatched-Sku-Ids": encodeURIComponent(result.unmatchedSkuIds.join(",")),
        "X-Source-File-Name": encodeURIComponent(result.sourceFileName),
        "X-Shortage-Row-Count": String(result.shortageRowCount),
        "X-Reason-Applied-Count": String(result.reasonAppliedCount),
      },
    });
  } catch (error) {
    if (error instanceof PoConfirmTemplateNotFoundError) {
      return NextResponse.json({ error: error.message, needsUpload: true }, { status: 404 });
    }
    if (error instanceof PoConfirmDuplicateFileError) {
      return NextResponse.json({ error: error.message, duplicateFileNames: error.fileNames }, { status: 409 });
    }
    if (error instanceof PoConfirmFileReadError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    if (error instanceof PoConfirmMismatchError) {
      return NextResponse.json({ error: error.message, foundPoNumber: error.foundPoNumber }, { status: 400 });
    }
    if (error instanceof PoConfirmQuantityExceededError) {
      return NextResponse.json({ error: error.message, exceededRows: error.rows }, { status: 422 });
    }
    if (error instanceof PoConfirmColumnNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    if (error instanceof PoConfirmSelfCheckFailedError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "발주확정 서류 생성 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
