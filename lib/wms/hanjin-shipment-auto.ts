import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
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
import type { PickingWaveStoreSnapshot } from "./picking-wave/shared-store-types";
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
 * 재출력 세부내역과 앱이 다시 저장한 확정수량 파일은 ExcelJS로 읽고, 헤더명으로 실제 열을 찾는다.
 * 파일 선택은 저장된 정확한 파일명으로만 하며 최신 파일을 임의로 고르지 않는다.
 */

const REPRINT_DETAIL_ENV = "GOOGLE_DRIVE_HANJIN_SHIPMENT_FOLDER_ID";
const REPRINT_DETAIL_LOCAL_DIR = process.env.WMS_HANJIN_SHIPMENT_DIR || "G:\\내 드라이브\\쿠팡데이터\\한진택배 송장파일";
// 기존 운영 배포에는 같은 발주확정 완료 폴더가 이전 이름으로 연결돼 있다. 한진 결과파일은
// 위의 전용 폴더만 사용하고, 확정수량 원본만 두 이름 중 실제 연결된 쪽을 읽는다.
const CONFIRMED_QUANTITY_ENV = process.env.GOOGLE_DRIVE_PO_CONFIRMED_QUANTITY_FOLDER_ID?.trim()
  ? "GOOGLE_DRIVE_PO_CONFIRMED_QUANTITY_FOLDER_ID"
  : "GOOGLE_DRIVE_CONFIRMED_ORDER_FOLDER_ID";
const CONFIRMED_QUANTITY_LOCAL_DIR =
  process.env.WMS_PO_CONFIRMED_QUANTITY_DIR || "G:\\내 드라이브\\쿠팡데이터\\발주서업로드완성";

function normalizedFileName(value: string): string {
  return value.trim().normalize("NFC");
}

export interface ReprintDetailRow {
  trackingNumber: string;
  fulfillmentCenter: string;
  kLabel: string;
}

async function listMatchingDriveOrLocalFiles(
  envName: string,
  localDir: string,
  namePattern: RegExp,
  exactNames?: ReadonlySet<string>,
): Promise<{ name: string; buffer: Buffer; modifiedTime: string }[]> {
  if (isDriveReaderConfigured() || shouldRequireDriveReader()) {
    const files = (await listDriveFilesFromEnv(envName))
      .filter(f => namePattern.test(f.name) && (!exactNames || exactNames.has(normalizedFileName(f.name))))
      .sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
    const results: { name: string; buffer: Buffer; modifiedTime: string }[] = [];
    for (const file of files) results.push({ name: file.name, buffer: await downloadDriveFile(file.id), modifiedTime: file.modifiedTime });
    return results;
  }

  let fileNames: string[];
  try {
    fileNames = (await readdir(localDir)).filter(name => namePattern.test(name) && (!exactNames || exactNames.has(normalizedFileName(name))));
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
  const results: { name: string; buffer: Buffer; modifiedTime: string }[] = [];
  for (const file of withStat) results.push({ name: file.name, buffer: await readFile(file.filePath), modifiedTime: new Date(file.mtimeMs).toISOString() });
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

interface ReprintDetailFile {
  name: string;
  modifiedTime: string;
  rows: ReprintDetailRow[];
}

async function loadReprintDetailFiles(): Promise<ReprintDetailFile[]> {
  const files = await listMatchingDriveOrLocalFiles(REPRINT_DETAIL_ENV, REPRINT_DETAIL_LOCAL_DIR, /^재출력_세부내역_.*\.xlsx$/i);
  const parsedFiles: ReprintDetailFile[] = [];
  for (const file of files) {
    const parsed = await parseReprintDetailRowsFromBuffer(file.buffer);
    if (!parsed) continue;
    parsedFiles.push({ name: file.name, modifiedTime: file.modifiedTime, rows: parsed });
  }
  return parsedFiles;
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
  candidateFiles?: AutoShipmentTrackingCandidate[];
  selectedReprintFileName?: string;
  selectionRequired?: boolean;
  canGenerate: boolean;
}

export interface AutoShipmentTrackingCandidate {
  fileName: string;
  modifiedTime?: string;
  matchedPurchaseOrderCount: number;
  missingPurchaseOrderNumbers: string[];
  conflictPurchaseOrderNumbers: string[];
  unexpectedPurchaseOrderNumbers: string[];
  exactMatch: boolean;
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
  const files = await loadReprintDetailFiles();
  const candidates = files.map(file => inspectAutoShipmentTrackingCandidate(requests, file.name, file.rows, file.modifiedTime));
  const exactCandidates = candidates.filter(candidate => candidate.exactMatch);
  const selected = exactCandidates.length === 1 ? exactCandidates[0] : undefined;
  const best = selected ?? [...candidates].sort((a, b) =>
    b.matchedPurchaseOrderCount - a.matchedPurchaseOrderCount
    || a.missingPurchaseOrderNumbers.length - b.missingPurchaseOrderNumbers.length
    || a.unexpectedPurchaseOrderNumbers.length - b.unexpectedPurchaseOrderNumbers.length
  )[0];

  return {
    requestedPurchaseOrderCount: new Set(requests.map(request => normalizeSkuId(request.purchaseOrderNumber))).size,
    matchedPurchaseOrderCount: best?.matchedPurchaseOrderCount ?? 0,
    missingPurchaseOrderNumbers: best?.missingPurchaseOrderNumbers ?? requests.map(request => normalizeSkuId(request.purchaseOrderNumber)),
    conflictPurchaseOrderNumbers: best?.conflictPurchaseOrderNumbers ?? [],
    candidateFiles: candidates,
    selectedReprintFileName: selected?.fileName,
    selectionRequired: exactCandidates.length > 1,
    canGenerate: Boolean(selected),
  };
}

export function inspectAutoShipmentTrackingCandidate(
  requests: HanjinShipmentRequest[],
  fileName: string,
  rows: ReprintDetailRow[],
  modifiedTime?: string
): AutoShipmentTrackingCandidate {
  const preview = inspectAutoShipmentTrackingRows(requests, rows);
  const requestedPoSet = new Set(requests.map(request => normalizeSkuId(request.purchaseOrderNumber)));
  const filePoSet = new Set<string>();
  for (const row of rows) {
    const parsed = parseShipmentLabel(row.kLabel);
    for (const po of parsed?.purchaseOrderNumbers ?? []) filePoSet.add(normalizeSkuId(po));
  }
  const unexpectedPurchaseOrderNumbers = [...filePoSet].filter(po => !requestedPoSet.has(po)).sort();
  return {
    fileName,
    modifiedTime,
    matchedPurchaseOrderCount: preview.matchedPurchaseOrderCount,
    missingPurchaseOrderNumbers: preview.missingPurchaseOrderNumbers,
    conflictPurchaseOrderNumbers: preview.conflictPurchaseOrderNumbers,
    unexpectedPurchaseOrderNumbers,
    exactMatch: preview.canGenerate && unexpectedPurchaseOrderNumbers.length === 0 && filePoSet.size === requestedPoSet.size,
  };
}

function selectExactReprintFile(
  requests: HanjinShipmentRequest[],
  files: ReprintDetailFile[],
  selectedFileName?: string
): ReprintDetailFile {
  const candidates = files.map(file => ({ file, preview: inspectAutoShipmentTrackingCandidate(requests, file.name, file.rows, file.modifiedTime) }));
  const exact = candidates.filter(candidate => candidate.preview.exactMatch);
  if (selectedFileName) {
    const selected = candidates.find(candidate => candidate.file.name === selectedFileName);
    if (!selected) throw new AutoShipmentBlockedError([`선택한 한진 결과파일을 찾지 못했습니다: ${selectedFileName}`]);
    if (!selected.preview.exactMatch) {
      throw new AutoShipmentBlockedError([`선택한 한진 결과파일의 발주번호 집합이 현재 묶음과 정확히 일치하지 않습니다: ${selectedFileName}`]);
    }
    return selected.file;
  }
  if (exact.length === 1) return exact[0].file;
  if (exact.length > 1) {
    throw new AutoShipmentBlockedError([`정확히 일치하는 한진 결과파일이 ${exact.length}개입니다. 화면에서 사용할 파일을 선택해 주세요.`]);
  }
  const best = [...candidates].sort((a, b) => b.preview.matchedPurchaseOrderCount - a.preview.matchedPurchaseOrderCount)[0]?.preview;
  const detail = best
    ? `${best.fileName} (일치 ${best.matchedPurchaseOrderCount}, 누락 ${best.missingPurchaseOrderNumbers.length}, 다른 발주 ${best.unexpectedPurchaseOrderNumbers.length})`
    : "후보 없음";
  throw new AutoShipmentBlockedError([`현재 묶음의 발주번호 집합과 정확히 일치하는 한진 결과파일이 없습니다. 가장 가까운 후보: ${detail}`]);
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

export interface ConfirmedQuantitySourceRow extends ParsedTrackingRow {
  orderedQuantity: string;
}

export interface ConfirmedQuantitySourceFile {
  name: string;
  modifiedTime?: string;
  rows: ConfirmedQuantitySourceRow[] | null;
}

const CONFIRMED_QUANTITY_HEADERS = {
  purchaseOrderNumber: "발주번호",
  fulfillmentCenter: "물류센터",
  transportType: "입고유형",
  skuId: "상품번호",
  barcode: "상품바코드",
  productName: "상품이름",
  orderedQuantity: "발주수량",
  confirmedQuantity: "확정수량",
  expectedDate: "입고예정일",
} as const;

/** 앱이 만든 PO_FOR_CONFIRM 확정파일을 헤더명으로 다시 읽는다. 파일의 SKU/수량은 아래의
 *  발주서리스트다운 원본 대조를 통과하기 전까지 신뢰하지 않는다. */
export async function parseConfirmedQuantityRowsFromBuffer(buffer: Buffer): Promise<ConfirmedQuantitySourceRow[] | null> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    return null;
  }
  const sheet = workbook.getWorksheet("상품목록") ?? workbook.worksheets[0];
  if (!sheet) return null;

  const requiredHeaders = Object.values(CONFIRMED_QUANTITY_HEADERS);
  let headerRowNumber = 0;
  let columns = new Map<string, number>();
  for (let rowNumber = 1; rowNumber <= Math.min(10, sheet.rowCount); rowNumber += 1) {
    const candidate = new Map<string, number>();
    sheet.getRow(rowNumber).eachCell((cell, column) => candidate.set(cell.text.trim(), column));
    if (requiredHeaders.every(header => candidate.has(header))) {
      headerRowNumber = rowNumber;
      columns = candidate;
      break;
    }
  }
  if (!headerRowNumber) return null;

  const textAt = (rowNumber: number, header: string) => sheet.getCell(rowNumber, columns.get(header)!).text.trim();
  const rows: ConfirmedQuantitySourceRow[] = [];
  for (let rowNumber = headerRowNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const purchaseOrderNumber = textAt(rowNumber, CONFIRMED_QUANTITY_HEADERS.purchaseOrderNumber);
    if (!purchaseOrderNumber) continue;
    const confirmedQuantity = textAt(rowNumber, CONFIRMED_QUANTITY_HEADERS.confirmedQuantity);
    rows.push({
      purchaseOrderNumber,
      fulfillmentCenter: textAt(rowNumber, CONFIRMED_QUANTITY_HEADERS.fulfillmentCenter),
      transportType: textAt(rowNumber, CONFIRMED_QUANTITY_HEADERS.transportType),
      expectedDate: textAt(rowNumber, CONFIRMED_QUANTITY_HEADERS.expectedDate),
      skuId: textAt(rowNumber, CONFIRMED_QUANTITY_HEADERS.skuId),
      barcode: textAt(rowNumber, CONFIRMED_QUANTITY_HEADERS.barcode),
      productName: textAt(rowNumber, CONFIRMED_QUANTITY_HEADERS.productName),
      orderedQuantity: textAt(rowNumber, CONFIRMED_QUANTITY_HEADERS.orderedQuantity),
      confirmedQuantity,
      trackingNumber: "",
      shippedQuantity: confirmedQuantity,
    });
  }
  return rows;
}

async function loadConfirmedQuantityFiles(expectedFileNames: readonly string[]): Promise<ConfirmedQuantitySourceFile[]> {
  const exactNames = new Set(expectedFileNames.map(normalizedFileName).filter(Boolean));
  const files = await listMatchingDriveOrLocalFiles(
    CONFIRMED_QUANTITY_ENV,
    CONFIRMED_QUANTITY_LOCAL_DIR,
    /^PO_FOR_CONFIRM.*\.xlsx$/i,
    exactNames,
  );
  return Promise.all(files.map(async file => ({
    name: file.name,
    modifiedTime: file.modifiedTime,
    rows: await parseConfirmedQuantityRowsFromBuffer(file.buffer),
  })));
}

export class AutoShipmentBlockedError extends Error {
  reasons: string[];
  constructor(reasons: string[]) {
    super(reasons.join(" | "));
    this.name = "AutoShipmentBlockedError";
    this.reasons = reasons;
  }
}

export function resolveStoredAutoShipmentGeneration(
  snapshot: Pick<PickingWaveStoreSnapshot, "waves" | "shipments" | "poConfirmationRecords">,
  ownerId: string,
  generationId: string,
  requestedPurchaseOrderNumbers: readonly string[],
): { purchaseOrderNumbers: string[]; confirmedQuantityFileNameByPo: Record<string, string> } {
  const normalizedOwnerId = ownerId.trim();
  const normalizedGenerationId = generationId.trim();
  const requested = requestedPurchaseOrderNumbers.map(normalizeSkuId).filter(Boolean);
  const requestedSet = new Set(requested);
  const candidates = [
    snapshot.waves.find(wave => wave.id === normalizedOwnerId)?.outputGenerations?.find(generation => generation.generationId === normalizedGenerationId),
    snapshot.shipments.find(shipment => shipment.id === normalizedOwnerId && shipment.outputGeneration?.generationId === normalizedGenerationId)?.outputGeneration,
  ].filter((generation): generation is NonNullable<typeof generation> => Boolean(generation));

  const reasons: string[] = [];
  if (!normalizedOwnerId || !normalizedGenerationId) reasons.push("Shipment 묶음 식별값이 없습니다.");
  if (requested.length === 0 || requestedSet.size !== requested.length) reasons.push("요청 발주번호가 비어 있거나 중복됐습니다.");
  if (candidates.length !== 1) {
    reasons.push(candidates.length === 0
      ? "공용 저장소에서 현재 Shipment 묶음을 찾지 못했습니다. 화면을 새로고침해 주세요."
      : "같은 Shipment 묶음 식별값이 중복되어 생성을 차단했습니다.");
  }
  const generation = candidates[0];
  const stored = generation?.purchaseOrderNumbers.map(normalizeSkuId).filter(Boolean) || [];
  const storedSet = new Set(stored);
  if (generation && (stored.length === 0 || storedSet.size !== stored.length)) reasons.push("저장된 Shipment 묶음의 발주번호가 비어 있거나 중복됐습니다.");
  if (generation && (storedSet.size !== requestedSet.size || [...storedSet].some(po => !requestedSet.has(po)))) {
    reasons.push("공용 저장소의 Shipment 묶음과 요청 발주번호 집합이 정확히 일치하지 않습니다.");
  }

  const confirmedQuantityFileNameByPo: Record<string, string> = {};
  for (const po of stored) {
    const records = snapshot.poConfirmationRecords.filter(record => normalizeSkuId(record.poNumber) === po);
    if (records.length !== 1) {
      reasons.push(records.length === 0
        ? `발주번호 ${po}: 발주확정 파일 연결 기록이 없습니다.`
        : `발주번호 ${po}: 발주확정 파일 연결 기록이 중복됐습니다.`);
      continue;
    }
    const record = records[0];
    // stage는 쿠팡에서 실제 승인됐는지의 별도 상태다. 여기서는 수량 원본을 특정하는
    // generatedFileName과 원본 검사 메타데이터만 사용하고, stage를 생성 완료로 바꾸지 않는다.
    const fileName = normalizedFileName(record.generatedFileName || "");
    if (!fileName) reasons.push(`발주번호 ${po}: 생성한 발주확정 파일명이 저장되어 있지 않습니다.`);
    if (!record.sourceFileHash || record.selectedRowCount <= 0) reasons.push(`발주번호 ${po}: 발주확정 원본 검사 정보가 없어 생성을 차단했습니다.`);
    if (fileName) confirmedQuantityFileNameByPo[po] = fileName;
  }

  if (reasons.length > 0) throw new AutoShipmentBlockedError([...new Set(reasons)]);
  return { purchaseOrderNumbers: generation!.purchaseOrderNumbers, confirmedQuantityFileNameByPo };
}

function nonNegativeInteger(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function comparableDate(value: string): string {
  return value.replace(/\D/g, "");
}

/** 각 발주가 저장 상태에 기록한 정확한 확정파일만 사용하고, 그 파일의 모든 PO+SKU를 현재
 *  발주서리스트다운 인덱스와 대조한다. 파일명이 없거나 같은 이름이 둘이거나 SKU/원수량이
 *  조금이라도 다르면 임의 선택·보정 없이 전체를 차단한다. */
export function resolveConfirmedQuantityRowsForShipment(
  requests: readonly HanjinShipmentRequest[],
  sourceRecords: readonly PurchaseOrderSourceRecord[],
  confirmedFiles: readonly ConfirmedQuantitySourceFile[],
  confirmedQuantityFileNameByPo: Readonly<Record<string, string>>,
): { rows: ParsedTrackingRow[]; fileNames: string[] } {
  const expectedPoNumbers = [...new Set(requests.map(request => normalizeSkuId(request.purchaseOrderNumber)).filter(Boolean))];
  const expectedPoSet = new Set(expectedPoNumbers);
  const blockingReasons: string[] = [];

  const linkedFileNameByPo = new Map<string, string>();
  for (const [rawPo, rawFileName] of Object.entries(confirmedQuantityFileNameByPo)) {
    const po = normalizeSkuId(rawPo);
    const fileName = normalizedFileName(rawFileName);
    if (!po || !fileName) continue;
    if (linkedFileNameByPo.has(po) && linkedFileNameByPo.get(po) !== fileName) {
      blockingReasons.push(`발주번호 ${po}의 확정수량 파일 연결이 중복됐습니다.`);
    } else {
      linkedFileNameByPo.set(po, fileName);
    }
  }

  const filesByName = new Map<string, ConfirmedQuantitySourceFile[]>();
  for (const file of confirmedFiles) {
    const name = normalizedFileName(file.name);
    const sameName = filesByName.get(name) || [];
    sameName.push(file);
    filesByName.set(name, sameName);
  }

  const sourceRowsByPo = new Map<string, PurchaseOrderSourceRecord[]>();
  for (const source of sourceRecords) {
    const po = normalizeSkuId(source.purchaseOrderNumber);
    if (!expectedPoSet.has(po)) continue;
    const rows = sourceRowsByPo.get(po) || [];
    rows.push(source);
    sourceRowsByPo.set(po, rows);
  }

  const resolvedRows: ParsedTrackingRow[] = [];
  const usedFileNames = new Set<string>();
  for (const po of expectedPoNumbers) {
    const linkedFileName = linkedFileNameByPo.get(po);
    if (!linkedFileName) {
      blockingReasons.push(`발주번호 ${po}: 확정 완료된 수량 파일명이 저장되어 있지 않습니다.`);
      continue;
    }
    const matchingFiles = filesByName.get(linkedFileName) || [];
    if (matchingFiles.length !== 1) {
      blockingReasons.push(matchingFiles.length === 0
        ? `발주번호 ${po}: 연결된 확정수량 파일을 찾지 못했습니다 — ${linkedFileName}`
        : `발주번호 ${po}: 같은 이름의 확정수량 파일이 ${matchingFiles.length}개여서 하나로 확정할 수 없습니다 — ${linkedFileName}`);
      continue;
    }
    const confirmedFile = matchingFiles[0];
    if (!confirmedFile.rows) {
      blockingReasons.push(`발주번호 ${po}: 연결된 확정수량 파일 구조를 읽지 못했습니다 — ${linkedFileName}`);
      continue;
    }
    usedFileNames.add(confirmedFile.name);

    const sourceRows = sourceRowsByPo.get(po) || [];
    if (sourceRows.length === 0) {
      blockingReasons.push(`현재 선택 발주번호가 발주서 원본에 없습니다: ${po}`);
      continue;
    }
    const sourceBySku = new Map<string, PurchaseOrderSourceRecord>();
    for (const source of sourceRows) {
      const sku = normalizeSkuId(source.skuId);
      if (!sku) blockingReasons.push(`발주번호 ${po}: 발주서 원본에 상품번호가 빈 행이 있습니다.`);
      else if (sourceBySku.has(sku)) blockingReasons.push(`발주번호 ${po}: 발주서 원본에 상품번호 ${sku}가 중복됐습니다.`);
      else sourceBySku.set(sku, source);
    }

    const fileRows = confirmedFile.rows.filter(row => normalizeSkuId(row.purchaseOrderNumber) === po);
    const confirmedBySku = new Map<string, ConfirmedQuantitySourceRow>();
    for (const row of fileRows) {
      const sku = normalizeSkuId(row.skuId);
      if (!sku) blockingReasons.push(`발주번호 ${po}: 확정수량 파일에 상품번호가 빈 행이 있습니다.`);
      else if (confirmedBySku.has(sku)) blockingReasons.push(`발주번호 ${po}: 확정수량 파일에 상품번호 ${sku}가 중복됐습니다.`);
      else confirmedBySku.set(sku, row);
    }

    for (const [sku, source] of sourceBySku) {
      const confirmed = confirmedBySku.get(sku);
      if (!confirmed) {
        blockingReasons.push(`발주번호 ${po}: 확정수량 파일에 상품번호 ${sku}가 없습니다.`);
        continue;
      }
      const orderedQuantity = nonNegativeInteger(confirmed.orderedQuantity);
      const confirmedQuantity = nonNegativeInteger(confirmed.confirmedQuantity);
      let valid = true;
      if (orderedQuantity !== source.orderedQuantity) {
        blockingReasons.push(`발주번호 ${po} 상품번호 ${sku}: 확정수량 파일의 발주수량 ${confirmed.orderedQuantity || "빈 값"}이 현재 원본 ${source.orderedQuantity}과 다릅니다.`);
        valid = false;
      }
      if (confirmedQuantity === null || confirmedQuantity > source.orderedQuantity) {
        blockingReasons.push(`발주번호 ${po} 상품번호 ${sku}: 확정수량은 0 이상 ${source.orderedQuantity} 이하의 정수여야 합니다.`);
        valid = false;
      }
      if (normalizeSkuId(confirmed.barcode) !== normalizeSkuId(source.barcode)) {
        blockingReasons.push(`발주번호 ${po} 상품번호 ${sku}: 확정수량 파일과 발주서 원본의 바코드가 다릅니다.`);
        valid = false;
      }
      if (normalizeCenterName(confirmed.fulfillmentCenter) !== normalizeCenterName(source.fulfillmentCenterName)) {
        blockingReasons.push(`발주번호 ${po} 상품번호 ${sku}: 확정수량 파일과 발주서 원본의 물류센터가 다릅니다.`);
        valid = false;
      }
      if (comparableDate(confirmed.expectedDate) !== comparableDate(source.expectedArrivalDate)) {
        blockingReasons.push(`발주번호 ${po} 상품번호 ${sku}: 확정수량 파일과 발주서 원본의 입고예정일이 다릅니다.`);
        valid = false;
      }
      if (!valid || confirmedQuantity === null) continue;
      resolvedRows.push({
        purchaseOrderNumber: source.purchaseOrderNumber,
        fulfillmentCenter: source.fulfillmentCenterName,
        transportType: "쉽먼트",
        expectedDate: source.expectedArrivalDate,
        skuId: source.skuId,
        barcode: source.barcode,
        productName: source.optionName ? `${source.productName}, ${source.optionName}` : source.productName,
        confirmedQuantity: String(confirmedQuantity),
        trackingNumber: "",
        shippedQuantity: String(confirmedQuantity),
      });
    }
    for (const sku of confirmedBySku.keys()) {
      if (!sourceBySku.has(sku)) blockingReasons.push(`발주번호 ${po}: 확정수량 파일에 현재 발주서 원본에 없는 상품번호 ${sku}가 있습니다.`);
    }
  }

  if (blockingReasons.length > 0) throw new AutoShipmentBlockedError([...new Set(blockingReasons)]);
  return { rows: resolvedRows, fileNames: [...usedFileNames] };
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
  templateBuffer?: Buffer,
  options: { selectedReprintFileName?: string; confirmedQuantityFileNameByPo?: Record<string, string> } = {}
): Promise<AutoShipmentResult> {
  const groups = groupRequestsByCenterAndDate(requests);

  const confirmedQuantityFileNameByPo = options.confirmedQuantityFileNameByPo || {};
  const expectedConfirmedFileNames = [...new Set(Object.values(confirmedQuantityFileNameByPo).map(normalizedFileName).filter(Boolean))];
  const confirmedFiles = await loadConfirmedQuantityFiles(expectedConfirmedFileNames);
  const confirmed = resolveConfirmedQuantityRowsForShipment(requests, sourceRecords, confirmedFiles, confirmedQuantityFileNameByPo);

  const reprintFiles = await loadReprintDetailFiles();
  if (reprintFiles.length === 0) {
    throw new AutoShipmentBlockedError(["현재 웨이브와 일치하는 재출력 파일을 찾지 못했습니다."]);
  }
  const selectedReprintFile = selectExactReprintFile(requests, reprintFiles, options.selectedReprintFileName);
  const reprint = { rows: selectedReprintFile.rows, fileNames: [selectedReprintFile.name] };

  const confirmedByPo = new Map<string, ParsedTrackingRow[]>();
  for (const row of confirmed.rows) {
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

      trackingNumbersUsed.add(trackingNumber);
      for (const row of confirmedRows) resolvedRows.push({ ...row, trackingNumber });
    }

    // 같은 센터·날짜라도 한진 송장파일은 총수량 200개 기준으로 발주서 단위 분할될 수 있다.
    // 각 발주번호가 정확히 한 운송장에만 연결되면 여러 운송장번호를 정상으로 인정한다.
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
    confirmedQuantityFileNames: confirmed.fileNames,
  };
}
