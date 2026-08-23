import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { extractPoNumbersFromWorkbook } from "@/lib/wms/po-confirm";

/**
 * 사용자가 방금 고른 원본 PO_FOR_CONFIRM 파일의 실제 발주번호(A열)를 읽어서, 현재 화면의
 * 발주서번호와 일치하는지 "생성" 누르기 전에 미리 보여주는 조회 전용 API — 아무 파일도 만들지
 * 않고 서버에 저장하지도 않는다 (2026-08-19 5차 실사용 테스트 신규).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function decodeBase64(input: string): Buffer {
  const commaIndex = input.indexOf(",");
  const raw = input.startsWith("data:") && commaIndex >= 0 ? input.slice(commaIndex + 1) : input;
  return Buffer.from(raw, "base64");
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const fileBase64 = String(body.fileBase64 || "");
    const expectedPoNumber = String(body.expectedPoNumber || "").trim();
    if (!fileBase64) {
      return NextResponse.json({ error: "업로드한 파일이 없습니다." }, { status: 400 });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(decodeBase64(fileBase64) as unknown as ExcelJS.Buffer);
    const foundPoNumbers = extractPoNumbersFromWorkbook(workbook);
    const foundPoNumber = foundPoNumbers[0] || null;

    return NextResponse.json({
      foundPoNumber,
      foundPoNumbers,
      matches: Boolean(expectedPoNumber) && foundPoNumbers.includes(expectedPoNumber),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "파일을 확인하는 중 오류가 발생했습니다. 원본 PO_FOR_CONFIRM(xlsx) 파일이 맞는지 확인해주세요." },
      { status: 400 }
    );
  }
}
