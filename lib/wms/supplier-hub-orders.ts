import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import {
  downloadDriveFile,
  isDriveReaderConfigured,
  listDriveFilesFromEnv,
  shouldRequireDriveReader,
  type DriveFileInfo,
} from "./google-drive-reader";

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
 * 엑셀 파일 바이너리(버퍼)를 발주서 1건으로 파싱한다. 파일 시스템에 이미 저장된 파일뿐 아니라,
 * ZIP에서 방금 압축 해제한 버퍼(디스크에 쓰기 전)에도 쓸 수 있도록 분리해둔 함수 —
 * lib/wms/import-latest-purchase-orders.ts(최신 발주 불러오기)가 중복 여부를 먼저 확인할 때 사용한다.
 */
export async function parseSupplierHubPurchaseOrderBuffer(
  buffer: ExcelJS.Buffer | Buffer,
  sourceFileName: string,
  capturedAt: string
): Promise<SupplierHubPurchaseOrder | null> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return null;
  return parseWorksheet(sheet, sourceFileName, capturedAt);
}

/**
 * incoming-purchase-orders 폴더의 모든 .xlsx 파일을 읽기 전용으로 파싱해 반환한다.
 * 폴더가 없거나 비어 있으면 빈 배열을 반환한다. 이 함수는 파일을 절대 수정/삭제하지 않는다.
 */
export async function loadSupplierHubPurchaseOrders(): Promise<SupplierHubPurchaseOrder[]> {
  if (isDriveReaderConfigured() || shouldRequireDriveReader()) {
    const files = (await listDriveFilesFromEnv("GOOGLE_DRIVE_COUPANG_PURCHASE_ORDER_FOLDER_ID"))
      .filter(file => /\.(zip|xlsx)$/i.test(file.name))
      .sort((a, b) => a.modifiedTime.localeCompare(b.modifiedTime));
    return loadSupplierHubPurchaseOrdersFromDriveFiles(files);
  }

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

/** 한국시간 오늘(YYYY-MM-DD). 서버가 UTC로 실행되는 Vercel에서도 날짜 경계가 어긋나지 않게 한다. */
export function todayInKorea(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** 입고예정일이 오늘이거나 미래인 작업 대상만 반환한다. 날짜가 비어 있거나 형식이 이상하면 숨기지 않는다. */
export function filterCurrentPurchaseOrders(orders: SupplierHubPurchaseOrder[], today = todayInKorea()) {
  return orders.filter(order => !/^\d{4}-\d{2}-\d{2}$/.test(order.expectedDate) || order.expectedDate >= today);
}

export async function loadSupplierHubPurchaseOrdersFromDriveFiles(files: DriveFileInfo[]): Promise<SupplierHubPurchaseOrder[]> {
  const byPoNumber = new Map<string, SupplierHubPurchaseOrder>();
  for (const file of files) {
      const raw = await downloadDriveFile(file.id);
      const inputs: { name: string; buffer: Buffer }[] = [];
      if (file.name.toLowerCase().endsWith(".zip")) {
        const zip = await JSZip.loadAsync(raw);
        for (const [name, entry] of Object.entries(zip.files)) {
          if (!entry.dir && name.toLowerCase().endsWith(".xlsx")) {
            inputs.push({ name, buffer: await entry.async("nodebuffer") });
          }
        }
      } else {
        inputs.push({ name: file.name, buffer: raw });
      }
      for (const input of inputs) {
        const order = await parseSupplierHubPurchaseOrderBuffer(input.buffer, input.name, file.modifiedTime);
        if (!order?.purchaseOrderNumber) continue;
        const existing = byPoNumber.get(order.purchaseOrderNumber);
        if (!existing) {
          byPoNumber.set(order.purchaseOrderNumber, order);
          continue;
        }

        // 같은 발주번호의 후속 파일은 신규 발주로 다시 등록하지 않는다. 쿠팡에서 수정 가능한
        // 일정 정보가 실제로 달라진 경우에만 그 필드들을 최신값으로 반영하고 상품/수량은 보존한다.
        if (existing.expectedDate !== order.expectedDate || existing.fulfillmentCenter !== order.fulfillmentCenter) {
          byPoNumber.set(order.purchaseOrderNumber, {
            ...existing,
            fulfillmentCenter: order.fulfillmentCenter,
            fulfillmentAddress: order.fulfillmentAddress,
            expectedDate: order.expectedDate,
            sourceFileName: order.sourceFileName,
            // 일정 수정 파일이 나중에 올라와도 최초 감지일(화면의 최초 발주일)은 바꾸지 않는다.
            capturedAt: existing.capturedAt,
          });
        }
      }
  }
  return [...byPoNumber.values()].sort((a, b) => a.purchaseOrderNumber.localeCompare(b.purchaseOrderNumber));
}

/** incoming-purchase-orders 폴더 절대경로 — 최신 발주 불러오기 기능이 새 파일을 쓸 때 재사용한다. */
export function getIncomingPurchaseOrdersDir(): string {
  return INCOMING_DIR;
}
