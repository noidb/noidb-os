import { readdir } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";

/**
 * 쿠팡 서플라이허브에서 다운로드한 "PO_FOR_CONFIRM(발주번호).xlsx" 원본 파일을 그대로 열어서,
 * 확정수량(I열)만 SKU 기준으로 정확히 채운 새 파일을 만든다. 시트명·서식·병합·다른 셀 값은
 * 전부 그대로 유지되고(원본 워크북을 로드해서 특정 셀만 바꾸는 방식), 원본 파일 자체는
 * 절대 수정하지 않는다 — 매번 새 Buffer로만 반환한다.
 *
 * 실제 샘플(G:\내 드라이브\쿠팡데이터\한진택배업로드\PO_FOR_CONFIRM(139142928).xlsx) 구조 기준
 * (2026-08-19 확인, 병합 없음):
 *   시트명 "상품목록", A=발주번호 B=물류센터 C=입고유형 D=발주상태 E=상품번호(SKU ID)
 *   F=상품바코드 G=상품이름 H=발주수량 I=확정수량 ... U=입고예정일 V=발주등록일시
 */

const PO_CONFIRM_DIR = path.join(process.cwd(), "lib", "wms", "data", "po-for-confirm");
const SHEET_NAME = "상품목록";
const HEADER_ROW = 1;
const SKU_COLUMN = 5; // E열 상품번호
const CONFIRMED_QTY_COLUMN = 9; // I열 확정수량

export class PoConfirmTemplateNotFoundError extends Error {
  constructor(poNumber: string) {
    super(
      `발주확정 원본 파일을 찾지 못했습니다. lib/wms/data/po-for-confirm 폴더에 ` +
        `"PO_FOR_CONFIRM(${poNumber})" 형태의 파일명이 포함된 xlsx를 넣어주세요.`
    );
    this.name = "PoConfirmTemplateNotFoundError";
  }
}

async function findTemplateFilePath(poNumber: string): Promise<string> {
  let fileNames: string[];
  try {
    fileNames = (await readdir(PO_CONFIRM_DIR)).filter(name => name.toLowerCase().endsWith(".xlsx"));
  } catch {
    fileNames = [];
  }
  const match = fileNames.find(name => name.includes(poNumber));
  if (!match) throw new PoConfirmTemplateNotFoundError(poNumber);
  return path.join(PO_CONFIRM_DIR, match);
}

export interface ConfirmedQuantityInput {
  skuId: string;
  confirmedQuantity: number;
}

export interface BuildConfirmedOrderResult {
  buffer: ExcelJS.Buffer;
  matchedSkuCount: number;
  unmatchedSkuIds: string[];
  sourceFileName: string;
}

/**
 * PO_FOR_CONFIRM 원본을 읽어 확정수량만 채운 새 워크북 버퍼를 만든다.
 * SKU가 템플릿에 없으면 그 SKU는 건너뛰고 unmatchedSkuIds로 알려준다 — 없는 행을 새로 만들지 않는다.
 */
export async function buildConfirmedOrderFile(
  poNumber: string,
  confirmedQuantities: ConfirmedQuantityInput[]
): Promise<BuildConfirmedOrderResult> {
  const templatePath = await findTemplateFilePath(poNumber);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);

  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) {
    throw new Error(`원본 파일에 "${SHEET_NAME}" 시트를 찾을 수 없습니다. 파일 구조를 확인해주세요.`);
  }

  const qtyBySku = new Map(confirmedQuantities.map(item => [item.skuId.trim(), item.confirmedQuantity]));
  const matchedSkuIds = new Set<string>();

  let row = HEADER_ROW + 1;
  while (row <= sheet.rowCount) {
    const skuCell = sheet.getCell(row, SKU_COLUMN);
    const skuId = String(skuCell.value ?? "").trim();
    if (!skuId) break;

    if (qtyBySku.has(skuId)) {
      sheet.getCell(row, CONFIRMED_QTY_COLUMN).value = qtyBySku.get(skuId)!;
      matchedSkuIds.add(skuId);
    }
    row += 1;
  }

  const unmatchedSkuIds = confirmedQuantities.map(item => item.skuId.trim()).filter(skuId => !matchedSkuIds.has(skuId));
  const buffer = await workbook.xlsx.writeBuffer();

  return {
    buffer,
    matchedSkuCount: matchedSkuIds.size,
    unmatchedSkuIds,
    sourceFileName: path.basename(templatePath),
  };
}
