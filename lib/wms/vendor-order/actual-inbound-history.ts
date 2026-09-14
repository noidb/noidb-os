import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import type { SupplierHubPurchaseOrder } from "../supplier-hub-orders";

/**
 * 쿠팡 서플라이허브 "입고상세내역"(Coupang_Stocked_Data_List_*.xlsx) 실적 파일 파서 (2026-09-12 신규).
 *
 * 발주서리스트(SupplierHubPurchaseOrder, 확정수량 보유)와는 완전히 다른 별도 다운로드 파일이다 —
 * 표 형태(헤더 1행 + 데이터행)이고, 발주번호("번호" 열)+SKU별 실제 거래 1건이 1행이며 확정/발주
 * 수량 컬럼 자체가 없다. 그래서 이 파일 하나만으로는 "미납"(확정-입고)을 계산할 수 없고, 반드시
 * 발주서리스트의 확정수량과 교차 매칭해야 한다 — 실제 미납 계산은 기존
 * `computeActualInboundShortageLines`/`computeSingleUnitInboundLines`(actual-inbound-shortage.ts,
 * single-unit-inbound.ts)를 그대로 재사용하고, 이 파일은 그 함수들이 받는
 * `SupplierHubPurchaseOrder[]`의 receivedQuantity를 실제 데이터로 덮어쓰는 전처리만 담당한다.
 *
 * 실측 확인(2026-09-12, 실제 운영 파일 3개월치): "구분" 열은 지금까지 전부 "발주"만 관측됨
 * (반품/반출 사례 없음) — 그래도 반출이 생기면 빼도록 방어적으로 남겨둔다. 날짜 헤더는 실측
 * 파일엔 "입고/반출시각"으로 찍혀 있었지만, 사용자가 다른 내보내기에서 "입고/반출시간" 표기를
 * 봤다고 해 두 표기 모두 인식하게 한다(수량 집계 자체는 날짜 값을 쓰지 않아 영향 없음).
 */

export interface ActualInboundHistoryRow {
  purchaseOrderNumber: string;
  productCode: string;
  productName: string;
  /** "구분" 열 원본 값 (예: "발주"=실입고, "반출"=반품). */
  type: string;
  quantity: number;
  /** 입고/반출시각 원본 문자열. 수량 집계에는 쓰지 않고 표시/디버깅용으로만 보존한다. */
  transactedAt: string;
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

/** 사용자 PC의 "입고상세내역 다운로드" 구글드라이브 동기화 폴더 — automation/coupang-po/config.example.json의 inboundHistory 폴더와 동일 위치. */
const STOCKED_DATA_LIST_LOCAL_DIR_ENV = "WMS_STOCKED_DATA_LIST_LOCAL_DIR";
const STOCKED_DATA_LIST_LOCAL_DIR_DEFAULT = "G:\\내 드라이브\\쿠팡데이터\\입고상세내역 다운로드";

export function getDefaultActualInboundHistoryLocalDir(): string {
  return process.env[STOCKED_DATA_LIST_LOCAL_DIR_ENV]?.trim() || STOCKED_DATA_LIST_LOCAL_DIR_DEFAULT;
}

const SKU_HEADER_CANDIDATES = ["SKU번호", "SKU ID", "SKU"];
const PO_HEADER_CANDIDATES = ["번호", "발주번호", "발주서번호", "발주서 번호"];
const NAME_HEADER_CANDIDATES = ["SKU명", "SKU 이름"];
/** "시각"/"시간" 두 표기 모두 지원 — 실제 헤더 표기가 내보내기 버전에 따라 다를 수 있음. */
const DATE_HEADER_CANDIDATES = ["입고/반출시각", "입고/반출시간"];

function findHeaderRow(sheet: ExcelJS.Worksheet): { rowNumber: number; headers: string[] } | null {
  let found: { rowNumber: number; headers: string[] } | null = null;
  sheet.eachRow((row, rowNumber) => {
    if (found) return;
    const values: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => { values[colNumber - 1] = cellText(cell.value); });
    if (values.some(v => SKU_HEADER_CANDIDATES.includes(v))) found = { rowNumber, headers: values };
  });
  return found;
}

function indexOfHeader(headers: string[], candidates: string[]): number {
  for (const name of candidates) {
    const index = headers.indexOf(name);
    if (index >= 0) return index;
  }
  return -1;
}

function parseSheetRows(sheet: ExcelJS.Worksheet): ActualInboundHistoryRow[] {
  const header = findHeaderRow(sheet);
  if (!header) return [];
  const { rowNumber: headerRowNumber, headers } = header;

  const skuIndex = indexOfHeader(headers, SKU_HEADER_CANDIDATES);
  const poIndex = indexOfHeader(headers, PO_HEADER_CANDIDATES);
  const nameIndex = indexOfHeader(headers, NAME_HEADER_CANDIDATES);
  const typeIndex = indexOfHeader(headers, ["구분"]);
  const quantityIndex = indexOfHeader(headers, ["수량", "입고수량"]);
  const dateIndex = indexOfHeader(headers, DATE_HEADER_CANDIDATES);
  if (skuIndex < 0 || quantityIndex < 0) return [];

  const rows: ActualInboundHistoryRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return;
    const values: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => { values[colNumber - 1] = cellText(cell.value); });
    const productCode = values[skuIndex] || "";
    if (!productCode) return;
    rows.push({
      purchaseOrderNumber: poIndex >= 0 ? values[poIndex] || "" : "",
      productCode,
      productName: nameIndex >= 0 ? values[nameIndex] || "" : "",
      type: typeIndex >= 0 ? values[typeIndex] || "" : "",
      quantity: toNumber(values[quantityIndex]),
      transactedAt: dateIndex >= 0 ? values[dateIndex] || "" : "",
    });
  });
  return rows;
}

export async function parseActualInboundHistoryBuffer(buffer: ExcelJS.Buffer | Buffer): Promise<ActualInboundHistoryRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  return parseSheetRows(sheet);
}

/** 지정한 로컬 폴더(사용자 PC의 "입고상세내역 다운로드" 폴더 등)의 .xlsx 파일을 전부 읽는다. */
export async function loadActualInboundHistoryFromLocalPath(dirPath: string): Promise<ActualInboundHistoryRow[]> {
  let fileNames: string[];
  try {
    fileNames = (await readdir(dirPath)).filter(name => name.toLowerCase().endsWith(".xlsx"));
  } catch {
    return [];
  }
  const rows: ActualInboundHistoryRow[] = [];
  for (const fileName of fileNames) {
    const filePath = path.join(dirPath, fileName);
    await stat(filePath);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const sheet = workbook.worksheets[0];
    if (!sheet) continue;
    rows.push(...parseSheetRows(sheet));
  }
  return rows;
}

export interface LatestActualInboundHistoryFile {
  fileName: string;
  mtime: string;
  rows: ActualInboundHistoryRow[];
}

/**
 * 지정 폴더 안의 Coupang_Stocked_Data_List_*.xlsx 파일들 중 "가장 최근에 받은 것 1개"만 골라
 * 읽는다(2026-09-12 신규). 폴더에는 조회기간이 겹치는 여러 스냅샷(예: 7/12~8/12, 8/7~9/7,
 * 9/9~9/9, 9/9~9/11)이 같이 쌓여 있을 수 있는데, 전부 합쳐 집계하면 겹치는 기간의 거래가
 * 중복 집계된다 — "1개입고 SKU"는 항상 "가장 최근 다운로드분 1개" 범위로만 판단해야 하므로
 * 최신 파일 하나만 선택한다. 파일이 없으면 rows: []를 반환한다(데모 데이터로 채우지 않음).
 */
export async function loadLatestActualInboundHistoryFile(dirPath: string): Promise<LatestActualInboundHistoryFile | null> {
  let fileNames: string[];
  try {
    fileNames = (await readdir(dirPath)).filter(name => name.toLowerCase().endsWith(".xlsx"));
  } catch {
    return null;
  }
  if (!fileNames.length) return null;

  let latest: { fileName: string; mtimeMs: number; mtimeIso: string } | null = null;
  for (const fileName of fileNames) {
    const fileStat = await stat(path.join(dirPath, fileName));
    if (!latest || fileStat.mtimeMs > latest.mtimeMs) {
      latest = { fileName, mtimeMs: fileStat.mtimeMs, mtimeIso: fileStat.mtime.toISOString() };
    }
  }
  if (!latest) return null;

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.join(dirPath, latest.fileName));
  const sheet = workbook.worksheets[0];
  return { fileName: latest.fileName, mtime: latest.mtimeIso, rows: sheet ? parseSheetRows(sheet) : [] };
}

/** 발주번호::SKU 키. computeActualInboundShortageLines 등과 동일한 조합 키를 쓴다. */
export function actualInboundHistoryKey(purchaseOrderNumber: string, productCode: string): string {
  return `${purchaseOrderNumber}::${productCode}`;
}

/** 발주번호+SKU별 가장 최근 실제 거래시각("입고/반출시각" 원본 문자열) — "입고일" 표시용. */
export function latestTransactedAtByPoSku(rows: ActualInboundHistoryRow[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const row of rows) {
    if (!row.purchaseOrderNumber || !row.productCode || !row.transactedAt) continue;
    const key = actualInboundHistoryKey(row.purchaseOrderNumber, row.productCode);
    const current = result.get(key);
    if (!current || row.transactedAt > current) result.set(key, row.transactedAt);
  }
  return result;
}

/**
 * 동일 발주번호+SKU 중복 행(같은 거래가 여러 줄로 나뉜 경우)은 실제입고수량을 합산한다.
 * "반출"만 뺴고 그 외(관측된 값은 전부 "발주")는 실입고로 더한다 — 음수가 되면 0으로 자른다.
 */
export function aggregateActualReceivedByPoSku(rows: ActualInboundHistoryRow[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (!row.purchaseOrderNumber || !row.productCode) continue;
    const key = actualInboundHistoryKey(row.purchaseOrderNumber, row.productCode);
    const delta = row.type === "반출" ? -row.quantity : row.quantity;
    totals.set(key, (totals.get(key) || 0) + delta);
  }
  for (const [key, value] of totals) totals.set(key, Math.max(0, value));
  return totals;
}

export interface ApplyActualInboundHistoryResult {
  orders: SupplierHubPurchaseOrder[];
  /** Stocked_Data_List에서 집계된 발주번호+SKU 조합 중 발주서리스트에서 못 찾은 건수. */
  unmatchedActualKeys: string[];
  /** 발주서리스트 라인 중 Stocked_Data_List에서 실제 입고 기록을 찾은 라인 수. */
  matchedLineCount: number;
  /** 발주서리스트 라인 중 Stocked_Data_List에 대응 기록이 없어 실제입고수량을 0으로 둔 라인 수. */
  unmatchedLineCount: number;
}

/**
 * 발주서리스트의 확정수량(vendorConfirmedQuantity)은 그대로 두고, receivedQuantity를 Stocked_Data_List
 * 실적으로 덮어쓴다 — 매칭은 발주번호+SKU 완전일치만 인정한다(임의 추정 금지).
 *
 * 대응 기록이 없는 라인은 실제입고수량을 0으로 단정하지 않고 발주서리스트 자체의 기존
 * receivedQuantity(I열)를 그대로 둔다(2026-09-12 dry-run에서 발견 — Stocked_Data_List는 특정
 * 조회기간 스냅샷 파일이라, 그 기간 밖에서 이미 입고된 PO+SKU까지 전부 0으로 덮으면 "이미 입고
 * 완료"가 "완전 미입고"로 잘못 뒤바뀐다. 실측: PO 135816369(입고예정일 2026-07-10)의 SKU
 * 57618238/57892854/58073609는 발주서리스트 I열에 이미 입고완료(2/2)로 기록돼 있는데, 9/9~9/11
 * 파일에는 당연히 안 잡혀서 0으로 덮으면 완전 미입고로 오판됨 — 이 사례로 확인). Stocked_Data_List에
 * 실적이 있는 조합만 "더 정확한 실측치"로 교체하고, 없는 조합은 기존 값을 신뢰한다.
 */
export function applyActualInboundHistory(
  orders: SupplierHubPurchaseOrder[],
  actualReceivedByKey: Map<string, number>
): ApplyActualInboundHistoryResult {
  const consumedKeys = new Set<string>();
  let matchedLineCount = 0;
  let unmatchedLineCount = 0;

  const nextOrders = orders.map(order => ({
    ...order,
    items: order.items.map(line => {
      const key = actualInboundHistoryKey(order.purchaseOrderNumber, line.productCode);
      const actual = actualReceivedByKey.get(key);
      if (actual === undefined) {
        unmatchedLineCount++;
        return line;
      }
      matchedLineCount++;
      consumedKeys.add(key);
      return { ...line, receivedQuantity: actual };
    }),
  }));

  const unmatchedActualKeys = [...actualReceivedByKey.keys()].filter(key => !consumedKeys.has(key));
  return { orders: nextOrders, unmatchedActualKeys, matchedLineCount, unmatchedLineCount };
}

/**
 * "이번에 읽은 입고상세내역 파일에 실제로 존재하는 조합만" 남긴 발주서 목록을 만든다.
 * (2026-09-12 발견·수정 — `applyActualInboundHistory`가 만드는 `orders`는 발주서리스트
 * 전체(수개월치 126개 PO)를 그대로 보존하고 이 파일에 없는 조합은 발주서리스트 자체 I열로
 * 채워두므로, "미납" 계산엔 맞지만 "1개입고 SKU"처럼 "이번 스캔에서 딱 1개 들어온 것"을 찾는
 * 용도로 그 orders를 그대로 재사용하면 이 파일과 무관한 과거 PO들의 입고수량=1 라인까지 전부
 * 섞여 들어온다 — 실측: 이 파일 자체의 발주번호+SKU 조합은 474건뿐인데
 * `computeSingleUnitInboundLines(mergedOrders, ...)`를 그대로 돌리면 938건이 나왔던 원인이 이것.
 * 이 함수로 "이번 파일에 실제 존재하는 조합"만 남겨서 넘기면, 그 이후 계산(예:
 * `computeSingleUnitInboundLines`)은 자동으로 이번 스캔 범위로만 좁혀진다 — 계산 로직 자체는
 * 그대로 재사용, 입력 범위만 좁힌다.
 */
export function filterOrdersToActualInboundKeys(
  orders: SupplierHubPurchaseOrder[],
  actualReceivedByKey: Map<string, number>
): SupplierHubPurchaseOrder[] {
  return orders
    .map(order => ({
      ...order,
      items: order.items
        .filter(line => actualReceivedByKey.has(actualInboundHistoryKey(order.purchaseOrderNumber, line.productCode)))
        .map(line => ({
          ...line,
          receivedQuantity: actualReceivedByKey.get(actualInboundHistoryKey(order.purchaseOrderNumber, line.productCode))!,
        })),
    }))
    .filter(order => order.items.length > 0);
}

/** 입고예정일(KST, "YYYY-MM-DD" 또는 "YYYY/MM/DD..." 접두) 문자열을 UTC epoch ms로 변환. 파싱 불가 시 null. */
function expectedDateToUtcMs(expectedDate: string): number | null {
  const match = expectedDate.match(/^(\d{4})[/-](\d{2})[/-](\d{2})/);
  if (!match) return null;
  const [, y, m, d] = match;
  // 입고예정일은 KST 기준 날짜 — 자정(KST) = UTC 전날 15시.
  return Date.UTC(Number(y), Number(m) - 1, Number(d)) - 9 * 60 * 60 * 1000;
}

/** 미납 확정 판정에 쓰는 유예시간 — 입고예정일 당일 스냅샷은 아직 처리 중일 수 있어 제외한다. */
const SHORTAGE_CONFIRMATION_BUFFER_MS = 24 * 60 * 60 * 1000;

/**
 * 이 발주번호의 "미납" 판정을 그대로 신뢰해도 되는지 — 입고예정일보다 최소 24시간 이상 지난
 * 뒤에 다시 확인된(재다운로드된) 발주서리스트 스냅샷이 있어야 "그 이후에도 재확인됐다"고 본다
 * (2026-09-12 dry-run 검증에서 확정한 기준). 그런 재확인 스냅샷이 아예 없으면 — 예: PO가
 * 생성 직후 딱 한 번만 다운로드되고 그 이후 한 번도 다시 확인된 적이 없으면 — 실제로는 이미
 * 입고됐을 수도 있는데 확인을 안 한 것뿐일 수 있으므로 "확인필요"로만 표시하고 자동 처리
 * 대상에서는 제외한다(임의로 미납 확정하지 않음).
 */
export function isShortageConfirmedByLatestSnapshot(
  expectedDate: string,
  latestSnapshotTimeMs: number | undefined
): boolean {
  if (latestSnapshotTimeMs === undefined) return false;
  const expectedMs = expectedDateToUtcMs(expectedDate);
  if (expectedMs === null) return false;
  return latestSnapshotTimeMs >= expectedMs + SHORTAGE_CONFIRMATION_BUFFER_MS;
}
