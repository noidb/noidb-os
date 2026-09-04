import path from "node:path";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { backupSheetWithinSpreadsheet, fetchSheetRows, updateSheetCells, type SheetCellUpdate } from "./google-sheets";
import { PRODUCT_DB_SHEET_NAME } from "./product-catalog";
import { coupangSupplyMatchPriority } from "../coupang-option-name";
import {
  downloadDriveFile,
  isDriveReaderConfigured,
  listDriveFilesFromEnv,
  shouldRequireDriveReader,
} from "./google-drive-reader";

/**
 * 쿠팡 "상품공급상태관리 다운로드" 파일을 제품DB(구글시트)와 매칭해 승인된 신상품의
 * SKU ID/현재상태를 반영하는 전용 모듈 (2026-08-20 신규).
 *
 * 2026-08-19 실사용 데이터로 확인한 사실 — 실제로 이 폴더에 저장되는 파일
 * ("noidb2017_sku_download_*.xlsx")에는 판매자상품코드/옵션 판매자상품코드/모델SKU와
 * 동일한 의미의 열이 존재하지 않는다(실제 헤더: SKU ID, 요청, 상품명, 바코드, 발주가능상태,
 * 담당 BM, 발주담당자, 치수류, MOQ, 중량, Box 바코드, Pallet 정보). 명시 모델SKU 열이 있으면
 * 최우선으로 사용하고, 없으면 신규 `모델SKU | 옵션` 및 기존 `옵션 모델SKU` 형식을 순서대로
 * 해석한다. 어떤 형식도 정확히 맞지 않을 때만 기존 SKU ID/상품명 보조 매칭으로 후퇴한다.
 */

const SUPPLY_STATUS_FOLDER = "G:\\내 드라이브\\쿠팡데이터\\상품공급상태관리 다운로드";
const PENDING_STATUS_VALUES = new Set(["기존상품승인대기", "신상승인대기"]);

/** 2026-08-19 제품DB 실사용 데이터로 검증된 승인완료 상태값 — SKU ID가 채워진 행들이 전부
 *  이 값을 쓰고 있음을 확인했다(예: wn11327 6개 옵션, we0001 3개 옵션). "승인완료"/"판매중" 등
 *  은 이 시트에서 실제로 쓰인 적이 없어 후보에서 제외했다. verifyApprovedStatusValue()가 매
 *  실행마다 이 값이 여전히 유효한지 실데이터로 재확인한다 — 더 이상 맞지 않으면 예외를 던진다. */
const APPROVED_STATUS_CANDIDATE = "완료";

const EXPLICIT_MODEL_SKU_HEADERS = ["옵션 판매자상품코드", "판매자상품코드", "모델SKU", "모델 SKU"];
const OPTION_NAME_HEADERS = ["색상옵션명", "옵션명", "Option Item Name", "색상"];

/** 헤더명 → { "승인/공급 가능"으로 볼 값들 }. 실제 발견되는 첫 번째 헤더만 쓴다. */
const APPROVAL_HEADER_APPROVED_VALUES: [string, string[]][] = [
  ["승인상태", ["승인완료"]],
  ["공급상태", ["공급가능", "정상공급"]],
  ["발주가능상태", ["정상"]],
];

const SKU_ID_HEADERS = ["SKU ID", "Vendor Item ID", "쿠팡 SKU ID"];

export class ApprovedStatusNotFoundError extends Error {
  constructor() {
    super("승인 완료 상태값을 확인할 수 없습니다. 제품DB '현재상태' 열에서 실제 사용 중인 승인완료 코드값을 찾지 못했습니다.");
    this.name = "ApprovedStatusNotFoundError";
  }
}

export class SupplyStatusFileNotFoundError extends Error {
  constructor() {
    super(`${SUPPLY_STATUS_FOLDER} 폴더에서 사용할 수 있는 엑셀 파일을 찾지 못했습니다.`);
    this.name = "SupplyStatusFileNotFoundError";
  }
}

export class ProductDbHeaderMissingError extends Error {
  constructor(missing: string[]) {
    super(`제품DB 시트에서 필요한 헤더를 찾지 못했습니다: ${missing.join(", ")}`);
    this.name = "ProductDbHeaderMissingError";
  }
}

function norm(v: unknown): string {
  return String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function findHeaderIndex(headers: string[], candidates: string[]): { index: number; header: string } | null {
  for (const candidate of candidates) {
    const idx = headers.findIndex(h => h === candidate);
    if (idx >= 1) return { index: idx, header: candidate };
  }
  return null;
}

export interface LatestSupplyStatusFile {
  filePath?: string;
  buffer?: Buffer;
  fileName: string;
  mtime: string;
}

export interface SupplyStatusTableCapture {
  schemaVersion: 1;
  source: "supplier-hub-live";
  headers: string[];
  rows: string[][];
  capturedAt: string;
  sourceUrl: string;
  totalRowCount: number;
  pageCount: number;
  pageSize: number;
  coverageComplete: true;
}

const MAX_SUPPLY_STATUS_CAPTURE_ROWS = 10_000;

/** 대상 폴더에서 ~$ 임시파일·숨김파일을 제외하고 수정일이 가장 최근인 xlsx 1개를 고른다. */
export async function findLatestSupplyStatusFile(): Promise<LatestSupplyStatusFile | null> {
  if (isDriveReaderConfigured() || shouldRequireDriveReader()) {
    const files = await listDriveFilesFromEnv("GOOGLE_DRIVE_COUPANG_SUPPLY_STATUS_FOLDER_ID");
    const latest = files.find(file => !file.name.startsWith("~$") && !file.name.startsWith(".") && file.name.toLowerCase().endsWith(".xlsx"));
    if (!latest) return null;
    return {
      buffer: await downloadDriveFile(latest.id),
      fileName: latest.name,
      mtime: latest.modifiedTime,
    };
  }

  let entries: string[];
  try {
    entries = await fs.readdir(SUPPLY_STATUS_FOLDER);
  } catch {
    return null;
  }
  const candidates: { filePath: string; fileName: string; mtime: Date }[] = [];
  for (const name of entries) {
    if (name.startsWith("~$") || name.startsWith(".")) continue;
    if (!name.toLowerCase().endsWith(".xlsx")) continue;
    const filePath = path.join(SUPPLY_STATUS_FOLDER, name);
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) continue;
    candidates.push({ filePath, fileName: name, mtime: stat.mtime });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  const best = candidates[0];
  return { filePath: best.filePath, fileName: best.fileName, mtime: best.mtime.toISOString() };
}

interface DownloadRow {
  matchKey: string;
  explicitModelSku: string;
  optionName: string;
  skuId: string;
  productName: string;
  barcode: string;
  approvalRaw: string;
  approved: boolean;
}

interface ParsedSupplyStatusFile {
  matchKeyColumnHeader: string | null;
  approvalColumnHeader: string | null;
  skuIdColumnHeader: string | null;
  rows: DownloadRow[];
}

async function parseSupplyStatusFile(fileInfo: LatestSupplyStatusFile): Promise<ParsedSupplyStatusFile> {
  const wb = new ExcelJS.Workbook();
  if (fileInfo.buffer) await wb.xlsx.load(fileInfo.buffer as unknown as ExcelJS.Buffer);
  else if (fileInfo.filePath) await wb.xlsx.readFile(fileInfo.filePath);
  else throw new Error("상품공급상태 파일 데이터가 없습니다.");
  const sheet = wb.worksheets[0];
  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? "").trim();
  });

  const explicitModelSkuCol = findHeaderIndex(headers, EXPLICIT_MODEL_SKU_HEADERS);
  const optionNameCol = findHeaderIndex(headers, OPTION_NAME_HEADERS);
  const skuIdCol = findHeaderIndex(headers, SKU_ID_HEADERS);
  const productNameCol = findHeaderIndex(headers, ["상품명"]);
  const barcodeCol = findHeaderIndex(headers, ["바코드", "쿠팡 바코드", "쿠팡바코드"]);
  let approvalCol: { index: number; header: string } | null = null;
  let approvedValues: string[] = [];
  for (const [headerName, values] of APPROVAL_HEADER_APPROVED_VALUES) {
    const found = findHeaderIndex(headers, [headerName]);
    if (found) {
      approvalCol = found;
      approvedValues = values;
      break;
    }
  }

  const rows: DownloadRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const skuId = skuIdCol ? String(row.getCell(skuIdCol.index).value ?? "").trim() : "";
    const explicitModelSku = explicitModelSkuCol ? String(row.getCell(explicitModelSkuCol.index).value ?? "").trim() : "";
    const optionName = optionNameCol ? String(row.getCell(optionNameCol.index).value ?? "").trim() : "";
    const matchKey = explicitModelSku || optionName;
    const productName = productNameCol ? String(row.getCell(productNameCol.index).value ?? "").trim() : "";
    const barcode = barcodeCol ? String(row.getCell(barcodeCol.index).value ?? "").trim() : "";
    const approvalRaw = approvalCol ? String(row.getCell(approvalCol.index).value ?? "").trim() : "";
    const approved = approvalCol ? approvedValues.includes(approvalRaw) : false;
    if (!matchKey && !skuId) return;
    rows.push({ matchKey, explicitModelSku, optionName, skuId, productName, barcode, approvalRaw, approved });
  });

  return {
    matchKeyColumnHeader: explicitModelSkuCol?.header ?? optionNameCol?.header ?? null,
    approvalColumnHeader: approvalCol?.header ?? null,
    skuIdColumnHeader: skuIdCol?.header ?? null,
    rows,
  };
}

export interface ProductDbHeaderIndex {
  status: number;
  modelSku: number;
  skuId: number;
  productName: number;
  color: number;
  barcode: number;
  orderAvailability: number;
}

function resolveProductDbHeaderIndex(headers: string[]): ProductDbHeaderIndex {
  const idx = {
    status: headers.indexOf("현재상태"),
    modelSku: headers.indexOf("모델SKU"),
    skuId: headers.indexOf("SKU ID"),
    productName: headers.indexOf("상품명"),
    color: headers.indexOf("색상"),
    barcode: ["쿠팡 바코드", "Seller SKU Barcode", "쿠팡바코드", "바코드"].map(h => headers.indexOf(h)).find(i => i >= 0) ?? -1,
    orderAvailability: headers.indexOf("발주가능상태"),
  };
  const missing = Object.entries({ 현재상태: idx.status, 모델SKU: idx.modelSku, "SKU ID": idx.skuId, 상품명: idx.productName, 색상: idx.color, 바코드: idx.barcode, 발주가능상태: idx.orderAvailability })
    .filter(([, v]) => v < 0)
    .map(([k]) => k);
  if (missing.length > 0) throw new ProductDbHeaderMissingError(missing);
  return idx;
}

function verifyApprovedStatusValue(productDbDataRows: string[][], idx: ProductDbHeaderIndex): string {
  const usedWithSkuId = productDbDataRows.some(
    row => String(row[idx.status] ?? "").trim() === APPROVED_STATUS_CANDIDATE && String(row[idx.skuId] ?? "").trim() !== ""
  );
  if (!usedWithSkuId) throw new ApprovedStatusNotFoundError();
  return APPROVED_STATUS_CANDIDATE;
}

export interface MatchedRow {
  sheetRowNumber: number;
  modelSku: string;
  productName: string;
  color: string;
  currentStatus: string;
  currentSkuId: string;
  downloadSkuId: string | null;
  downloadProductName: string | null;
  downloadOptionName: string | null;
  downloadBarcode: string | null;
  downloadOrderAvailability: string | null;
  matchCandidateCount: number;
  conflict: boolean;
  alreadySame: boolean;
  awaitingApproval: boolean;
  eligible: boolean;
  matchRule: SupplyStatusMatchRule | null;
  reasons: string[];
}

export function parseSupplyStatusCapture(capture: SupplyStatusTableCapture): ParsedSupplyStatusFile {
  if (capture?.schemaVersion !== 1 || capture.source !== "supplier-hub-live" || capture.coverageComplete !== true) {
    throw new Error("Supplier Hub 전체 수집 정보가 올바르지 않습니다.");
  }
  if (!Array.isArray(capture.headers) || !Array.isArray(capture.rows) || capture.headers.length === 0) {
    throw new Error("Supplier Hub 표의 헤더 또는 행이 없습니다.");
  }
  if (!Number.isSafeInteger(capture.totalRowCount) || capture.totalRowCount <= 0 || capture.totalRowCount > MAX_SUPPLY_STATUS_CAPTURE_ROWS) {
    throw new Error(`상품공급상태 수집 건수는 1~${MAX_SUPPLY_STATUS_CAPTURE_ROWS.toLocaleString()}건이어야 합니다.`);
  }
  if (capture.rows.length !== capture.totalRowCount) {
    throw new Error(`Supplier Hub 전체 ${capture.totalRowCount.toLocaleString()}건 중 ${capture.rows.length.toLocaleString()}건만 전달되었습니다.`);
  }
  if (!Number.isSafeInteger(capture.pageSize) || capture.pageSize <= 0 || capture.pageSize > 500) {
    throw new Error("Supplier Hub 페이지 표시 건수가 올바르지 않습니다.");
  }
  if (!Number.isSafeInteger(capture.pageCount) || capture.pageCount !== Math.ceil(capture.totalRowCount / capture.pageSize)) {
    throw new Error("Supplier Hub 전체 페이지 수가 수집 건수와 맞지 않습니다.");
  }
  if (!capture.capturedAt || Number.isNaN(Date.parse(capture.capturedAt))) throw new Error("Supplier Hub 수집 시간이 올바르지 않습니다.");
  try {
    const sourceUrl = new URL(capture.sourceUrl);
    if (sourceUrl.origin !== "https://supplier.coupang.com") throw new Error();
  } catch {
    throw new Error("Supplier Hub 출처 주소가 올바르지 않습니다.");
  }

  const headers = ["", ...capture.headers.map(value => String(value ?? "").trim())];
  const explicitModelSkuCol = findHeaderIndex(headers, EXPLICIT_MODEL_SKU_HEADERS);
  const optionNameCol = findHeaderIndex(headers, OPTION_NAME_HEADERS);
  const skuIdCol = findHeaderIndex(headers, SKU_ID_HEADERS);
  const productNameCol = findHeaderIndex(headers, ["상품명"]);
  const barcodeCol = findHeaderIndex(headers, ["바코드", "쿠팡 바코드", "쿠팡바코드"]);
  let approvalCol: { index: number; header: string } | null = null;
  let approvedValues: string[] = [];
  for (const [headerName, values] of APPROVAL_HEADER_APPROVED_VALUES) {
    const found = findHeaderIndex(headers, [headerName]);
    if (found) {
      approvalCol = found;
      approvedValues = values;
      break;
    }
  }
  const requiredMissing = [
    !skuIdCol && "SKU ID",
    !productNameCol && "상품명",
    !barcodeCol && "바코드",
    !approvalCol && "발주가능상태",
  ].filter(Boolean);
  if (requiredMissing.length) throw new Error(`Supplier Hub 표에서 필요한 열을 찾지 못했습니다: ${requiredMissing.join(", ")}`);

  const rows: DownloadRow[] = [];
  const seenSkuIds = new Set<string>();
  for (const rawRow of capture.rows) {
    if (!Array.isArray(rawRow) || rawRow.length !== capture.headers.length) throw new Error("Supplier Hub 표의 열 개수가 페이지마다 다릅니다.");
    const value = (column: { index: number } | null) => column ? String(rawRow[column.index - 1] ?? "").trim() : "";
    const skuId = value(skuIdCol);
    const skuKey = norm(skuId);
    if (skuKey && seenSkuIds.has(skuKey)) throw new Error(`Supplier Hub 표에 SKU ID ${skuId}가 반복되어 있습니다.`);
    if (skuKey) seenSkuIds.add(skuKey);
    const explicitModelSku = value(explicitModelSkuCol);
    const optionName = value(optionNameCol);
    const matchKey = explicitModelSku || optionName;
    const productName = value(productNameCol);
    const barcode = value(barcodeCol);
    const approvalRaw = value(approvalCol);
    const approved = approvedValues.includes(approvalRaw);
    if (!matchKey && !skuId) continue;
    rows.push({ matchKey, explicitModelSku, optionName, skuId, productName, barcode, approvalRaw, approved });
  }
  if (rows.length !== capture.rows.length) throw new Error("Supplier Hub 표에 SKU ID와 매칭키가 모두 비어 있는 행이 있습니다.");
  return {
    matchKeyColumnHeader: explicitModelSkuCol?.header ?? optionNameCol?.header ?? null,
    approvalColumnHeader: approvalCol?.header ?? null,
    skuIdColumnHeader: skuIdCol?.header ?? null,
    rows,
  };
}

function normalizeExactProductText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^[\"']+/, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function supplyOptionName(fullProductName: string): string {
  const separatorIndex = fullProductName.indexOf(",");
  return separatorIndex >= 0 ? fullProductName.slice(separatorIndex + 1).trim() : "";
}

/** 과거 상품은 상품명+옵션으로 만들 수 있는 두 개의 쿠팡 전체 표기와만 정확히 비교한다. */
function findExactProductNameOptionCandidates(rows: DownloadRow[], productName: string, optionName: string): DownloadRow[] {
  const normalizedProductName = normalizeExactProductText(productName);
  const normalizedOptionName = normalizeExactProductText(optionName);
  if (!normalizedProductName || !normalizedOptionName) return [];

  const exactNames = new Set([
    normalizeExactProductText(`${productName}, ${optionName}`),
    normalizeExactProductText(`${productName}, ${optionName} 혼합색상`),
  ]);
  return rows.filter(row => exactNames.has(normalizeExactProductText(row.productName)));
}

type SupplyStatusMatchRule = "sku_id" | "explicit_model_sku" | "new_option_model_sku" | "legacy_option_model_sku" | "product_name_option";

interface CandidateMatch {
  candidates: DownloadRow[];
  rule: SupplyStatusMatchRule | null;
}

/** SKU ID → 명시 모델SKU → 신규 구분자 → 구형 접미사 → 승인대기 상품명+옵션 정확 일치. */
function findSupplyStatusCandidates(
  rows: DownloadRow[],
  modelSku: string,
  currentSkuId: string,
  productName: string,
  color: string
): CandidateMatch {
  const ranked = rows.map(row => ({ row, priority: coupangSupplyMatchPriority(row, modelSku, currentSkuId) }));
  const bestPriority = ranked.reduce<number>((best, candidate) => candidate.priority > 0 && candidate.priority < best ? candidate.priority : best, 5);
  if (bestPriority < 5) {
    const rules: Record<number, SupplyStatusMatchRule> = {
      1: "sku_id",
      2: "explicit_model_sku",
      3: "new_option_model_sku",
      4: "legacy_option_model_sku",
    };
    return {
      candidates: ranked.filter(candidate => candidate.priority === bestPriority).map(candidate => candidate.row),
      rule: rules[bestPriority],
    };
  }

  return {
    candidates: findExactProductNameOptionCandidates(rows, productName, color),
    rule: "product_name_option",
  };
}

export interface SupplyStatusPreview {
  fileFound: true;
  fileName: string;
  fileMtime: string;
  matchKeyColumnHeader: string | null;
  approvalColumnHeader: string | null;
  approvedStatusValue: string;
  pendingCount: number;
  awaitingApprovalCount: number;
  approvedMatchCount: number;
  exactMatchCount: number;
  eligibleCount: number;
  duplicateCount: number;
  unmatchedCount: number;
  conflictCount: number;
  alreadySameCount: number;
  rows: MatchedRow[];
  dryRunToken: string;
}

export type SupplyStatusPreviewOrNotFound = SupplyStatusPreview | { fileFound: false };

export type SupplyStatusAuditIssueType = "duplicate" | "barcode_conflict" | "unmatched";

export interface SupplyStatusAuditIssue {
  type: SupplyStatusAuditIssueType;
  sheetRowNumber?: number;
  modelSku?: string;
  skuId?: string;
  productName?: string;
  optionName?: string;
  message: string;
}

export interface SupplyStatusAudit {
  fileFound: true;
  readOnly: true;
  fileName: string;
  fileMtime: string;
  downloadedCount: number;
  rocketBarcodeCount: number;
  excludedSBarcodeCount: number;
  excludedOtherBarcodeCount: number;
  pendingProductCount: number;
  newApprovalCandidateCount: number;
  /** 상품공급상태 파일만으로는 미등록·검수중·반려를 구분할 수 없는 행 수 */
  registrationStatusCheckRequiredCount: number;
  /** @deprecated 이전 UI/API 호환용. registrationStatusCheckRequiredCount와 동일하다. */
  awaitingApprovalCount: number;
  existingSkuMatchedCount: number;
  existingNameChangeCount: number;
  existingAvailabilityChangeCount: number;
  safeUpdateCount: number;
  duplicateCount: number;
  barcodeConflictCount: number;
  unmatchedCount: number;
  proposedNewRowCount: 0;
  issues: SupplyStatusAuditIssue[];
  dryRunToken: string;
}

export type SupplyStatusAuditOrNotFound = SupplyStatusAudit | { fileFound: false };

interface InternalMatchResult {
  preview: SupplyStatusPreview;
  headerIndex: ProductDbHeaderIndex;
}

function createDryRunToken(preview: Omit<SupplyStatusPreview, "dryRunToken">): string {
  const target = preview.rows.map(row => ({
    sheetRowNumber: row.sheetRowNumber,
    modelSku: row.modelSku,
    productName: row.productName,
    currentStatus: row.currentStatus,
    currentSkuId: row.currentSkuId,
    downloadSkuId: row.downloadSkuId,
    downloadProductName: row.downloadProductName,
    downloadOptionName: row.downloadOptionName,
    downloadBarcode: row.downloadBarcode,
    downloadOrderAvailability: row.downloadOrderAvailability,
    eligible: row.eligible,
    conflict: row.conflict,
    awaitingApproval: row.awaitingApproval,
    matchRule: row.matchRule,
  }));
  return createHash("sha256").update(JSON.stringify({ fileName: preview.fileName, fileMtime: preview.fileMtime, target })).digest("hex");
}

async function computeSupplyStatusMatch(): Promise<InternalMatchResult | null> {
  const fileInfo = await findLatestSupplyStatusFile();
  if (!fileInfo) return null;

  const parsed = await parseSupplyStatusFile(fileInfo);

  const sheetRows = await fetchSheetRows(PRODUCT_DB_SHEET_NAME, { valueRenderOption: "FORMULA" });
  const headers = sheetRows[0].map(h => String(h ?? "").trim());
  const idx = resolveProductDbHeaderIndex(headers);
  const dataRows = sheetRows.slice(1);

  const approvedStatusValue = verifyApprovedStatusValue(dataRows, idx);

  const pendingRows = dataRows
    .map((row, i) => ({ row, sheetRowNumber: i + 2 }))
    .filter(({ row }) => PENDING_STATUS_VALUES.has(String(row[idx.status] ?? "").trim()));

  const matchedRows: MatchedRow[] = [];
  for (const { row, sheetRowNumber } of pendingRows) {
    const modelSku = String(row[idx.modelSku] ?? "").trim();
    const reasons: string[] = [];
    let eligible = false;
    let downloadSkuId: string | null = null;
    let downloadProductName: string | null = null;
    let downloadOptionName: string | null = null;
    let downloadBarcode: string | null = null;
    let downloadOrderAvailability: string | null = null;
    let alreadySame = false;
    let awaitingApproval = false;
    let conflict = false;
    let matchCandidateCount = 0;
    let matchRule: SupplyStatusMatchRule | null = null;

    if (!modelSku) {
      reasons.push("제품DB 모델SKU가 비어 있습니다.");
    } else {
      const matchResult = findSupplyStatusCandidates(
        parsed.rows,
        modelSku,
        String(row[idx.skuId] ?? "").trim(),
        String(row[idx.productName] ?? "").trim(),
        String(row[idx.color] ?? "").trim()
      );
      const candidates = matchResult.candidates;
      matchRule = matchResult.rule;
      matchCandidateCount = candidates.length;
      if (candidates.length === 0) {
        awaitingApproval = true;
        reasons.push("상품공급상태 파일에 승인 완료 데이터가 아직 없습니다.");
      } else if (candidates.length > 1) {
        reasons.push(`다운로드 파일에서 ${candidates.length}개 행이 발견되어 중복입니다.`);
      } else {
        const match = candidates[0];
        if (!match.approved) {
          awaitingApproval = true;
          reasons.push(`아직 승인 전입니다(현재 발주가능상태: "${match.approvalRaw || "-"}").`);
        } else if (!match.skuId) {
          reasons.push("다운로드 SKU ID가 비어 있습니다.");
        } else {
          const currentSkuId = String(row[idx.skuId] ?? "").trim();
          downloadSkuId = match.skuId;
          downloadProductName = match.productName || null;
          downloadOptionName = supplyOptionName(match.productName) || match.optionName || null;
          downloadBarcode = match.barcode || null;
          downloadOrderAvailability = match.approvalRaw || null;
          if (currentSkuId === "") {
            eligible = true;
          } else if (currentSkuId === match.skuId) {
            alreadySame = true;
            eligible = true;
          } else {
            conflict = true;
            reasons.push(`기존 SKU ID("${currentSkuId}")와 다운로드 SKU ID("${match.skuId}")가 달라 충돌입니다 — 덮어쓰지 않았습니다.`);
          }
        }
      }
    }

    matchedRows.push({
      sheetRowNumber,
      modelSku,
      productName: String(row[idx.productName] ?? "").trim(),
      color: String(row[idx.color] ?? "").trim(),
      currentStatus: String(row[idx.status] ?? "").trim(),
      currentSkuId: String(row[idx.skuId] ?? "").trim(),
      downloadSkuId,
      downloadProductName,
      downloadOptionName,
      downloadBarcode,
      downloadOrderAvailability,
      matchCandidateCount,
      conflict,
      alreadySame,
      awaitingApproval,
      eligible,
      matchRule,
      reasons,
    });
  }

  // 다운로드 SKU ID가 서로 다른 대상에 중복 배정되면 전부 제외한다(안전 우선).
  const skuIdUsage = new Map<string, number>();
  for (const r of matchedRows) {
    if (r.eligible && r.downloadSkuId && !r.alreadySame) {
      skuIdUsage.set(r.downloadSkuId, (skuIdUsage.get(r.downloadSkuId) || 0) + 1);
    }
  }
  for (const r of matchedRows) {
    if (r.eligible && r.downloadSkuId && !r.alreadySame && (skuIdUsage.get(r.downloadSkuId) || 0) > 1) {
      r.eligible = false;
      r.conflict = true;
      r.reasons.push("다운로드 SKU ID가 다른 대상과 중복 배정되어 제외했습니다.");
    }
  }

  const previewWithoutToken: Omit<SupplyStatusPreview, "dryRunToken"> = {
    fileFound: true,
    fileName: fileInfo.fileName,
    fileMtime: fileInfo.mtime,
    matchKeyColumnHeader: parsed.matchKeyColumnHeader,
    approvalColumnHeader: parsed.approvalColumnHeader,
    approvedStatusValue,
    pendingCount: pendingRows.length,
    awaitingApprovalCount: matchedRows.filter(r => r.awaitingApproval).length,
    approvedMatchCount: matchedRows.filter(r => r.eligible).length,
    exactMatchCount: matchedRows.filter(r => r.matchCandidateCount === 1).length,
    eligibleCount: matchedRows.filter(r => r.eligible).length,
    duplicateCount: matchedRows.filter(r => r.matchCandidateCount > 1).length,
    unmatchedCount: matchedRows.filter(r => !r.eligible && !r.awaitingApproval && !r.conflict && r.matchCandidateCount === 0).length,
    conflictCount: matchedRows.filter(r => r.conflict).length,
    alreadySameCount: matchedRows.filter(r => r.alreadySame).length,
    rows: matchedRows,
  };
  const preview: SupplyStatusPreview = { ...previewWithoutToken, dryRunToken: createDryRunToken(previewWithoutToken) };

  return { preview, headerIndex: idx };
}

export async function buildSupplyStatusPreview(): Promise<SupplyStatusPreviewOrNotFound> {
  const result = await computeSupplyStatusMatch();
  if (!result) return { fileFound: false };
  return result.preview;
}

/** 최신 상품공급상태 파일과 제품DB를 비교하는 읽기 전용 진단이다.
 * 백업·셀 업데이트·Apps Script 호출을 하지 않으며 실제 반영 로직과 분리한다. */
export interface SupplyStatusProposedUpdate {
  kind: "new_approval" | "existing_sku";
  sheetRowNumber: number;
  modelSku: string;
  skuId: string;
  productName: string;
  barcode: string;
  orderAvailability: string;
  updateProductName: boolean;
  updateOrderAvailability: boolean;
}

interface InternalSupplyStatusAudit {
  audit: SupplyStatusAudit;
  headerIndex: ProductDbHeaderIndex;
  updates: SupplyStatusProposedUpdate[];
}

function createAuditDryRunToken(fileName: string, fileMtime: string, updates: SupplyStatusProposedUpdate[], issues: SupplyStatusAuditIssue[]): string {
  return createHash("sha256").update(JSON.stringify({ fileName, fileMtime, updates, issues })).digest("hex");
}

async function computeSupplyStatusAudit(capture?: SupplyStatusTableCapture): Promise<InternalSupplyStatusAudit | null> {
  const fileInfo = capture
    ? { fileName: "Supplier Hub 실시간 상품공급상태", mtime: capture.capturedAt }
    : await findLatestSupplyStatusFile();
  if (!fileInfo) return null;

  const parsed = capture ? parseSupplyStatusCapture(capture) : await parseSupplyStatusFile(fileInfo);
  const sheetRows = await fetchSheetRows(PRODUCT_DB_SHEET_NAME, { valueRenderOption: "FORMULA" });
  const headers = sheetRows[0].map(value => String(value ?? "").trim());
  const idx = resolveProductDbHeaderIndex(headers);
  const dataRows = sheetRows.slice(1);
  const rocketRows = parsed.rows.filter(row => /^R/i.test(row.barcode));
  const excludedSBarcodeCount = parsed.rows.filter(row => /^S/i.test(row.barcode)).length;
  const issues: SupplyStatusAuditIssue[] = [];

  const productRowsBySku = new Map<string, { row: string[]; sheetRowNumber: number }[]>();
  dataRows.forEach((row, index) => {
    const skuId = norm(row[idx.skuId]);
    if (!skuId) return;
    productRowsBySku.set(skuId, [...(productRowsBySku.get(skuId) || []), { row, sheetRowNumber: index + 2 }]);
  });

  const downloadRowsBySku = new Map<string, DownloadRow[]>();
  const downloadRowsByBarcode = new Map<string, DownloadRow[]>();
  for (const row of rocketRows) {
    const skuId = norm(row.skuId);
    if (!skuId) continue;
    downloadRowsBySku.set(skuId, [...(downloadRowsBySku.get(skuId) || []), row]);
    const barcode = norm(row.barcode);
    if (barcode) downloadRowsByBarcode.set(barcode, [...(downloadRowsByBarcode.get(barcode) || []), row]);
  }

  let existingSkuMatchedCount = 0;
  let existingNameChangeCount = 0;
  let existingAvailabilityChangeCount = 0;
  let duplicateCount = 0;
  let barcodeConflictCount = 0;
  const updates: SupplyStatusProposedUpdate[] = [];

  for (const [skuKey, downloads] of downloadRowsBySku) {
    const products = productRowsBySku.get(skuKey) || [];
    if (downloads.length > 1) {
      duplicateCount += 1;
      issues.push({ type: "duplicate", skuId: downloads[0].skuId, message: `다운로드 파일에 같은 SKU ID가 ${downloads.length}행 있습니다.` });
      continue;
    }
    if (products.length > 1) {
      duplicateCount += 1;
      issues.push({ type: "duplicate", skuId: downloads[0].skuId, message: `제품DB에 같은 SKU ID가 ${products.length}행 있습니다.` });
      continue;
    }
    if (products.length !== 1) continue;

    existingSkuMatchedCount += 1;
    const download = downloads[0];
    const product = products[0];
    const currentBarcode = String(product.row[idx.barcode] ?? "").trim();
    if (currentBarcode && norm(currentBarcode) !== norm(download.barcode)) {
      barcodeConflictCount += 1;
      const barcodeOwners = (downloadRowsByBarcode.get(norm(currentBarcode)) || [])
        .map(owner => owner.skuId)
        .filter(ownerSkuId => ownerSkuId && norm(ownerSkuId) !== skuKey);
      const ownerMessage = barcodeOwners.length > 0
        ? ` 현재 제품DB 바코드는 쿠팡 파일에서 다른 SKU ${[...new Set(barcodeOwners)].join(", ")}에 연결되어 있습니다.`
        : "";
      issues.push({
        type: "barcode_conflict",
        sheetRowNumber: product.sheetRowNumber,
        modelSku: String(product.row[idx.modelSku] ?? "").trim(),
        skuId: download.skuId,
        productName: String(product.row[idx.productName] ?? "").trim(),
        optionName: String(product.row[idx.color] ?? "").trim(),
        message: `불변 바코드가 다릅니다: 제품DB ${currentBarcode} / 다운로드 ${download.barcode}.${ownerMessage}`,
      });
      continue;
    }
    const updateProductName = Boolean(download.productName) && norm(product.row[idx.productName]) !== norm(download.productName);
    const updateOrderAvailability = norm(product.row[idx.orderAvailability]) !== norm(download.approvalRaw);
    if (updateProductName) existingNameChangeCount += 1;
    if (updateOrderAvailability) existingAvailabilityChangeCount += 1;
    if (updateProductName || updateOrderAvailability) {
      updates.push({
        kind: "existing_sku",
        sheetRowNumber: product.sheetRowNumber,
        modelSku: String(product.row[idx.modelSku] ?? "").trim(),
        skuId: download.skuId,
        productName: download.productName,
        barcode: download.barcode,
        orderAvailability: download.approvalRaw,
        updateProductName,
        updateOrderAvailability,
      });
    }
  }

  const pendingRows = dataRows
    .map((row, index) => ({ row, sheetRowNumber: index + 2 }))
    .filter(({ row }) => PENDING_STATUS_VALUES.has(String(row[idx.status] ?? "").trim()) && !norm(row[idx.skuId]));

  const pendingCandidates: { sheetRowNumber: number; modelSku: string; skuId: string }[] = [];
  let awaitingApprovalCount = 0;
  let unmatchedCount = 0;
  for (const { row, sheetRowNumber } of pendingRows) {
    const modelSku = String(row[idx.modelSku] ?? "").trim();
    const match = findSupplyStatusCandidates(
      rocketRows,
      modelSku,
      "",
      String(row[idx.productName] ?? "").trim(),
      String(row[idx.color] ?? "").trim()
    );
    if (match.candidates.length > 1) {
      duplicateCount += 1;
      issues.push({ type: "duplicate", sheetRowNumber, modelSku, productName: String(row[idx.productName] ?? "").trim(), optionName: String(row[idx.color] ?? "").trim(), message: `승인 후보가 ${match.candidates.length}개입니다.` });
      continue;
    }
    if (match.candidates.length === 0) {
      awaitingApprovalCount += 1;
      continue;
    }
    const candidate = match.candidates[0];
    if (!candidate.approved) {
      awaitingApprovalCount += 1;
      continue;
    }
    if (!candidate.skuId) {
      unmatchedCount += 1;
      issues.push({ type: "unmatched", sheetRowNumber, modelSku, productName: String(row[idx.productName] ?? "").trim(), optionName: String(row[idx.color] ?? "").trim(), message: "승인 후보는 있으나 SKU ID가 비어 있습니다." });
      continue;
    }
    if (productRowsBySku.has(norm(candidate.skuId))) {
      duplicateCount += 1;
      issues.push({ type: "duplicate", sheetRowNumber, modelSku, skuId: candidate.skuId, message: "후보 SKU ID가 제품DB의 다른 행에 이미 연결되어 있습니다." });
      continue;
    }
    pendingCandidates.push({ sheetRowNumber, modelSku, skuId: candidate.skuId });
  }

  const candidateUsage = new Map<string, number>();
  pendingCandidates.forEach(candidate => candidateUsage.set(norm(candidate.skuId), (candidateUsage.get(norm(candidate.skuId)) || 0) + 1));
  const duplicatedCandidateKeys = new Set([...candidateUsage].filter(([, count]) => count > 1).map(([skuId]) => skuId));
  for (const candidate of pendingCandidates.filter(item => duplicatedCandidateKeys.has(norm(item.skuId)))) {
    duplicateCount += 1;
    issues.push({ type: "duplicate", ...candidate, message: "같은 신규 SKU ID가 여러 승인대기 행에 배정될 후보입니다." });
  }

  for (const candidate of pendingCandidates.filter(item => !duplicatedCandidateKeys.has(norm(item.skuId)))) {
    const source = rocketRows.find(row => norm(row.skuId) === norm(candidate.skuId));
    if (!source) continue;
    updates.push({
      kind: "new_approval",
      sheetRowNumber: candidate.sheetRowNumber,
      modelSku: candidate.modelSku,
      skuId: source.skuId,
      productName: source.productName,
      barcode: source.barcode,
      orderAvailability: source.approvalRaw,
      updateProductName: Boolean(source.productName),
      updateOrderAvailability: Boolean(source.approvalRaw),
    });
  }

  const auditWithoutToken: Omit<SupplyStatusAudit, "dryRunToken"> = {
    fileFound: true,
    readOnly: true,
    fileName: fileInfo.fileName,
    fileMtime: fileInfo.mtime,
    downloadedCount: parsed.rows.length,
    rocketBarcodeCount: rocketRows.length,
    excludedSBarcodeCount,
    excludedOtherBarcodeCount: parsed.rows.length - rocketRows.length - excludedSBarcodeCount,
    pendingProductCount: pendingRows.length,
    newApprovalCandidateCount: pendingCandidates.filter(candidate => !duplicatedCandidateKeys.has(norm(candidate.skuId))).length,
    registrationStatusCheckRequiredCount: awaitingApprovalCount,
    awaitingApprovalCount,
    existingSkuMatchedCount,
    existingNameChangeCount,
    existingAvailabilityChangeCount,
    safeUpdateCount: updates.length,
    duplicateCount,
    barcodeConflictCount,
    unmatchedCount,
    proposedNewRowCount: 0,
    issues,
  };
  const audit: SupplyStatusAudit = {
    ...auditWithoutToken,
    dryRunToken: createAuditDryRunToken(fileInfo.fileName, fileInfo.mtime, updates, issues),
  };
  return { audit, headerIndex: idx, updates };
}

export async function buildSupplyStatusAudit(capture?: SupplyStatusTableCapture): Promise<SupplyStatusAuditOrNotFound> {
  const result = await computeSupplyStatusAudit(capture);
  return result?.audit ?? { fileFound: false };
}

export interface SupplyStatusApplyResult {
  applied: boolean;
  preview: SupplyStatusPreview;
  backupPath?: string;
  backupSheetName?: string;
  writtenCount: number;
  statusOnlyCount: number;
}

/** 미리보기를 서버에서 다시 계산해(클라이언트 캐시를 신뢰하지 않음) 안전 조건을 만족하는
 *  행만 실제로 쓴다. 대상이 0건이면 Google Sheets에 아무 요청도 보내지 않는다. */
export class SupplyStatusPreviewChangedError extends Error {
  constructor() {
    super("dry-run 이후 대상 데이터가 변경되었습니다. 미리보기를 다시 확인해주세요.");
    this.name = "SupplyStatusPreviewChangedError";
  }
}

export interface SupplyStatusAuditApplyResult {
  applied: boolean;
  audit: SupplyStatusAudit;
  backupSheetName?: string;
  writtenRowCount: number;
  newApprovalCount: number;
  existingSkuUpdateCount: number;
  writtenCellCount: number;
}

export function buildSafeSupplyStatusCellUpdates(
  headerIndex: ProductDbHeaderIndex,
  updates: SupplyStatusProposedUpdate[]
): SheetCellUpdate[] {
  const cellUpdates: SheetCellUpdate[] = [];
  for (const update of updates) {
    if (update.kind === "new_approval") {
      cellUpdates.push(
        { row: update.sheetRowNumber, col: headerIndex.status + 1, value: APPROVED_STATUS_CANDIDATE },
        { row: update.sheetRowNumber, col: headerIndex.skuId + 1, value: update.skuId }
      );
      if (update.barcode) cellUpdates.push({ row: update.sheetRowNumber, col: headerIndex.barcode + 1, value: update.barcode });
    }
    if (update.updateProductName) cellUpdates.push({ row: update.sheetRowNumber, col: headerIndex.productName + 1, value: update.productName });
    if (update.updateOrderAvailability) cellUpdates.push({ row: update.sheetRowNumber, col: headerIndex.orderAvailability + 1, value: update.orderAvailability });
  }
  return cellUpdates;
}

/** 진단에서 확정된 안전 항목만 반영한다. 기존 SKU는 상품명·발주가능상태만 수정하고
 * SKU ID와 바코드는 절대 수정하지 않는다. 신규 승인은 기존 승인대기 행만 채우며 행을 추가하지 않는다. */
export async function applySupplyStatusAudit(expectedDryRunToken: string, capture?: SupplyStatusTableCapture): Promise<SupplyStatusAuditApplyResult | { fileFound: false }> {
  const result = await computeSupplyStatusAudit(capture);
  if (!result) return { fileFound: false };
  if (!expectedDryRunToken || expectedDryRunToken !== result.audit.dryRunToken) throw new SupplyStatusPreviewChangedError();
  if (result.updates.length === 0) {
    return { applied: false, audit: result.audit, writtenRowCount: 0, newApprovalCount: 0, existingSkuUpdateCount: 0, writtenCellCount: 0 };
  }

  const backup = await backupSheetWithinSpreadsheet(PRODUCT_DB_SHEET_NAME);
  const rechecked = await computeSupplyStatusAudit(capture);
  if (!rechecked || rechecked.audit.dryRunToken !== result.audit.dryRunToken) throw new SupplyStatusPreviewChangedError();

  const cellUpdates = buildSafeSupplyStatusCellUpdates(rechecked.headerIndex, rechecked.updates);

  await updateSheetCells(PRODUCT_DB_SHEET_NAME, cellUpdates);
  const newApprovalCount = rechecked.updates.filter(update => update.kind === "new_approval").length;
  const existingSkuUpdateCount = rechecked.updates.length - newApprovalCount;
  return {
    applied: true,
    audit: rechecked.audit,
    backupSheetName: backup.sheetName,
    writtenRowCount: rechecked.updates.length,
    newApprovalCount,
    existingSkuUpdateCount,
    writtenCellCount: cellUpdates.length,
  };
}

export async function applySupplyStatusUpdate(expectedDryRunToken: string): Promise<SupplyStatusApplyResult | { fileFound: false }> {
  const result = await computeSupplyStatusMatch();
  if (!result) return { fileFound: false };
  const { preview, headerIndex } = result;
  if (!expectedDryRunToken || expectedDryRunToken !== preview.dryRunToken) throw new SupplyStatusPreviewChangedError();

  const toWrite = preview.rows.filter(r => r.eligible);
  if (toWrite.length === 0 || preview.duplicateCount > 0 || preview.conflictCount > 0) {
    return { applied: false, preview, writtenCount: 0, statusOnlyCount: 0 };
  }

  const timestamp = new Date().toISOString();
  const backupEntries = toWrite.map(r => ({
    sheetRowNumber: r.sheetRowNumber,
    modelSku: r.modelSku,
    beforeStatus: r.currentStatus,
    afterStatus: preview.approvedStatusValue,
    beforeSkuId: r.currentSkuId,
    afterSkuId: r.downloadSkuId,
    afterProductName: r.downloadProductName,
    afterBarcode: r.downloadBarcode,
    afterOrderAvailability: r.downloadOrderAvailability,
  }));
  let backupPath: string | undefined;
  if (!shouldRequireDriveReader()) {
    const backupDir = path.join(process.cwd(), "lib", "wms", "data", "product-db-backups");
    await fs.mkdir(backupDir, { recursive: true });
    const backupFileName = `supply-status-apply_${timestamp.replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_")}.json`;
    backupPath = path.join(backupDir, backupFileName);
    await fs.writeFile(
      backupPath,
      JSON.stringify({ downloadFileName: preview.fileName, appliedAt: timestamp, entries: backupEntries }, null, 2),
      "utf8"
    );
  }

  const fullBackup = await backupSheetWithinSpreadsheet(PRODUCT_DB_SHEET_NAME);
  const rechecked = await computeSupplyStatusMatch();
  if (!rechecked || rechecked.preview.dryRunToken !== preview.dryRunToken) throw new SupplyStatusPreviewChangedError();

  const cellUpdates: SheetCellUpdate[] = [];
  let statusOnlyCount = 0;
  for (const r of toWrite) {
    cellUpdates.push({ row: r.sheetRowNumber, col: headerIndex.status + 1, value: preview.approvedStatusValue });
    if (!r.alreadySame && r.downloadSkuId) {
      cellUpdates.push({ row: r.sheetRowNumber, col: headerIndex.skuId + 1, value: r.downloadSkuId });
    } else {
      statusOnlyCount += 1;
    }
    if (r.downloadBarcode) {
      cellUpdates.push({ row: r.sheetRowNumber, col: headerIndex.barcode + 1, value: r.downloadBarcode });
    }
    if (r.downloadProductName) {
      cellUpdates.push({ row: r.sheetRowNumber, col: headerIndex.productName + 1, value: r.downloadProductName });
    }
    if (r.downloadOrderAvailability) {
      cellUpdates.push({ row: r.sheetRowNumber, col: headerIndex.orderAvailability + 1, value: r.downloadOrderAvailability });
    }
  }

  await updateSheetCells(PRODUCT_DB_SHEET_NAME, cellUpdates);

  return { applied: true, preview, backupPath, backupSheetName: fullBackup.sheetName, writtenCount: toWrite.length, statusOnlyCount };
}
