import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { SaxesParser, type SaxesTagPlain } from "saxes";
import {
  downloadDriveFile,
  isDriveReaderConfigured,
  listDriveFilesFromEnv,
  shouldRequireDriveReader,
} from "./google-drive-reader";
import {
  buildShipmentCreationUploadFile,
  formatMonthDay,
  groupRequestsByCenterAndDate,
  normalizeCenterName,
  type HanjinShipmentRequest,
  type ParsedTrackingRow,
} from "./hanjin-upload";
import { normalizeSkuId } from "./sku-normalize";
import type { PurchaseOrderSourceRecord } from "./purchase-order-source/types";

/**
 * "쉽먼트파일 생성" 자동화(2026-08-24 9차) — 사용자가 매번 파일을 직접 골라 올리던 2단계(운송장번호
 * 입력 파일 불러오기)를 없애고, 버튼 하나로 다음을 자동으로 한다:
 *   1) 한진택배 "재출력 세부내역"(운송장번호별 1행, 내품명1에 우리가 1단계에서 쓴 K열 문구가
 *      그대로 찍혀 있음)에서 발주번호↔운송장번호를 알아낸다.
 *   2) "발주서업로드완성" 폴더의 확정수량 입력 완료 파일(발주번호별 SKU 행 — 상품목록 시트에
 *      필요한 A~H 컬럼의 진짜 출처)에서 SKU 단위 행을 가져온다.
 *   3) 현재 웨이브의 (발주번호+물류센터+입고예정일)과 정확히 일치할 때만 두 데이터를 합쳐
 *      buildShipmentCreationUploadFile(1·3단계와 완전히 같은, 기존 로직 그대로)에 넘긴다.
 * 두 원본 파일 모두 표준 OOXML이 아니라(첫 조사 시 확인) ExcelJS로 못 여는 것과 여는 것이
 * 섞여 있다 — 재출력 세부내역은 일반 OOXML(ExcelJS로 열림), 확정수량 파일은 `x:` 네임스페이스 +
 * inlineStr 형식(hanjin-upload.ts가 이미 처리해온 것과 같은 패턴)이라 jszip+saxes로 직접 읽는다.
 */

const REPRINT_DETAIL_ENV = "GOOGLE_DRIVE_HANJIN_SHIPMENT_FOLDER_ID";
const REPRINT_DETAIL_LOCAL_DIR = process.env.WMS_HANJIN_SHIPMENT_DIR || "G:\\내 드라이브\\쿠팡데이터\\한진택배 송장파일";
const CONFIRMED_QUANTITY_ENV = "GOOGLE_DRIVE_PO_CONFIRMED_QUANTITY_FOLDER_ID";
const CONFIRMED_QUANTITY_LOCAL_DIR =
  process.env.WMS_PO_CONFIRMED_QUANTITY_DIR || "G:\\내 드라이브\\쿠팡데이터\\발주서업로드완성";

export interface ReprintDetailRow {
  trackingNumber: string;
  fulfillmentCenter: string;
  kLabel: string;
}

async function listMatchingDriveOrLocalFiles(
  envName: string,
  localDir: string,
  namePattern: RegExp
): Promise<{ name: string; buffer: Buffer }[]> {
  if (isDriveReaderConfigured() || shouldRequireDriveReader()) {
    const files = (await listDriveFilesFromEnv(envName))
      .filter(f => namePattern.test(f.name))
      .sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
    const results: { name: string; buffer: Buffer }[] = [];
    for (const file of files) results.push({ name: file.name, buffer: await downloadDriveFile(file.id) });
    return results;
  }

  let fileNames: string[];
  try {
    fileNames = (await readdir(localDir)).filter(name => namePattern.test(name));
  } catch {
    return [];
  }
  const withStat = await Promise.all(
    fileNames.map(async name => {
      const filePath = path.join(localDir, name);
      const fileStat = await stat(filePath);
      return { name, filePath, mtimeMs: fileStat.mtimeMs };
    })
  );
  withStat.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const results: { name: string; buffer: Buffer }[] = [];
  for (const file of withStat) results.push({ name: file.name, buffer: await readFile(file.filePath) });
  return results;
}

/** 재출력 세부내역 "상세내역" 시트를 헤더명 기준으로 읽는다 — 열 번호를 하드코딩하지 않는다.
 *  "받는분" 헤더가 보내는분/받는분 두 블록에 걸쳐 반복되므로, 1행(그룹 헤더)에서 "받는분" 블록을
 *  찾고 그 안에서 2행(세부 헤더) "이름"을 찾아 실제 열을 가려낸다. 필수 헤더(운송장번호/내품명1/
 *  받는분·이름)가 하나라도 없으면 null — 다른 파일에서 찾을 수도 있으니 조용히 건너뛴다. */
async function parseReprintDetailRowsFromBuffer(buffer: Buffer): Promise<ReprintDetailRow[] | null> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    return null;
  }
  const sheet = workbook.getWorksheet("상세내역") ?? workbook.worksheets[0];
  if (!sheet) return null;

  const header1: string[] = [];
  const header2: string[] = [];
  for (let c = 1; c <= sheet.columnCount; c++) {
    header1.push(String(sheet.getCell(1, c).value ?? "").trim());
    header2.push(String(sheet.getCell(2, c).value ?? "").trim());
  }

  const trackingCol = header1.indexOf("운송장번호") + 1;
  const kLabelCol = header1.indexOf("내품명1") + 1;
  const receiverBlockCols = header1.reduce<number[]>((acc, h, i) => {
    if (h === "받는분") acc.push(i + 1);
    return acc;
  }, []);
  const receiverNameCol = receiverBlockCols.find(col => header2[col - 1] === "이름") ?? -1;

  if (trackingCol === 0 || kLabelCol === 0 || receiverNameCol === -1) return null;

  const rows: ReprintDetailRow[] = [];
  for (let r = 3; r <= sheet.rowCount; r++) {
    const trackingNumber = String(sheet.getCell(r, trackingCol).value ?? "").trim();
    const kLabel = String(sheet.getCell(r, kLabelCol).value ?? "").trim();
    if (!trackingNumber && !kLabel) continue;
    const recipientRaw = String(sheet.getCell(r, receiverNameCol).value ?? "").trim();
    const centerMatch = recipientRaw.match(/^로켓배송\*(.+)$/);
    rows.push({ trackingNumber, fulfillmentCenter: centerMatch ? centerMatch[1] : recipientRaw, kLabel });
  }
  return rows;
}

async function loadReprintDetailRows(): Promise<{ rows: ReprintDetailRow[]; fileNames: string[] }> {
  const files = await listMatchingDriveOrLocalFiles(REPRINT_DETAIL_ENV, REPRINT_DETAIL_LOCAL_DIR, /^재출력_세부내역_.*\.xlsx$/i);
  const rows: ReprintDetailRow[] = [];
  const fileNames: string[] = [];
  for (const file of files) {
    const parsed = await parseReprintDetailRowsFromBuffer(file.buffer);
    if (!parsed) continue;
    rows.push(...parsed);
    fileNames.push(file.name);
  }
  return { rows, fileNames };
}

function indexReprintRowsByPurchaseOrder(rows: ReprintDetailRow[]) {
  const result = new Map<string, { trackingNumber: string; fulfillmentCenter: string; monthDayText: string }[]>();
  for (const row of rows) {
    const parsed = parseShipmentLabel(row.kLabel);
    if (!parsed) continue;
    for (const po of parsed.purchaseOrderNumbers) {
      const key = normalizeSkuId(po);
      if (!result.has(key)) result.set(key, []);
      result.get(key)!.push({ trackingNumber: row.trackingNumber, fulfillmentCenter: parsed.fulfillmentCenter, monthDayText: parsed.monthDayText });
    }
  }
  return result;
}

export interface AutoShipmentTrackingPreview {
  requestedPurchaseOrderCount: number;
  matchedPurchaseOrderCount: number;
  missingPurchaseOrderNumbers: string[];
  conflictPurchaseOrderNumbers: string[];
  canGenerate: boolean;
}

/** 현재 generation의 PO 집합만 운송장 원본과 대조한다. 웨이브의 다른 PO는 검사하지 않는다. */
export function inspectAutoShipmentTrackingRows(requests: HanjinShipmentRequest[], rows: ReprintDetailRow[]): AutoShipmentTrackingPreview {
  const uniqueRequests = [...new Map(requests.map(request => [normalizeSkuId(request.purchaseOrderNumber), request])).values()];
  const reprintByPo = indexReprintRowsByPurchaseOrder(rows);
  const matched: string[] = [];
  const missing: string[] = [];
  const conflicts: string[] = [];

  for (const request of uniqueRequests) {
    const po = normalizeSkuId(request.purchaseOrderNumber);
    const exactMatches = (reprintByPo.get(po) || []).filter(entry =>
      normalizeCenterName(entry.fulfillmentCenter) === normalizeCenterName(request.fulfillmentCenter)
      && entry.monthDayText === formatMonthDay(request.expectedDate)
      && Boolean(entry.trackingNumber)
    );
    const trackingNumbers = new Set(exactMatches.map(entry => entry.trackingNumber));
    if (trackingNumbers.size === 1) matched.push(po);
    else if (trackingNumbers.size > 1) conflicts.push(po);
    else missing.push(po);
  }

  return {
    requestedPurchaseOrderCount: uniqueRequests.length,
    matchedPurchaseOrderCount: matched.length,
    missingPurchaseOrderNumbers: missing,
    conflictPurchaseOrderNumbers: conflicts,
    canGenerate: uniqueRequests.length > 0 && missing.length === 0 && conflicts.length === 0,
  };
}

export async function inspectAutoShipmentTracking(requests: HanjinShipmentRequest[]): Promise<AutoShipmentTrackingPreview> {
  const reprint = await loadReprintDetailRows();
  return inspectAutoShipmentTrackingRows(requests, reprint.rows);
}

/** 우리가 1단계에서 buildShipmentLabel로 만든 K열 문구를 되읽어 물류센터/입고예정일 표시문구/
 *  발주번호(들)로 되돌린다. 한 줄 형식("... / 발주서 번호 A, B")과 너무 길어 두 줄로 나뉜 형식
 *  ("...\n발주서 번호 A / B")을 둘 다 지원한다(구분자가 다르다 — 실제 buildShipmentLabel 규칙
 *  그대로). 형식을 못 알아보면 null(추측 금지). */
function parseShipmentLabel(kLabel: string): { fulfillmentCenter: string; monthDayText: string; purchaseOrderNumbers: string[] } | null {
  const lines = kLabel.split("\n").map(line => line.trim());
  const firstLineMatch = lines[0]?.match(/^(.+?)\s*\/\s*(\d+월\d+일)(?:\s*\/\s*발주서\s*번호\s*(.+))?$/);
  if (!firstLineMatch) return null;
  const [, fulfillmentCenter, monthDayText, inlinePoText] = firstLineMatch;

  let poText: string | null = inlinePoText ?? null;
  if (!poText && lines[1]) {
    const secondLineMatch = lines[1].match(/^발주서\s*번호\s*(.+)$/);
    if (secondLineMatch) poText = secondLineMatch[1];
  }
  if (!poText) return null;

  const separator = inlinePoText ? /,\s*/ : /\s*\/\s*/;
  const purchaseOrderNumbers = poText
    .split(separator)
    .map(token => token.trim())
    .filter(token => /^\d+$/.test(token));
  if (purchaseOrderNumbers.length === 0) return null;

  return { fulfillmentCenter: fulfillmentCenter.trim(), monthDayText, purchaseOrderNumbers };
}

/** "발주서업로드완성" 폴더의 확정수량 입력 완료 파일(`x:` 네임스페이스 + inlineStr, ExcelJS로
 *  못 여는 형식 — hanjin-upload.ts가 다뤄온 것과 같은 패턴)을 헤더명 기준으로 읽는다. 열 번호를
 *  하드코딩하지 않고, 1행에서 "발주번호/물류센터/입고유형/상품번호/상품바코드/상품이름/확정수량/
 *  입고예정일" 텍스트를 찾아 실제 열을 가려낸다 — 하나라도 없으면 null. "납품수량"은 별도
 *  컬럼이 없어, 확정수량 값을 그대로 쓴다("최종 출고수량" = 확정수량 규칙, 실제 한진 결과
 *  샘플에서도 두 값이 항상 같았다). */
async function parseConfirmedQuantityRowsFromBuffer(buffer: Buffer): Promise<ParsedTrackingRow[] | null> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return null;
  }
  const sheetEntry = zip.file("xl/worksheets/sheet1.xml");
  if (!sheetEntry) return null;
  const sheetXml = await sheetEntry.async("string");

  const rowsByIndex = new Map<number, Record<string, string>>();
  const parser = new SaxesParser();
  let currentRowCells: Record<string, string> = {};
  let currentRowIndex = 0;
  let currentCellRef: string | null = null;
  let insideValue = false;
  let insideInline = false;
  let currentText = "";

  parser.on("opentag", (node: SaxesTagPlain) => {
    if (node.name === "x:row") {
      currentRowCells = {};
      currentRowIndex = Number(node.attributes.r as string);
    } else if (node.name === "x:c") {
      currentCellRef = (node.attributes.r as string) || null;
      currentText = "";
    } else if (node.name === "x:v") {
      insideValue = true;
      currentText = "";
    } else if (node.name === "x:t") {
      insideInline = true;
      currentText = "";
    }
  });
  parser.on("text", (text: string) => {
    if (insideValue || insideInline) currentText += text;
  });
  parser.on("closetag", (node: SaxesTagPlain) => {
    if (node.name === "x:v") {
      insideValue = false;
      if (currentCellRef) currentRowCells[currentCellRef] = currentText;
    } else if (node.name === "x:t") {
      insideInline = false;
      if (currentCellRef) currentRowCells[currentCellRef] = (currentRowCells[currentCellRef] || "") + currentText;
    } else if (node.name === "x:row") {
      rowsByIndex.set(currentRowIndex, { ...currentRowCells });
    }
  });
  parser.write(sheetXml).close();

  const header = rowsByIndex.get(1);
  if (!header) return null;
  const colOf = (name: string): string | null => {
    for (const [ref, value] of Object.entries(header)) {
      if (value === name) {
        const match = ref.match(/^([A-Z]+)\d+$/);
        return match ? match[1] : null;
      }
    }
    return null;
  };
  const colPo = colOf("발주번호");
  const colFc = colOf("물류센터");
  const colType = colOf("입고유형");
  const colSku = colOf("상품번호");
  const colBarcode = colOf("상품바코드");
  const colName = colOf("상품이름");
  const colQty = colOf("확정수량");
  const colDate = colOf("입고예정일");
  if (!colPo || !colFc || !colType || !colSku || !colBarcode || !colName || !colQty || !colDate) return null;

  const rows: ParsedTrackingRow[] = [];
  const maxRow = Math.max(0, ...rowsByIndex.keys());
  for (let r = 2; r <= maxRow; r++) {
    const row = rowsByIndex.get(r);
    if (!row) continue;
    const purchaseOrderNumber = row[colPo + r] || "";
    if (!purchaseOrderNumber) continue;
    const confirmedQuantity = row[colQty + r] || "";
    rows.push({
      purchaseOrderNumber,
      fulfillmentCenter: row[colFc + r] || "",
      transportType: row[colType + r] || "",
      expectedDate: row[colDate + r] || "",
      skuId: row[colSku + r] || "",
      barcode: row[colBarcode + r] || "",
      productName: row[colName + r] || "",
      confirmedQuantity,
      trackingNumber: "",
      shippedQuantity: confirmedQuantity,
    });
  }
  return rows;
}

async function loadConfirmedQuantityRows(): Promise<{ rows: ParsedTrackingRow[]; fileNames: string[] }> {
  const files = await listMatchingDriveOrLocalFiles(CONFIRMED_QUANTITY_ENV, CONFIRMED_QUANTITY_LOCAL_DIR, /^PO_FOR_CONFIRM.*\.xlsx$/i);
  const rows: ParsedTrackingRow[] = [];
  const fileNames: string[] = [];
  for (const file of files) {
    const parsed = await parseConfirmedQuantityRowsFromBuffer(file.buffer);
    if (!parsed) continue;
    rows.push(...parsed);
    fileNames.push(file.name);
  }
  return { rows, fileNames };
}

export class AutoShipmentBlockedError extends Error {
  reasons: string[];
  constructor(reasons: string[]) {
    super(reasons.join(" | "));
    this.name = "AutoShipmentBlockedError";
    this.reasons = reasons;
  }
}

export interface AutoShipmentResult {
  buffer: Buffer;
  includedCount: number;
  includedPurchaseOrderNumbers: string[];
  trackingNumbersUsed: string[];
  reprintFileNames: string[];
  confirmedQuantityFileNames: string[];
}

export function findTrackingNumbersReusedAcrossShippingGroups(rows: readonly ParsedTrackingRow[]): string[] {
  const shippingKeysByTracking = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.trackingNumber) continue;
    const shippingKey = `${normalizeCenterName(row.fulfillmentCenter)}::${row.expectedDate.replace(/\D/g, "")}`;
    const keys = shippingKeysByTracking.get(row.trackingNumber) || new Set<string>();
    keys.add(shippingKey);
    shippingKeysByTracking.set(row.trackingNumber, keys);
  }
  return [...shippingKeysByTracking.entries()].filter(([, keys]) => keys.size > 1).map(([trackingNumber]) => trackingNumber);
}

/** 웨이브의 (발주번호+물류센터+입고예정일)마다: (1) 확정수량 파일에서 SKU 행을 찾고, (2) 재출력
 *  세부내역에서 운송장번호를 찾아, 물류센터·입고예정일까지 전부 정확히 일치할 때만 합친다.
 *  하나라도 어긋나면 그 사유를 모아 AutoShipmentBlockedError로 던지고, 전체 생성을 만들지 않는다
 *  (부분 생성 금지 — 발주번호가 여러 개인 합배송 그룹은 grouping.ts가 아니라 여기서도
 *  groupRequestsByCenterAndDate를 그대로 재사용해 결정하므로 절대 재분리되지 않는다). 최종
 *  파일은 buildShipmentCreationUploadFile(기존 3단계 로직 그대로, 수정 없음)로 만든다. */
export async function buildAutoShipmentFile(
  requests: HanjinShipmentRequest[],
  sourceRecords: PurchaseOrderSourceRecord[],
  templateBuffer?: Buffer
): Promise<AutoShipmentResult> {
  const groups = groupRequestsByCenterAndDate(requests);

  const reprint = await loadReprintDetailRows();
  if (reprint.rows.length === 0) {
    throw new AutoShipmentBlockedError(["현재 웨이브와 일치하는 재출력 파일을 찾지 못했습니다."]);
  }

  const confirmedByPo = new Map<string, ParsedTrackingRow[]>();
  for (const source of sourceRecords) {
    const row: ParsedTrackingRow = {
      purchaseOrderNumber: source.purchaseOrderNumber,
      fulfillmentCenter: source.fulfillmentCenterName,
      transportType: "쉽먼트",
      expectedDate: source.expectedArrivalDate,
      skuId: source.skuId,
      barcode: source.barcode,
      productName: source.optionName ? `${source.productName}, ${source.optionName}` : source.productName,
      confirmedQuantity: String(source.orderedQuantity),
      trackingNumber: "",
      shippedQuantity: String(source.orderedQuantity),
    };
    const key = normalizeSkuId(row.purchaseOrderNumber);
    if (!confirmedByPo.has(key)) confirmedByPo.set(key, []);
    confirmedByPo.get(key)!.push(row);
  }

  const reprintByPo = indexReprintRowsByPurchaseOrder(reprint.rows);

  const blockingReasons: string[] = [];
  const resolvedRows: ParsedTrackingRow[] = [];
  const trackingNumbersUsed = new Set<string>();

  for (const group of groups) {
    const expectedMonthDay = formatMonthDay(group.expectedDate);
    const expectedDateDigits = group.expectedDate.replace(/[^\d]/g, "");
    const groupTrackingNumbers = new Set<string>();

    for (const po of group.purchaseOrderNumbers) {
      const key = normalizeSkuId(po);

      const confirmedRows = confirmedByPo.get(key) || [];
      if (confirmedRows.length === 0) {
        blockingReasons.push(`현재 선택 발주번호가 발주서 원본에 없습니다: ${po}(${group.fulfillmentCenter})`);
        continue;
      }
      if (confirmedRows.some(row => normalizeCenterName(row.fulfillmentCenter) !== normalizeCenterName(group.fulfillmentCenter))) {
        blockingReasons.push(
          `물류센터 불일치(발주서 원본) — 발주번호 ${po}: 웨이브=${group.fulfillmentCenter}, 원본=${[...new Set(confirmedRows.map(r => r.fulfillmentCenter))].join(", ")}`
        );
        continue;
      }
      if (confirmedRows.some(row => row.expectedDate.replace(/[^\d]/g, "") !== expectedDateDigits)) {
        blockingReasons.push(
          `입고예정일 불일치(발주서 원본) — 발주번호 ${po}: 웨이브=${group.expectedDate}, 원본=${[...new Set(confirmedRows.map(r => r.expectedDate))].join(", ")}`
        );
        continue;
      }

      const reprintEntries = reprintByPo.get(key) || [];
      if (reprintEntries.length === 0) {
        blockingReasons.push(`송장번호가 없는 발주번호: ${po}(${group.fulfillmentCenter}) — 재출력 파일에서 찾지 못했습니다.`);
        continue;
      }
      const exactMatches = reprintEntries.filter(
        entry => normalizeCenterName(entry.fulfillmentCenter) === normalizeCenterName(group.fulfillmentCenter) && entry.monthDayText === expectedMonthDay
      );
      if (exactMatches.length === 0) {
        const centerMismatch = reprintEntries.some(entry => normalizeCenterName(entry.fulfillmentCenter) !== normalizeCenterName(group.fulfillmentCenter));
        const dateMismatch = reprintEntries.some(entry => entry.monthDayText !== expectedMonthDay);
        if (centerMismatch) {
          blockingReasons.push(
            `물류센터 불일치(재출력 파일) — 발주번호 ${po}: 웨이브=${group.fulfillmentCenter}, 파일=${[...new Set(reprintEntries.map(e => e.fulfillmentCenter))].join(", ")}`
          );
        }
        if (dateMismatch) {
          blockingReasons.push(
            `입고예정일 불일치(재출력 파일) — 발주번호 ${po}: 웨이브=${expectedMonthDay}, 파일=${[...new Set(reprintEntries.map(e => e.monthDayText))].join(", ")}`
          );
        }
        if (!centerMismatch && !dateMismatch) {
          blockingReasons.push(`송장번호가 없는 발주번호: ${po}(${group.fulfillmentCenter})`);
        }
        continue;
      }

      const trackingSet = new Set(exactMatches.map(entry => entry.trackingNumber).filter(Boolean));
      if (trackingSet.size > 1) {
        blockingReasons.push(`동일 발주번호에 서로 다른 운송장번호가 있습니다: ${po} → ${[...trackingSet].join(", ")}`);
        continue;
      }
      const trackingNumber = [...trackingSet][0];
      if (!trackingNumber) {
        blockingReasons.push(`송장번호가 없는 발주번호: ${po}(${group.fulfillmentCenter})`);
        continue;
      }

      groupTrackingNumbers.add(trackingNumber);
      trackingNumbersUsed.add(trackingNumber);
      for (const row of confirmedRows) resolvedRows.push({ ...row, trackingNumber });
    }

    if (groupTrackingNumbers.size > 1) {
      blockingReasons.push(
        `같은 운송장으로 합배송된 발주번호끼리 운송장번호가 다릅니다: ${group.fulfillmentCenter} ${group.purchaseOrderNumbers.join(", ")} → ${[...groupTrackingNumbers].join(", ")}`
      );
    }
  }

  if (blockingReasons.length > 0) {
    throw new AutoShipmentBlockedError(blockingReasons);
  }

  const reusedAcrossGroups = findTrackingNumbersReusedAcrossShippingGroups(resolvedRows);
  if (reusedAcrossGroups.length > 0) {
    throw new AutoShipmentBlockedError(reusedAcrossGroups.map(trackingNumber =>
      `서로 다른 물류센터/입고예정일에 같은 운송장번호가 연결되어 생성을 차단했습니다: ${trackingNumber}`
    ));
  }

  const expectedPoSet = new Set(requests.map(request => normalizeSkuId(request.purchaseOrderNumber)));
  const resolvedPoSet = new Set(resolvedRows.map(row => normalizeSkuId(row.purchaseOrderNumber)));
  if (expectedPoSet.size !== resolvedPoSet.size || [...expectedPoSet].some(po => !resolvedPoSet.has(po))) {
    throw new AutoShipmentBlockedError(["generation 발주번호 집합과 Shipment 출력 발주번호 집합이 일치하지 않습니다."]);
  }

  const targets = requests.map(r => ({ purchaseOrderNumber: r.purchaseOrderNumber, fulfillmentCenter: r.fulfillmentCenter }));
  const result = await buildShipmentCreationUploadFile(resolvedRows, targets, templateBuffer);

  return {
    buffer: result.buffer,
    includedCount: result.includedCount,
    includedPurchaseOrderNumbers: [...resolvedPoSet].sort(),
    trackingNumbersUsed: [...trackingNumbersUsed],
    reprintFileNames: reprint.fileNames,
    confirmedQuantityFileNames: [...new Set(sourceRecords.map(record => record.sourceContainerFile))],
  };
}
