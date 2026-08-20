import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";

/**
 * 쉽먼트 결과 파일(Supplier Hub 처리 후 쉽먼트번호가 들어간 파일)처럼, 아직 실제 샘플 구조를
 * 확인하지 못한 업로드 파일을 일단 열어서 시트명·첫 행(헤더로 추정)·미리보기 몇 줄만 그대로
 * 보여주는 조회 전용 API다 (2026-08-19 5차 실사용 테스트 신규). 특정 컬럼이 "쉽먼트번호"라고
 * 임의로 단정하지 않는다 — 실제 컬럼 이름을 그대로 보여주고, 값을 저장하거나 어디에도 반영하지
 * 않는다. 실제 샘플이 확인되면 lib/wms/hanjin-upload.ts에 전용 파서를 추가해 교체할 수 있다.
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
    if (!fileBase64) {
      return NextResponse.json({ error: "업로드한 파일이 없습니다." }, { status: 400 });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(decodeBase64(fileBase64) as unknown as ExcelJS.Buffer);

    const sheetNames = workbook.worksheets.map(s => s.name);
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      return NextResponse.json({ sheetNames, headers: [], previewRows: [], rowCount: 0 });
    }

    const colCount = Math.min(sheet.columnCount || 0, 20);
    const headers: string[] = [];
    for (let c = 1; c <= colCount; c++) headers.push(String(sheet.getCell(1, c).value ?? ""));

    const previewRows: string[][] = [];
    for (let r = 2; r <= Math.min(sheet.rowCount, 6); r++) {
      const row: string[] = [];
      for (let c = 1; c <= colCount; c++) row.push(String(sheet.getCell(r, c).value ?? ""));
      previewRows.push(row);
    }

    return NextResponse.json({ sheetNames, headers, previewRows, rowCount: sheet.rowCount });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "파일을 확인하는 중 오류가 발생했습니다." },
      { status: 400 }
    );
  }
}
