import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";

/**
 * 거래처별 부족분 발주서(승인된 것)를 엑셀 파일로 만들어 다운로드시키는 API.
 * 화면에서 보내준 라인 데이터를 그대로 표로만 옮긴다 — 저장소를 조회하지 않고, 어디에도 쓰지 않는다.
 *
 * 상품 이미지는 제품DB URL에서 최선을 다해 내려받아 셀에 삽입한다(실패해도 나머지 행 처리는 계속됨,
 * 실패한 행은 이미지 칸이 비고 URL이 텍스트로 남는다). 쿠팡 바코드는 이번 파일에서는 숫자만
 * 텍스트로 넣는다 — 스캔 가능한 바코드 그래픽 렌더링은 서버에 캔버스 라이브러리가 없어 이번
 * 요청 범위에서는 제외했다(모바일 화면·PNG에는 포함됨). 필요하면 알려달라고 안내한다.
 */
export const runtime = "nodejs";

interface ExportLine {
  modelName: string;
  skuId: string;
  optionLabel: string;
  imageUrl?: string;
  barcode?: string;
  shortageQuantity: number;
  actualShortageQuantity?: number;
  currentStock: string;
  relatedPurchaseOrderNumbers: string[];
  memo: string;
}

async function fetchImageForExcel(url: string): Promise<{ buffer: Buffer; extension: "png" | "jpeg" } | null> {
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "";
    const extension = contentType.includes("png") ? "png" : "jpeg";
    const arrayBuffer = await response.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), extension };
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const vendorName: string = body.vendorName || "거래처 미등록";
  const waveId: string = body.waveId || "";
  const lines: ExportLine[] = Array.isArray(body.lines) ? body.lines : [];

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("발주서");

  sheet.addRow(["거래처", vendorName]);
  sheet.addRow(["참고번호", waveId]);
  sheet.addRow(["발주일", new Date().toLocaleDateString("ko-KR")]);
  sheet.addRow([]);

  const headerRowIndex = sheet.rowCount + 1;
  const headerRow = sheet.addRow(["상품 이미지", "모델명", "SKU", "옵션", "쿠팡 바코드", "발주수량", "부족수량(내부참고)", "현재고", "관련 발주서", "메모"]);
  headerRow.font = { bold: true };

  const IMAGE_COLUMN_WIDTH = 12;
  sheet.getColumn(1).width = IMAGE_COLUMN_WIDTH;
  for (let col = 2; col <= 10; col++) sheet.getColumn(col).width = 18;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const rowIndex = headerRowIndex + 1 + i;
    sheet.getRow(rowIndex).height = 60;
    sheet.addRow([
      "",
      line.modelName,
      line.skuId,
      line.optionLabel,
      line.barcode || "쿠팡 바코드 미등록",
      line.shortageQuantity,
      line.actualShortageQuantity ?? line.shortageQuantity,
      line.currentStock,
      (line.relatedPurchaseOrderNumbers || []).join(", "),
      line.memo,
    ]);

    const image = await fetchImageForExcel(line.imageUrl || "");
    if (image) {
      const imageId = workbook.addImage({ buffer: image.buffer as any, extension: image.extension });
      sheet.addImage(imageId, {
        tl: { col: 0.1, row: rowIndex - 1 + 0.1 },
        ext: { width: 56, height: 56 },
      });
    } else if (line.imageUrl) {
      sheet.getCell(rowIndex, 1).value = line.imageUrl;
    } else {
      sheet.getCell(rowIndex, 1).value = "이미지 미등록";
    }
  }

  sheet.addRow([]);
  const deliveryTitle = sheet.addRow(["배송정보"]);
  deliveryTitle.font = { bold: true, size: 14 };
  sheet.addRow(["받는 사람", "노이드비"]);
  sheet.addRow(["주소", "강원도 원주시 전망길 22-3 1층"]);
  sheet.addRow(["전화번호", "010-5769-5602"]);

  const buffer = await workbook.xlsx.writeBuffer();
  const fileName = `발주서_${vendorName}_${waveId}.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}
