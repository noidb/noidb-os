import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";

/**
 * 쿠팡 서플라이허브에서 다운로드한 "발주서리스트_*.xlsx" 원본 파일을 읽기 전용으로 파싱하는 모듈.
 * lib/wms/data/incoming-purchase-orders/ 폴더 안의 .xlsx 파일만 읽으며, 이 파일에는 쓰기 함수가
 * 존재하지 않는다 (서플라이어 허브/원본 파일에 절대 영향을 주지 않음).
 *
 * 다운로드 방식(수동 파일 배치)은 임시 수단이다. 최종 목표는 다운로드 없이 서플라이어 허브 화면을
 * 직접 읽는 구조이며, 그때도 이 모듈이 반환하는 SupplierHubPurchaseOrder 형태와 API 응답 형태는
 * 그대로 유지하고 이 함수의 구현(loadSupplierHubPurchaseOrders)만 교체하면 되도록 설계했다.
 */

const INCOMING_DIR = path.join(process.cwd(), "lib", "wms", "data", "incoming-purchase-orders");

export interface SupplierHubPurchaseOrderLine {
  lineNo: number;
  /** 쿠팡 상품코드 (SKU에 준하는 값) */
  productCode: string;
  productName: string;
  barcode: string;
  /** 매입유형 (예: 직매입) */
  purchaseType: string;
  /** 면세여부 (예: 과세) */
  taxType: string;
  orderedQuantity: number;
  vendorConfirmedQuantity: number;
  receivedQuantity: number;
}

export interface SupplierHubPurchaseOrder {
  /** 발주서 고유키 */
  purchaseOrderNumber: string;
  /** 발주구분 (예: 리오더) */
  orderType: string;
  fulfillmentCenter: string;
  fulfillmentAddress: string;
  /** YYYY-MM-DD 형식으로 정규화한 입고예정일 */
  expectedDate: string;
  /** 발주서가 발급된 거래처(계정)명 — 노이드비 자신의 쿠팡 계정명 */
  accountName: string;
  items: SupplierHubPurchaseOrderLine[];
  /** 원본 파일명 (추적용) */
  sourceFileName: string;
  /** 파일 수정 시각 — "실시간 조회가 아니라 특정 시점 스냅샷"임을 화면에 표시하기 위함 */
  capturedAt: string;
}

function cellText(value: unknown): string {
  if (value && typeof value === "object") {
    const v = value as { richText?: { text?: string }[]; text?: string; result?: unknown };
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text ?? "").join("");
    if (typeof v.text === "string") return v.text;
    if (v.result !== undefined) return String(v.result ?? "");
  }
  return String(value ?? "").trim();
}

function toNumber(value: unknown): number {
  const n = Number(cellText(value).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** "2026/08/21 00:00:00" → "2026-08-21" */
function normalizeDate(value: string): string {
  const match = value.trim().match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : value.trim();
}

/**
 * 쿠팡 서플라이허브 "발주서리스트" 엑셀 1건(시트 1개)을 파싱한다.
 * 고정 레이아웃 가정: 발주번호=C10, 발주구분=C11, 물류센터=C13, 주소=D13, 입고예정일시=F13,
 * 거래처명=C5. 상품 라인은 22행부터 2행 1세트(상품정보 행 + 바코드 행)로 반복되며, No.열(A)이
 * 숫자가 아니게 되면(합계 행 등) 종료한다. 이 레이아웃은 서플라이허브 엑셀 양식이 바뀌면 함께
 * 갱신해야 한다.
 */
function parseWorksheet(sheet: ExcelJS.Worksheet, sourceFileName: string, capturedAt: string): SupplierHubPurchaseOrder {
  const cell = (addr: string) => cellText(sheet.getCell(addr).value);

  const items: SupplierHubPurchaseOrderLine[] = [];
  let row = 22;
  while (row <= sheet.rowCount) {
    const lineNoText = cell(`A${row}`);
    const lineNo = Number(lineNoText);
    if (!lineNoText || !Number.isFinite(lineNo)) break;

    items.push({
      lineNo,
      productCode: cell(`B${row}`),
      productName: cell(`C${row}`),
      barcode: cell(`C${row + 1}`),
      purchaseType: cell(`D${row}`),
      taxType: cell(`D${row + 1}`),
      orderedQuantity: toNumber(sheet.getCell(`G${row}`).value),
      vendorConfirmedQuantity: toNumber(sheet.getCell(`H${row}`).value),
      receivedQuantity: toNumber(sheet.getCell(`I${row}`).value),
    });
    row += 2;
  }

  return {
    purchaseOrderNumber: cell("C10"),
    orderType: cell("C11"),
    fulfillmentCenter: cell("C13"),
    fulfillmentAddress: cell("D13"),
    expectedDate: normalizeDate(cell("F13")),
    accountName: cell("C5"),
    items,
    sourceFileName,
    capturedAt,
  };
}

/**
 * incoming-purchase-orders 폴더의 모든 .xlsx 파일을 읽기 전용으로 파싱해 반환한다.
 * 폴더가 없거나 비어 있으면 빈 배열을 반환한다. 이 함수는 파일을 절대 수정/삭제하지 않는다.
 */
export async function loadSupplierHubPurchaseOrders(): Promise<SupplierHubPurchaseOrder[]> {
  let fileNames: string[];
  try {
    fileNames = (await readdir(INCOMING_DIR)).filter(name => name.toLowerCase().endsWith(".xlsx"));
  } catch {
    return [];
  }

  const orders: SupplierHubPurchaseOrder[] = [];
  for (const fileName of fileNames) {
    const filePath = path.join(INCOMING_DIR, fileName);
    const fileStat = await stat(filePath);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const sheet = workbook.worksheets[0];
    if (!sheet) continue;
    orders.push(parseWorksheet(sheet, fileName, fileStat.mtime.toISOString()));
  }

  return orders.sort((a, b) => a.purchaseOrderNumber.localeCompare(b.purchaseOrderNumber));
}
