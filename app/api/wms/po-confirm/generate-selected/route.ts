import { NextRequest, NextResponse } from "next/server";
import { generatedDriveSaveHeaders } from "@/lib/wms/google-drive-oauth-writer";
import {
  buildSelectedPoConfirmWorkbook,
  type ConfirmedQuantitiesByPoInput,
  PoConfirmBatchSelfCheckFailedError,
  PoConfirmSelectionValidationError,
  PoConfirmSourceConflictError,
  PoConfirmSourceHashMismatchError,
  PoConfirmSourceInspectionError,
  PoConfirmSourceNotFoundError,
} from "@/lib/wms/po-confirm";

export const runtime = "nodejs";

interface RequestBody {
  selectedPoNumbers?: unknown[];
  confirmedQuantitiesByPo?: unknown;
  expectedSourceHash?: unknown;
  uploadedFileBase64?: unknown;
  uploadedFileName?: unknown;
}

function decodeBase64(input: string): Buffer {
  const commaIndex = input.indexOf(",");
  const raw = input.startsWith("data:") && commaIndex >= 0 ? input.slice(commaIndex + 1) : input;
  return Buffer.from(raw, "base64");
}

/** 선택한 내부 발주번호의 행만 남긴 쿠팡 업로드용 XLSX 한 개를 원자적으로 생성한다. */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    const selectedPoNumbers = Array.isArray(body.selectedPoNumbers)
      ? body.selectedPoNumbers.map(value => String(value || "").trim()).filter(Boolean)
      : [];
    const confirmedQuantitiesByPo = Array.isArray(body.confirmedQuantitiesByPo)
      ? (body.confirmedQuantitiesByPo as ConfirmedQuantitiesByPoInput[])
      : [];
    const uploadedFileBase64 = String(body.uploadedFileBase64 || "");
    const uploadedBuffer = uploadedFileBase64 ? decodeBase64(uploadedFileBase64) : undefined;
    if (uploadedFileBase64 && (!uploadedBuffer || uploadedBuffer.length === 0)) {
      return NextResponse.json({ error: "업로드한 파일 내용이 비어 있습니다." }, { status: 400 });
    }

    const result = await buildSelectedPoConfirmWorkbook({
      selectedPoNumbers,
      confirmedQuantitiesByPo,
      expectedSourceHash: String(body.expectedSourceHash || "").trim(),
      uploadedBuffer,
      uploadedFileName: String(body.uploadedFileName || "").trim() || undefined,
    });

    const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
    const fileName = `PO_FOR_CONFIRM_선택발주_${result.selectedPoNumbers.length}건_${timestamp}.xlsx`;
    const driveHeaders = await generatedDriveSaveHeaders(result.buffer, fileName, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ["쿠팡데이터", "발주서업로드완성"]);
    return new NextResponse(result.buffer, {
      headers: {
        ...driveHeaders,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
        "X-Source-File-Name": encodeURIComponent(result.source.fileName),
        "X-Source-File-Hash": result.source.fileHash,
        "X-Selected-Po-Count": String(result.selectedPoNumbers.length),
        "X-Selected-Po-Numbers": encodeURIComponent(result.selectedPoNumbers.join(",")),
        "X-Total-Row-Count": String(result.totalRowCount),
        "X-Row-Counts-By-Po": encodeURIComponent(JSON.stringify(result.rowCountsByPo)),
        "X-Matched-Sku-Count": String(result.matchedSkuCount),
        "X-Shortage-Row-Count": String(result.shortageRowCount),
        "X-Reason-Applied-Count": String(result.reasonAppliedCount),
      },
    });
  } catch (error) {
    if (error instanceof PoConfirmSelectionValidationError) {
      return NextResponse.json({ error: error.message, details: error.details }, { status: 400 });
    }
    if (error instanceof PoConfirmSourceNotFoundError) {
      return NextResponse.json({ error: error.message, targetPoNumbers: error.targetPoNumbers }, { status: 404 });
    }
    if (error instanceof PoConfirmSourceConflictError) {
      return NextResponse.json({ error: error.message, candidates: error.candidates }, { status: 409 });
    }
    if (error instanceof PoConfirmSourceHashMismatchError) {
      return NextResponse.json(
        { error: error.message, expectedHash: error.expectedHash, actualHash: error.actualHash },
        { status: 409 }
      );
    }
    if (error instanceof PoConfirmSourceInspectionError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    if (error instanceof PoConfirmBatchSelfCheckFailedError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "통합 발주확정 파일 생성 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
