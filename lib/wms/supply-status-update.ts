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

interface ProductDbHeaderIndex {
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
