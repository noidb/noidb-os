import { NextRequest, NextResponse } from "next/server";
import {
  inspectPoConfirmSource,
  PoConfirmSourceConflictError,
  PoConfirmSourceInspectionError,
  PoConfirmSourceNotFoundError,
} from "@/lib/wms/po-confirm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RequestBody {
  poNumbers?: unknown[];
  /** 새 선택 UI의 이름. poNumbers도 하위 호환으로 계속 받는다. */
  expectedPoNumbers?: unknown[];
  uploadedFileBase64?: unknown;
  uploadedFileName?: unknown;
}

function decodeBase64(input: string): Buffer {
  const commaIndex = input.indexOf(",");
  const raw = input.startsWith("data:") && commaIndex >= 0 ? input.slice(commaIndex + 1) : input;
  return Buffer.from(raw, "base64");
}

/**
 * 원본 파일명은 참고만 하고, 실제 `상품목록`의 `발주번호` 열 전체를 읽어 source manifest를 반환한다.
 * 업로드 bytes는 저장하지 않으며 자동검색도 Google Drive/로컬 원본을 읽기만 한다.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    const rawPoNumbers = Array.isArray(body.expectedPoNumbers) ? body.expectedPoNumbers : body.poNumbers;
    const targetPoNumbers = Array.isArray(rawPoNumbers)
      ? rawPoNumbers.map(value => String(value || "").trim()).filter(Boolean)
      : [];
    const uploadedFileBase64 = String(body.uploadedFileBase64 || "");
    const uploadedBuffer = uploadedFileBase64 ? decodeBase64(uploadedFileBase64) : undefined;
    if (uploadedFileBase64 && (!uploadedBuffer || uploadedBuffer.length === 0)) {
      return NextResponse.json({ error: "업로드한 파일 내용이 비어 있습니다." }, { status: 400 });
    }

    const source = await inspectPoConfirmSource({
      targetPoNumbers,
      uploadedBuffer,
      uploadedFileName: String(body.uploadedFileName || "").trim() || undefined,
    });
    return NextResponse.json({ source });
  } catch (error) {
    if (error instanceof PoConfirmSourceNotFoundError) {
      return NextResponse.json({ error: error.message, targetPoNumbers: error.targetPoNumbers }, { status: 404 });
    }
    if (error instanceof PoConfirmSourceConflictError) {
      return NextResponse.json({ error: error.message, candidates: error.candidates }, { status: 409 });
    }
    if (error instanceof PoConfirmSourceInspectionError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "발주확정 원본을 확인하는 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
