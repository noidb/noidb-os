import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import {
  downloadDriveFile,
  isDriveReaderConfigured,
  listDriveFilesFromEnv,
  shouldRequireDriveReader,
} from "./google-drive-reader";

/**
 * 쿠팡 서플라이허브에서 다운로드한 "PO_FOR_CONFIRM(발주번호).xlsx" 원본 파일을 그대로 열어서,
 * 확정수량(I열)만 SKU 기준으로 정확히 채운 새 파일을 만든다. 시트명·서식·병합·다른 셀 값은
 * 전부 그대로 유지되고(원본 워크북을 로드해서 특정 셀만 바꾸는 방식), 원본 파일 자체는
 * 절대 수정하지 않는다 — 매번 새 Buffer로만 반환한다.
 *
 * 실제 샘플 구조 기준(2026-08-19 확인, 병합 없음):
 *   시트명 "상품목록", A=발주번호 B=물류센터 C=입고유형 D=발주상태 E=상품번호(SKU ID)
 *   F=상품바코드 G=상품이름 H=발주수량 I=확정수량 ... U=입고예정일 V=발주등록일시
 *
 * 2026-08-20 전면 개편 — 모바일에서 발주서마다 원본을 하나씩 업로드해야 하던 불편을 없애기
 * 위해, 사용자가 PC에서 미리 넣어둔 Google Drive 동기화 폴더를 서버가 직접 자동 검색한다.
 * 기본 폴더는 WMS_PO_FOR_CONFIRM_DIR 환경변수로 바꿀 수 있고(getPrimaryPoConfirmDir 한 곳에서만
 * 기본값을 관리), 과거에 쓰던 프로젝트 폴더/한진택배업로드 폴더도 하위 호환을 위해 계속
 * 함께 검색한다. 파일명의 괄호 안 숫자만 발주번호로 인정하고(예: "PO_FOR_CONFIRM(139549113).xlsx"
 * → "139549113"), 부분 문자열 일치는 절대 허용하지 않는다 — 정확히 같은 발주번호 전체 일치만
 * 인정한다. 같은 발주번호 파일이 여러 개(같은 폴더든 다른 폴더든) 발견되면 절대 자동으로 고르지
 * 않고 "중복" 상태로만 보고한다. 업로드 방식은 자동검색이 실패했을 때만 쓰는 보조 기능으로
 * 남겨뒀다(buildConfirmedOrderFileFromUpload) — 자동검색 파일이 있으면 그게 항상 우선이다.
 */

const PO_CONFIRM_DIR = path.join(process.cwd(), "lib", "wms", "data", "po-for-confirm");
/** 과거(2026-08-19)에 실제로 원본이 있었던 폴더 — 새 기본 폴더로 옮겨진 뒤에도 하위 호환을
 *  위해 계속 함께 검색한다. 이 경로가 없는 환경(다른 PC/서버 배포)에서는 조용히 건너뛴다. */
const LEGACY_DRIVE_PO_CONFIRM_DIR = "G:\\내 드라이브\\쿠팡데이터\\한진택배업로드";

/** 새 기본 검색 폴더 — 환경변수로 재정의 가능하며, 기본값은 이 함수 한 곳에서만 관리한다
 *  (2026-08-20 사용자 확인: 실제 원본이 저장되는 폴더). */
export function getPrimaryPoConfirmDir(): string {
  return process.env.WMS_PO_FOR_CONFIRM_DIR?.trim() || "G:\\내 드라이브\\쿠팡데이터\\발주서업로드양식";
}

const SHEET_NAME = "상품목록";
const HEADER_ROW = 1;
const PO_NUMBER_COLUMN = 1; // A열 발주번호
const SKU_COLUMN = 5; // E열 상품번호

/** 발주수량/확정수량/납품부족사유 열은 실제 원본 헤더 문자열로 찾는다(2026-08-20 — 열 번호를
 *  추측/고정하지 않기 위함). 2026-08-20 실제 PO_FOR_CONFIRM(139549113).xlsx로 확인한 실제
 *  헤더: H열 "발주수량", I열 "확정수량", M열 "납품부족사유"(hiddenSheet!$A$1:$A$20 드롭다운
 *  데이터 유효성 검사 적용됨 — 그 목록의 A7 값과 아래 문구가 정확히 일치함을 확인했다). */
const ORDERED_QTY_HEADER_CANDIDATES = ["발주수량"];
const CONFIRMED_QTY_HEADER_CANDIDATES = ["확정수량"];
const SHORTAGE_REASON_HEADER_CANDIDATES = ["납품부족사유"];

/** 확정수량이 발주수량보다 적은 행에 자동 입력하는 문구 — 원본 드롭다운(hiddenSheet) 목록의
 *  실제 항목과 띄어쓰기·하이픈까지 정확히 일치함을 확인했다. 임의로 새 문구를 만들지 않는다. */
export const SHORTAGE_REASON_TEXT = "협력사 재고부족 - 재고 할당정책";

/** 파일명 괄호 안의 숫자만 발주번호로 인식한다. 예: "PO_FOR_CONFIRM(139549113).xlsx" → "139549113" */
const PO_NUMBER_IN_FILENAME = /\((\d+)\)/;

export class PoConfirmTemplateNotFoundError extends Error {
  constructor(poNumber: string) {
    super(
      `발주확정 원본 파일을 찾지 못했습니다(발주서 ${poNumber}) — ${getPrimaryPoConfirmDir()} 폴더에 ` +
        `"PO_FOR_CONFIRM(${poNumber}).xlsx" 파일을 넣어주세요.`
    );
    this.name = "PoConfirmTemplateNotFoundError";
  }
}

export class PoConfirmDuplicateFileError extends Error {
  constructor(
    public readonly poNumber: string,
    public readonly fileNames: string[]
  ) {
    super(`발주서 ${poNumber}의 원본 파일이 ${fileNames.length}개 발견되어 자동으로 고를 수 없습니다: ${fileNames.join(", ")}`);
    this.name = "PoConfirmDuplicateFileError";
  }
}

export class PoConfirmMismatchError extends Error {
  constructor(
    public readonly expectedPoNumber: string,
    public readonly foundPoNumber: string | null
  ) {
    super(
      foundPoNumber
        ? `파일명 발주번호와 엑셀 내부 발주번호가 다릅니다 — 파일명은 ${expectedPoNumber}이지만 실제 내용은 ${foundPoNumber}용입니다.`
        : `업로드한 파일에서 발주번호를 확인할 수 없습니다 — 원본 PO_FOR_CONFIRM 파일이 맞는지 확인해주세요.`
    );
    this.name = "PoConfirmMismatchError";
  }
}

export class PoConfirmFileReadError extends Error {
  constructor(poNumber: string, detail: string) {
    super(`발주서 ${poNumber}의 원본 파일을 열 수 없습니다(${detail}) — 엑셀에서 열려있지 않은지, Google Drive 동기화가 완료됐는지 확인해주세요.`);
    this.name = "PoConfirmFileReadError";
  }
}

/** 확정수량이 발주수량보다 큰 SKU가 하나라도 있으면 파일을 만들지 않고 이 오류를 던진다
 *  (2026-08-20 신규 — 정상 발주확정 데이터가 아니므로 임의로 발주수량까지 잘라내지 않는다). */
export class PoConfirmQuantityExceededError extends Error {
  constructor(
    public readonly poNumber: string,
    public readonly rows: { skuId: string; orderedQuantity: number; confirmedQuantity: number }[]
  ) {
    super(
      `발주서 ${poNumber}에 확정수량이 발주수량보다 큰 SKU가 있어 서류를 생성하지 않았습니다: ` +
        rows.map(r => `${r.skuId}(발주수량 ${r.orderedQuantity} / 확정수량 ${r.confirmedQuantity})`).join(", ")
    );
    this.name = "PoConfirmQuantityExceededError";
  }
}

/** 원본 파일에서 발주수량/확정수량/납품부족사유 열을 헤더 문자열로 찾지 못하면 이 오류를 던지고
 *  다른 빈 열에 임의로 쓰지 않는다(2026-08-20 신규). */
export class PoConfirmColumnNotFoundError extends Error {
  constructor(poNumber: string, missingHeader: string) {
    super(`발주서 ${poNumber} 원본 파일에서 "${missingHeader}" 열을 찾을 수 없습니다 — 파일 구조를 확인해주세요.`);
    this.name = "PoConfirmColumnNotFoundError";
  }
}

/** 생성 직전 자체 검증에서 문제가 발견되면(있어서는 안 되는 상태) 이 오류를 던진다 — 잘못된
 *  파일을 사용자에게 내려주지 않기 위한 마지막 안전장치(2026-08-20 신규). */
export class PoConfirmSelfCheckFailedError extends Error {
  constructor(poNumber: string, detail: string) {
    super(`발주서 ${poNumber} 서류 생성 후 자체 검증에 실패해 파일을 내려주지 않았습니다: ${detail}`);
    this.name = "PoConfirmSelfCheckFailedError";
  }
}

export type PoConfirmTemplateSource = "google-drive" | "primary" | "project" | "legacy-drive" | "upload";

interface FoundFile {
  filePath?: string;
  driveFileId?: string;
  fileName: string;
  source: PoConfirmTemplateSource;
  /** Drive file id or resolved local path. It is metadata only; SHA-256 remains the logical identity. */
  sourceId?: string;
}

function extractPoNumberFromFileName(fileName: string): string | null {
  const match = fileName.match(PO_NUMBER_IN_FILENAME);
  return match ? match[1] : null;
}

async function listXlsxFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries
      .filter(name => !name.startsWith("~$") && !name.startsWith(".") && name.toLowerCase().endsWith(".xlsx"))
      .sort((a, b) => a.localeCompare(b, "ko"));
  } catch {
    return [];
  }
}

/** 지정한 발주번호와 파일명 괄호 안 숫자가 정확히 전체 일치하는 파일만 모은다(부분일치 금지).
 *  기본 폴더 → 프로젝트 폴더 → 레거시 드라이브 폴더 순서로 전부 검색해 합친다. */
async function findAllMatchesForPo(poNumber: string): Promise<FoundFile[]> {
  const trimmed = poNumber.trim();
  if (isDriveReaderConfigured() || shouldRequireDriveReader()) {
    const files = await listDriveFilesFromEnv("GOOGLE_DRIVE_PO_FOR_CONFIRM_FOLDER_ID");
    return files
      .filter(file => !file.name.startsWith("~$") && !file.name.startsWith(".") && file.name.toLowerCase().endsWith(".xlsx"))
      .filter(file => extractPoNumberFromFileName(file.name) === trimmed)
      .map(file => ({ driveFileId: file.id, fileName: file.name, source: "google-drive" as const, sourceId: `drive:${file.id}` }));
  }

  const searchDirs: { dir: string; source: PoConfirmTemplateSource }[] = [
    { dir: getPrimaryPoConfirmDir(), source: "primary" },
    { dir: PO_CONFIRM_DIR, source: "project" },
    { dir: LEGACY_DRIVE_PO_CONFIRM_DIR, source: "legacy-drive" },
  ];

  const matches: FoundFile[] = [];
  for (const { dir, source } of searchDirs) {
    const files = await listXlsxFiles(dir);
    for (const fileName of files) {
      const extracted = extractPoNumberFromFileName(fileName);
      if (extracted !== null && extracted === trimmed) {
        const filePath = path.join(dir, fileName);
        matches.push({ filePath, fileName, source, sourceId: `local:${path.resolve(filePath)}` });
      }
    }
  }
  return matches;
}

async function loadFoundBuffer(match: FoundFile): Promise<Buffer> {
  if (match.driveFileId) {
    return downloadDriveFile(match.driveFileId);
  }
  if (match.filePath) return readFile(match.filePath);
  throw new Error("발주확정 원본 위치가 없습니다.");
}

async function loadFoundWorkbook(match: FoundFile): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const buffer = await loadFoundBuffer(match);
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return workbook;
}

async function resolveSingleMatch(poNumber: string): Promise<FoundFile> {
  const matches = await findAllMatchesForPo(poNumber);
  if (matches.length === 0) throw new PoConfirmTemplateNotFoundError(poNumber);
  if (matches.length > 1) throw new PoConfirmDuplicateFileError(poNumber, matches.map(m => m.fileName));
  return matches[0];
}

/** 화면에서 "업로드 필요" 여부를 미리 보여주기 위한 조회 전용 함수 — 아무것도 만들지 않는다.
 *  기존(2026-08-19) 단순 boolean 결과 형태를 유지한다 — 더 상세한 상태(중복/오류 구분 포함)가
 *  필요하면 checkPoConfirmFolderStatus를 쓴다. */
export async function checkPoConfirmAvailability(poNumber: string): Promise<{ available: boolean; source: PoConfirmTemplateSource | null }> {
  const matches = await findAllMatchesForPo(poNumber);
  if (matches.length !== 1) return { available: false, source: null };
  return { available: true, source: matches[0].source };
}

export type PoFolderFileStatus = "found" | "missing" | "duplicate" | "error";

export interface PoFolderStatusEntry {
  poNumber: string;
  status: PoFolderFileStatus;
  fileName?: string;
  duplicateFileNames?: string[];
  errorMessage?: string;
}

/**
 * 발주번호별 원본파일 상태를 폴더에서 다시 조회한다 — "원본파일 다시 확인" 버튼과 화면 최초
 * 진입 시 사용. 파일이 정확히 1개 발견되면 실제로 열어서 내부 발주번호(A열)까지 확인한다(파일명만
 * 믿지 않음) — 열기 실패(잠김/손상/동기화 미완료)나 내부 발주번호 불일치도 여기서 걸러낸다.
 * 아무것도 쓰지 않는다.
 */
export async function checkPoConfirmFolderStatus(poNumbers: string[]): Promise<{ primaryDir: string; entries: PoFolderStatusEntry[] }> {
  const primaryDir = isDriveReaderConfigured() || shouldRequireDriveReader()
    ? "Google Drive / 발주서업로드양식"
    : getPrimaryPoConfirmDir();
  const entries: PoFolderStatusEntry[] = [];

  for (const poNumber of poNumbers) {
    const matches = await findAllMatchesForPo(poNumber);
    if (matches.length === 0) {
      entries.push({ poNumber, status: "missing" });
      continue;
    }
    if (matches.length > 1) {
      entries.push({ poNumber, status: "duplicate", duplicateFileNames: matches.map(m => m.fileName) });
      continue;
    }

    const match = matches[0];
    try {
      const workbook = await loadFoundWorkbook(match);
      const innerPoNumber = extractPoNumberFromWorkbook(workbook);
      if (innerPoNumber !== poNumber.trim()) {
        entries.push({
          poNumber,
          status: "error",
          errorMessage: `파일명 발주번호와 엑셀 내부 발주번호가 다릅니다(내부: ${innerPoNumber || "확인 불가"}).`,
        });
        continue;
      }
      entries.push({ poNumber, status: "found", fileName: match.fileName });
    } catch {
      entries.push({
        poNumber,
        status: "error",
        errorMessage: "원본 파일을 열 수 없습니다 — 엑셀에서 열려있지 않은지, Google Drive 동기화가 완료됐는지 확인해주세요.",
      });
    }
  }

  return { primaryDir, entries };
}

/** 검색 대상 폴더 자체가 없는지(예: G: 드라이브 자체가 연결 안 됨) 미리 확인한다 — 있으면 true. */
export async function isPoConfirmFolderAccessible(): Promise<boolean> {
  if (isDriveReaderConfigured() || shouldRequireDriveReader()) {
    try {
      await listDriveFilesFromEnv("GOOGLE_DRIVE_PO_FOR_CONFIRM_FOLDER_ID");
      return true;
    } catch {
      return false;
    }
  }
  try {
    const info = await stat(getPrimaryPoConfirmDir());
    return info.isDirectory();
  } catch {
    return false;
  }
}

/** 업로드된 워크북의 실제 `발주번호` 헤더를 찾아 모든 데이터 행의 발주번호를 원본 순서대로 읽는다. */
export function extractPoNumbersFromWorkbook(workbook: ExcelJS.Workbook): string[] {
  try {
    const layout = findBatchWorkbookLayout(workbook);
    const found = new Set<string>();
    for (let row = layout.headerRow + 1; row <= layout.sheet.rowCount; row++) {
      const poNumber = cellText(layout.sheet.getCell(row, layout.columns.purchaseOrderNumber));
      if (poNumber) found.add(poNumber);
    }
    return [...found];
  } catch {
    return [];
  }
}

/** 새 통합 원본 검색은 `발주서업로드양식/PO` 같은 실제 하위 폴더까지 읽는다. */
async function listXlsxFilesRecursive(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await listXlsxFilesRecursive(fullPath)));
      } else if (
        entry.isFile() &&
        !entry.name.startsWith("~$") &&
        entry.name.toLowerCase().endsWith(".xlsx")
      ) {
        files.push(fullPath);
      }
    }
    return files.sort((a, b) => a.localeCompare(b, "ko"));
  } catch {
    return [];
  }
}

/** 하위 호환용 단일 값. 새 흐름은 extractPoNumbersFromWorkbook/manifest를 사용한다. */
export function extractPoNumberFromWorkbook(workbook: ExcelJS.Workbook): string | null {
  return extractPoNumbersFromWorkbook(workbook)[0] || null;
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
  /** 확정수량 < 발주수량이라 납품부족사유를 자동 입력한 행 수 (2026-08-20 신규) */
  shortageRowCount: number;
  /** 납품부족사유를 실제로 써넣은 행 수 — shortageRowCount와 항상 같다(자체검증 통과 시). */
  reasonAppliedCount: number;
}

function findHeaderColumn(sheet: ExcelJS.Worksheet, headerNames: string[]): number | null {
  const headerRow = sheet.getRow(HEADER_ROW);
  for (let col = 1; col <= sheet.columnCount; col++) {
    const text = String(headerRow.getCell(col).value ?? "").trim();
    if (headerNames.includes(text)) return col;
  }
  return null;
}

/**
 * 확정수량 반영 + 납품부족사유 자동 입력을 한 곳에서 처리한다(2026-08-20 개편) — 개별 생성/ZIP
 * 생성/업로드 생성 전부 이 함수 하나만 거친다.
 *
 * 처리 순서: ①헤더 문자열로 발주수량/확정수량/납품부족사유 열을 찾는다(못 찾으면 즉시 중단,
 * 다른 빈 열에 임의로 쓰지 않음) → ②모든 대상 행을 먼저 검증만 해서 확정수량이 발주수량보다
 * 큰 행이 있으면 아무것도 쓰지 않고 즉시 오류 → ③검증을 통과해야만 실제로 셀에 쓴다(확정수량은
 * 항상 갱신, 납품부족사유는 확정<발주일 때만 정확한 문구를 넣고 같을 때는 원본 값을 그대로
 * 둔다) → ④쓴 뒤 자체 검증(부족 행에 사유 누락이 없는지)까지 통과해야 결과를 반환한다.
 * 납품부족사유 셀의 기존 데이터 유효성 검사(드롭다운)·서식은 셀 값만 바꾸므로 그대로 유지된다.
 */
function applyConfirmedQuantities(
  workbook: ExcelJS.Workbook,
  poNumber: string,
  confirmedQuantities: ConfirmedQuantityInput[]
): { matchedSkuIds: Set<string>; unmatchedSkuIds: string[]; shortageRowCount: number; reasonAppliedCount: number } {
  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) {
    throw new Error(`원본 파일에 "${SHEET_NAME}" 시트를 찾을 수 없습니다. 파일 구조를 확인해주세요.`);
  }

  const orderedCol = findHeaderColumn(sheet, ORDERED_QTY_HEADER_CANDIDATES);
  if (!orderedCol) throw new PoConfirmColumnNotFoundError(poNumber, ORDERED_QTY_HEADER_CANDIDATES[0]);
  const confirmedCol = findHeaderColumn(sheet, CONFIRMED_QTY_HEADER_CANDIDATES);
  if (!confirmedCol) throw new PoConfirmColumnNotFoundError(poNumber, CONFIRMED_QTY_HEADER_CANDIDATES[0]);
  const reasonCol = findHeaderColumn(sheet, SHORTAGE_REASON_HEADER_CANDIDATES);
  if (!reasonCol) throw new PoConfirmColumnNotFoundError(poNumber, SHORTAGE_REASON_HEADER_CANDIDATES[0]);

  const qtyBySku = new Map(confirmedQuantities.map(item => [item.skuId.trim(), item.confirmedQuantity]));
  const matchedSkuIds = new Set<string>();

  // 1차: 대상 행만 모으고 검증한다 — 아직 워크북에 아무것도 쓰지 않는다.
  const rowsToWrite: { row: number; skuId: string; orderedQuantity: number; confirmedQuantity: number }[] = [];
  const exceededRows: { skuId: string; orderedQuantity: number; confirmedQuantity: number }[] = [];

  let row = HEADER_ROW + 1;
  while (row <= sheet.rowCount) {
    const skuId = String(sheet.getCell(row, SKU_COLUMN).value ?? "").trim();
    if (!skuId) break;
    if (qtyBySku.has(skuId)) {
      const orderedQuantity = Number(sheet.getCell(row, orderedCol).value) || 0;
      const confirmedQuantity = qtyBySku.get(skuId)!;
      matchedSkuIds.add(skuId);
      rowsToWrite.push({ row, skuId, orderedQuantity, confirmedQuantity });
      if (confirmedQuantity > orderedQuantity) {
        exceededRows.push({ skuId, orderedQuantity, confirmedQuantity });
      }
    }
    row += 1;
  }

  if (exceededRows.length > 0) {
    throw new PoConfirmQuantityExceededError(poNumber, exceededRows);
  }

  // 2차: 검증을 통과했으므로 실제로 쓴다.
  let shortageRowCount = 0;
  let reasonAppliedCount = 0;
  for (const r of rowsToWrite) {
    sheet.getCell(r.row, confirmedCol).value = r.confirmedQuantity;
    if (r.confirmedQuantity < r.orderedQuantity) {
      sheet.getCell(r.row, reasonCol).value = SHORTAGE_REASON_TEXT;
      shortageRowCount += 1;
      reasonAppliedCount += 1;
    }
    // 확정수량 === 발주수량이면 납품부족사유 열을 건드리지 않는다(원본이 빈칸이면 빈칸 유지).
  }

  // 3차: 생성 전 자체 검증 — 부족 행에 사유가 실제로 들어갔는지 다시 읽어 확인한다.
  for (const r of rowsToWrite) {
    if (r.confirmedQuantity < r.orderedQuantity) {
      const actual = String(sheet.getCell(r.row, reasonCol).value ?? "").trim();
      if (actual !== SHORTAGE_REASON_TEXT) {
        throw new PoConfirmSelfCheckFailedError(poNumber, `SKU ${r.skuId}: 납품부족사유가 정상적으로 입력되지 않았습니다.`);
      }
    }
  }

  const unmatchedSkuIds = confirmedQuantities.map(item => item.skuId.trim()).filter(skuId => !matchedSkuIds.has(skuId));
  return { matchedSkuIds, unmatchedSkuIds, shortageRowCount, reasonAppliedCount };
}

/** 자동 검색 폴더(기본 폴더 → 프로젝트 폴더 → 레거시 드라이브 폴더)에서 정확히 1개만 찾아
 *  확정수량을 채운다. 못 찾으면 PoConfirmTemplateNotFoundError, 여러 개면
 *  PoConfirmDuplicateFileError, 내부 발주번호가 파일명과 다르면 PoConfirmMismatchError. */
export async function buildConfirmedOrderFile(poNumber: string, confirmedQuantities: ConfirmedQuantityInput[]): Promise<BuildConfirmedOrderResult> {
  const match = await resolveSingleMatch(poNumber);

  try {
    const workbook = await loadFoundWorkbook(match);
    const innerPoNumber = extractPoNumberFromWorkbook(workbook);
    if (innerPoNumber !== poNumber.trim()) {
      throw new PoConfirmMismatchError(poNumber, innerPoNumber);
    }

    const { matchedSkuIds, unmatchedSkuIds, shortageRowCount, reasonAppliedCount } = applyConfirmedQuantities(workbook, poNumber, confirmedQuantities);
    const buffer = await workbook.xlsx.writeBuffer();
    return { buffer, matchedSkuCount: matchedSkuIds.size, unmatchedSkuIds, sourceFileName: match.fileName, shortageRowCount, reasonAppliedCount };
  } catch (error) {
    if (error instanceof PoConfirmMismatchError || error instanceof PoConfirmQuantityExceededError || error instanceof PoConfirmColumnNotFoundError || error instanceof PoConfirmSelfCheckFailedError) throw error;
    throw new PoConfirmFileReadError(poNumber, error instanceof Error ? error.message : "알 수 없는 오류");
  }
}

/**
 * 자동 검색에 실패했을 때만 쓰는 보조 수단 — 사용자가 직접 업로드한 원본으로 대신 만든다.
 * 업로드 파일의 실제 발주번호(A열)가 요청한 발주번호와 다르면 PoConfirmMismatchError를 던지고
 * 아무것도 만들지 않는다 — 다른 발주서 원본을 잘못 써서 확정수량이 엉뚱한 파일에 채워지는 것을
 * 막기 위한 안전장치다. 업로드된 파일은 메모리에서만 다루고 어디에도 저장하지 않는다.
 */
export async function buildConfirmedOrderFileFromUpload(
  uploadedBuffer: Buffer,
  poNumber: string,
  confirmedQuantities: ConfirmedQuantityInput[]
): Promise<BuildConfirmedOrderResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(uploadedBuffer as unknown as ExcelJS.Buffer);

  const foundPoNumber = extractPoNumberFromWorkbook(workbook);
  if (foundPoNumber !== poNumber) throw new PoConfirmMismatchError(poNumber, foundPoNumber);

  const { matchedSkuIds, unmatchedSkuIds, shortageRowCount, reasonAppliedCount } = applyConfirmedQuantities(workbook, poNumber, confirmedQuantities);
  const buffer = await workbook.xlsx.writeBuffer();

  return {
    buffer,
    matchedSkuCount: matchedSkuIds.size,
    unmatchedSkuIds,
    sourceFileName: `업로드한 파일(발주서 ${poNumber})`,
    shortageRowCount,
    reasonAppliedCount,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 다중 발주번호가 한 PO_FOR_CONFIRM 파일에 들어오는 현재 쿠팡 양식용 공통 로직.
// 기존 단일 발주 API는 하위 호환을 위해 위에 그대로 두고, 새 UI/API는 아래 manifest와
// buildSelectedPoConfirmWorkbook만 사용한다.

const BATCH_REQUIRED_HEADERS = {
  purchaseOrderNumber: "발주번호",
  fulfillmentCenter: "물류센터",
  status: "발주상태",
  skuId: "상품번호",
  orderedQuantity: "발주수량",
  confirmedQuantity: "확정수량",
  shortageReason: "납품부족사유",
} as const;

type BatchHeaderKey = keyof typeof BATCH_REQUIRED_HEADERS;

interface BatchWorkbookLayout {
  sheet: ExcelJS.Worksheet;
  headerRow: number;
  columns: Record<BatchHeaderKey, number>;
  headers: string[];
}

interface BatchSourceRow {
  originalRowNumber: number;
  purchaseOrderNumber: string;
  skuId: string;
  orderedQuantity: number;
  fulfillmentCenter: string;
  status: string;
  valueKeys: string[];
  styleKeys: string[];
  dataValidations: { column: number; validation: ExcelJS.DataValidation; comparableKey: string }[];
}

interface InspectedPoConfirmWorkbook {
  buffer: Buffer;
  workbook: ExcelJS.Workbook;
  layout: BatchWorkbookLayout;
  rows: BatchSourceRow[];
  manifest: PoConfirmSourceManifest;
}

interface LoadedSourceCandidate extends InspectedPoConfirmWorkbook {
  match: FoundFile;
}

export interface PoConfirmPurchaseOrderManifest {
  purchaseOrderNumber: string;
  rowCount: number;
  skuCount: number;
  totalOrderedQuantity: number;
  statusValues: string[];
  fulfillmentCenters: string[];
  /** 원본 D열이 명시적인 발주/거래처확인 완료 상태일 때만 true다. */
  sourceConfirmed: boolean;
  errorMessages: string[];
}

export interface PoConfirmSourceManifest {
  fileName: string;
  fileHash: string;
  source: PoConfirmTemplateSource;
  sourceId?: string;
  totalPurchaseOrderCount: number;
  totalRowCount: number;
  sheetNames: string[];
  purchaseOrders: PoConfirmPurchaseOrderManifest[];
}

export interface InspectPoConfirmSourceInput {
  targetPoNumbers?: string[];
  uploadedBuffer?: Buffer;
  uploadedFileName?: string;
}

export interface ConfirmedQuantitiesByPoInput {
  poNumber: string;
  quantities: ConfirmedQuantityInput[];
}

export interface BuildSelectedPoConfirmInput {
  selectedPoNumbers: string[];
  confirmedQuantitiesByPo: ConfirmedQuantitiesByPoInput[];
  expectedSourceHash: string;
  uploadedBuffer?: Buffer;
  uploadedFileName?: string;
}

export interface BuildSelectedPoConfirmResult {
  buffer: ExcelJS.Buffer;
  source: PoConfirmSourceManifest;
  selectedPoNumbers: string[];
  totalRowCount: number;
  rowCountsByPo: Record<string, number>;
  matchedSkuCount: number;
  shortageRowCount: number;
  reasonAppliedCount: number;
}

export class PoConfirmSourceNotFoundError extends Error {
  constructor(public readonly targetPoNumbers: string[], detail?: string) {
    super(
      targetPoNumbers.length > 0
        ? `선택한 발주번호가 들어 있는 PO_FOR_CONFIRM 원본을 찾지 못했습니다: ${targetPoNumbers.join(", ")}${detail ? ` (${detail})` : ""}`
        : `PO_FOR_CONFIRM 원본 파일을 찾지 못했습니다${detail ? ` (${detail})` : ""}.`
    );
    this.name = "PoConfirmSourceNotFoundError";
  }
}

export interface PoConfirmSourceConflictCandidate {
  fileName: string;
  fileHash: string;
  overlapCount: number;
  purchaseOrderNumbers: string[];
}

export class PoConfirmSourceConflictError extends Error {
  constructor(public readonly candidates: PoConfirmSourceConflictCandidate[]) {
    super(
      "서로 다른 원본 파일이 같은 수의 대상 발주번호와 겹쳐 자동으로 고를 수 없습니다: " +
        candidates.map(candidate => `${candidate.fileName}(${candidate.overlapCount}건)`).join(", ")
    );
    this.name = "PoConfirmSourceConflictError";
  }
}

export class PoConfirmSourceInspectionError extends Error {
  constructor(detail: string) {
    super(`PO_FOR_CONFIRM 원본 구조를 확인할 수 없습니다: ${detail}`);
    this.name = "PoConfirmSourceInspectionError";
  }
}

export class PoConfirmSourceHashMismatchError extends Error {
  constructor(
    public readonly expectedHash: string,
    public readonly actualHash: string | null
  ) {
    super(
      actualHash
        ? `미리보기 이후 원본 파일이 변경되었습니다(예상 ${expectedHash}, 현재 ${actualHash}). 다시 확인한 뒤 생성해주세요.`
        : `미리보기에서 확인한 원본 파일(${expectedHash})을 다시 찾지 못했습니다. 다시 확인한 뒤 생성해주세요.`
    );
    this.name = "PoConfirmSourceHashMismatchError";
  }
}

export class PoConfirmSelectionValidationError extends Error {
  constructor(public readonly details: string[]) {
    super(`선택 발주 검증에 실패했습니다: ${details.join(" / ")}`);
    this.name = "PoConfirmSelectionValidationError";
  }
}

export class PoConfirmBatchSelfCheckFailedError extends Error {
  constructor(detail: string) {
    super(`통합 발주확정 파일 자체검증에 실패해 파일을 내려주지 않았습니다: ${detail}`);
    this.name = "PoConfirmBatchSelfCheckFailedError";
  }
}

function cellText(cell: ExcelJS.Cell): string {
  return String(cell.text || cell.value || "").trim();
}

function normalizedPoNumbers(values: string[]): string[] {
  return values.map(value => String(value || "").trim()).filter(Boolean);
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function comparableValue(value: unknown): unknown {
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Array.isArray(value)) return value.map(comparableValue);
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map(key => [key, comparableValue(object[key])])
    );
  }
  return value ?? null;
}

function comparableKey(value: unknown): string {
  return JSON.stringify(comparableValue(value));
}

function cloneSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parseQuantity(value: ExcelJS.CellValue): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** `거래처확인요청` 같은 요청/대기 상태는 절대로 완료로 보지 않는다. */
export function isExplicitPoConfirmCompletedStatus(status: string): boolean {
  const normalized = status.replace(/\s+/g, "").trim();
  if (!normalized || /요청|대기|예정|취소|반려/.test(normalized)) return false;
  return normalized.endsWith("완료") && /발주|확정|거래처확인/.test(normalized);
}

function findBatchWorkbookLayout(workbook: ExcelJS.Workbook): BatchWorkbookLayout {
  const namedSheet = workbook.getWorksheet(SHEET_NAME);
  const sheets = namedSheet
    ? [namedSheet, ...workbook.worksheets.filter(sheet => sheet.id !== namedSheet.id)]
    : workbook.worksheets;

  for (const sheet of sheets) {
    for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber++) {
      const headerByText = new Map<string, number>();
      for (let column = 1; column <= sheet.columnCount; column++) {
        const text = cellText(sheet.getCell(rowNumber, column));
        if (text && !headerByText.has(text)) headerByText.set(text, column);
      }
      const entries = Object.entries(BATCH_REQUIRED_HEADERS) as [BatchHeaderKey, string][];
      if (!entries.every(([, header]) => headerByText.has(header))) continue;

      const columns = {} as Record<BatchHeaderKey, number>;
      for (const [key, header] of entries) columns[key] = headerByText.get(header)!;
      return {
        sheet,
        headerRow: rowNumber,
        columns,
        headers: Array.from({ length: sheet.columnCount }, (_, index) => cellText(sheet.getCell(rowNumber, index + 1))),
      };
    }
  }

  throw new PoConfirmSourceInspectionError(
    `"${BATCH_REQUIRED_HEADERS.purchaseOrderNumber}"·"${BATCH_REQUIRED_HEADERS.skuId}" 등 필수 헤더를 한 행에서 찾지 못했습니다.`
  );
}

function rowHasAnyValue(sheet: ExcelJS.Worksheet, rowNumber: number): boolean {
  for (let column = 1; column <= sheet.columnCount; column++) {
    if (cellText(sheet.getCell(rowNumber, column))) return true;
  }
  return false;
}

function rowSnapshot(sheet: ExcelJS.Worksheet, rowNumber: number): Pick<BatchSourceRow, "valueKeys" | "styleKeys" | "dataValidations"> {
  const valueKeys: string[] = [];
  const styleKeys: string[] = [];
  const dataValidations: BatchSourceRow["dataValidations"] = [];
  for (let column = 1; column <= sheet.columnCount; column++) {
    const cell = sheet.getCell(rowNumber, column);
    valueKeys.push(comparableKey(cell.value));
    styleKeys.push(comparableKey(cell.style));
    const validation = cell.dataValidation;
    if (validation && Object.keys(validation).length > 0) {
      dataValidations.push({
        column,
        validation: cloneSerializable(validation),
        comparableKey: comparableKey(validation),
      });
    }
  }
  return { valueKeys, styleKeys, dataValidations };
}

async function inspectPoConfirmWorkbookDetailed(
  buffer: Buffer,
  metadata: { fileName: string; source: PoConfirmTemplateSource; sourceId?: string }
): Promise<InspectedPoConfirmWorkbook> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch (error) {
    throw new PoConfirmSourceInspectionError(error instanceof Error ? error.message : "엑셀 파일을 열 수 없습니다.");
  }
  const layout = findBatchWorkbookLayout(workbook);
  const rows: BatchSourceRow[] = [];
  const globalErrors: string[] = [];

  for (let rowNumber = layout.headerRow + 1; rowNumber <= layout.sheet.rowCount; rowNumber++) {
    if (!rowHasAnyValue(layout.sheet, rowNumber)) continue;
    const purchaseOrderNumber = cellText(layout.sheet.getCell(rowNumber, layout.columns.purchaseOrderNumber));
    const skuId = cellText(layout.sheet.getCell(rowNumber, layout.columns.skuId));
    if (!purchaseOrderNumber || !skuId) {
      globalErrors.push(
        `${rowNumber}행: ${!purchaseOrderNumber ? "발주번호" : ""}${!purchaseOrderNumber && !skuId ? "·" : ""}${!skuId ? "상품번호" : ""}가 비어 있습니다.`
      );
      continue;
    }
    const orderedQuantity = parseQuantity(layout.sheet.getCell(rowNumber, layout.columns.orderedQuantity).value);
    const snapshot = rowSnapshot(layout.sheet, rowNumber);
    rows.push({
      originalRowNumber: rowNumber,
      purchaseOrderNumber,
      skuId,
      orderedQuantity: orderedQuantity ?? Number.NaN,
      fulfillmentCenter: cellText(layout.sheet.getCell(rowNumber, layout.columns.fulfillmentCenter)),
      status: cellText(layout.sheet.getCell(rowNumber, layout.columns.status)),
      ...snapshot,
    });
  }

  if (globalErrors.length > 0) throw new PoConfirmSourceInspectionError(globalErrors.join(" / "));
  if (rows.length === 0) throw new PoConfirmSourceInspectionError("발주 데이터 행이 없습니다.");

  interface Group {
    rows: BatchSourceRow[];
    skuIds: Set<string>;
    statusValues: Set<string>;
    fulfillmentCenters: Set<string>;
    errorMessages: string[];
  }
  const groupByPo = new Map<string, Group>();
  for (const row of rows) {
    let group = groupByPo.get(row.purchaseOrderNumber);
    if (!group) {
      group = { rows: [], skuIds: new Set(), statusValues: new Set(), fulfillmentCenters: new Set(), errorMessages: [] };
      groupByPo.set(row.purchaseOrderNumber, group);
    }
    group.rows.push(row);
    if (group.skuIds.has(row.skuId)) group.errorMessages.push(`상품번호 ${row.skuId}가 같은 발주에 2행 이상 있습니다.`);
    group.skuIds.add(row.skuId);
    if (row.status) group.statusValues.add(row.status);
    if (row.fulfillmentCenter) group.fulfillmentCenters.add(row.fulfillmentCenter);
    if (!Number.isFinite(row.orderedQuantity) || row.orderedQuantity < 0) {
      group.errorMessages.push(`${row.originalRowNumber}행 상품번호 ${row.skuId}: 발주수량이 올바른 숫자가 아닙니다.`);
    }
    const sourceConfirmedValue = layout.sheet.getCell(row.originalRowNumber, layout.columns.confirmedQuantity).value;
    const sourceConfirmedText = cellText(layout.sheet.getCell(row.originalRowNumber, layout.columns.confirmedQuantity));
    if (sourceConfirmedText && parseQuantity(sourceConfirmedValue) === null) {
      group.errorMessages.push(`${row.originalRowNumber}행 상품번호 ${row.skuId}: 원본 확정수량이 올바른 숫자가 아닙니다.`);
    }
  }

  const purchaseOrders: PoConfirmPurchaseOrderManifest[] = [];
  for (const [purchaseOrderNumber, group] of groupByPo) {
    const statusValues = [...group.statusValues];
    const completedFlags = statusValues.map(isExplicitPoConfirmCompletedStatus);
    if (completedFlags.some(Boolean) && completedFlags.some(value => !value)) {
      group.errorMessages.push("발주상태가 완료와 미완료로 섞여 있습니다.");
    }
    purchaseOrders.push({
      purchaseOrderNumber,
      rowCount: group.rows.length,
      skuCount: group.skuIds.size,
      totalOrderedQuantity: group.rows.reduce(
        (sum, row) => sum + (Number.isFinite(row.orderedQuantity) ? row.orderedQuantity : 0),
        0
      ),
      statusValues,
      fulfillmentCenters: [...group.fulfillmentCenters],
      sourceConfirmed: statusValues.length > 0 && completedFlags.every(Boolean),
      errorMessages: [...new Set(group.errorMessages)],
    });
  }

  const manifest: PoConfirmSourceManifest = {
    fileName: metadata.fileName,
    fileHash: sha256(buffer),
    source: metadata.source,
    sourceId: metadata.sourceId,
    totalPurchaseOrderCount: purchaseOrders.length,
    totalRowCount: rows.length,
    sheetNames: workbook.worksheets.map(sheet => sheet.name),
    purchaseOrders,
  };

  return { buffer, workbook, layout, rows, manifest };
}

export async function inspectPoConfirmWorkbookBuffer(
  buffer: Buffer,
  fileName = "업로드한 PO_FOR_CONFIRM.xlsx"
): Promise<PoConfirmSourceManifest> {
  return (await inspectPoConfirmWorkbookDetailed(buffer, { fileName, source: "upload", sourceId: `upload:${sha256(buffer)}` })).manifest;
}

async function listAllPoConfirmSourceFiles(): Promise<FoundFile[]> {
  if (isDriveReaderConfigured() || shouldRequireDriveReader()) {
    const files = await listDriveFilesFromEnv("GOOGLE_DRIVE_PO_FOR_CONFIRM_FOLDER_ID");
    return files
      .filter(file => !file.name.startsWith("~$") && !file.name.startsWith(".") && file.name.toLowerCase().endsWith(".xlsx"))
      .map(file => ({
        driveFileId: file.id,
        fileName: file.name,
        source: "google-drive" as const,
        sourceId: `drive:${file.id}`,
      }));
  }

  const searchDirs: { dir: string; source: Exclude<PoConfirmTemplateSource, "google-drive" | "upload"> }[] = [
    { dir: getPrimaryPoConfirmDir(), source: "primary" },
    { dir: PO_CONFIRM_DIR, source: "project" },
    { dir: LEGACY_DRIVE_PO_CONFIRM_DIR, source: "legacy-drive" },
  ];
  const files: FoundFile[] = [];
  const seenSourceIds = new Set<string>();
  for (const { dir, source } of searchDirs) {
    for (const discoveredPath of await listXlsxFilesRecursive(dir)) {
      const filePath = path.resolve(discoveredPath);
      const fileName = path.basename(filePath);
      const sourceId = `local:${filePath}`;
      if (seenSourceIds.has(sourceId)) continue;
      seenSourceIds.add(sourceId);
      files.push({ filePath, fileName, source, sourceId });
    }
  }
  return files;
}

async function loadAutoSourceCandidates(): Promise<LoadedSourceCandidate[]> {
  const matches = await listAllPoConfirmSourceFiles();
  const candidatesByHash = new Map<string, LoadedSourceCandidate>();
  const inspectionErrors: string[] = [];
  for (const match of matches) {
    try {
      const buffer = await loadFoundBuffer(match);
      const inspected = await inspectPoConfirmWorkbookDetailed(buffer, {
        fileName: match.fileName,
        source: match.source,
        sourceId: match.sourceId,
      });
      // 동일 내용이 다른 폴더/Drive id로 중복돼도 한 논리 원본으로만 취급한다.
      if (!candidatesByHash.has(inspected.manifest.fileHash)) {
        candidatesByHash.set(inspected.manifest.fileHash, { ...inspected, match });
      }
    } catch (error) {
      inspectionErrors.push(`${match.fileName}: ${error instanceof Error ? error.message : "확인 실패"}`);
    }
  }
  if (candidatesByHash.size === 0) {
    throw new PoConfirmSourceNotFoundError([], inspectionErrors.length > 0 ? inspectionErrors.join(" / ") : undefined);
  }
  return [...candidatesByHash.values()];
}

function overlapCount(manifest: PoConfirmSourceManifest, targets: Set<string>): number {
  if (targets.size === 0) return manifest.totalPurchaseOrderCount;
  return manifest.purchaseOrders.reduce(
    (count, order) => count + (targets.has(order.purchaseOrderNumber) ? 1 : 0),
    0
  );
}

async function resolveBestAutoSource(targetPoNumbers: string[]): Promise<LoadedSourceCandidate> {
  const targets = new Set(normalizedPoNumbers(targetPoNumbers));
  const candidates = await loadAutoSourceCandidates();
  const scored = candidates.map(candidate => ({ candidate, overlap: overlapCount(candidate.manifest, targets) }));
  const bestOverlap = Math.max(...scored.map(entry => entry.overlap));
  if (bestOverlap <= 0) throw new PoConfirmSourceNotFoundError([...targets]);
  const best = scored.filter(entry => entry.overlap === bestOverlap);
  if (best.length > 1) {
    throw new PoConfirmSourceConflictError(
      best.map(entry => ({
        fileName: entry.candidate.manifest.fileName,
        fileHash: entry.candidate.manifest.fileHash,
        overlapCount: entry.overlap,
        purchaseOrderNumbers: entry.candidate.manifest.purchaseOrders.map(order => order.purchaseOrderNumber),
      }))
    );
  }
  return best[0].candidate;
}

export async function inspectPoConfirmSource(input: InspectPoConfirmSourceInput = {}): Promise<PoConfirmSourceManifest> {
  if (input.uploadedBuffer) {
    return (
      await inspectPoConfirmWorkbookDetailed(input.uploadedBuffer, {
        fileName: input.uploadedFileName?.trim() || "업로드한 PO_FOR_CONFIRM.xlsx",
        source: "upload",
        sourceId: `upload:${sha256(input.uploadedBuffer)}`,
      })
    ).manifest;
  }
  return (await resolveBestAutoSource(input.targetPoNumbers || [])).manifest;
}

async function resolveSourceForGeneration(input: BuildSelectedPoConfirmInput): Promise<InspectedPoConfirmWorkbook> {
  const expectedHash = input.expectedSourceHash.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw new PoConfirmSelectionValidationError(["미리보기 원본 해시가 없거나 올바르지 않습니다."]);
  }
  if (input.uploadedBuffer) {
    const inspected = await inspectPoConfirmWorkbookDetailed(input.uploadedBuffer, {
      fileName: input.uploadedFileName?.trim() || "업로드한 PO_FOR_CONFIRM.xlsx",
      source: "upload",
      sourceId: `upload:${sha256(input.uploadedBuffer)}`,
    });
    if (inspected.manifest.fileHash !== expectedHash) {
      throw new PoConfirmSourceHashMismatchError(expectedHash, inspected.manifest.fileHash);
    }
    return inspected;
  }

  const candidates = await loadAutoSourceCandidates();
  const exact = candidates.find(candidate => candidate.manifest.fileHash === expectedHash);
  if (!exact) {
    const best = await resolveBestAutoSource(input.selectedPoNumbers).catch(() => null);
    throw new PoConfirmSourceHashMismatchError(expectedHash, best?.manifest.fileHash || null);
  }
  return exact;
}

function worksheetStructureSnapshot(workbook: ExcelJS.Workbook): {
  namesAndStates: { name: string; state: string }[];
  nonTargetSheetKeys: Record<string, string>;
} {
  const namesAndStates = workbook.worksheets.map(sheet => ({ name: sheet.name, state: sheet.state }));
  const nonTargetSheetKeys: Record<string, string> = {};
  for (const sheet of workbook.worksheets) {
    if (sheet.name === SHEET_NAME) continue;
    nonTargetSheetKeys[sheet.name] = comparableKey({
      rowCount: sheet.rowCount,
      columnCount: sheet.columnCount,
      values: Array.from({ length: sheet.rowCount }, (_, rowIndex) =>
        Array.from({ length: sheet.columnCount }, (_, columnIndex) => sheet.getCell(rowIndex + 1, columnIndex + 1).value)
      ),
      styles: Array.from({ length: sheet.rowCount }, (_, rowIndex) =>
        Array.from({ length: sheet.columnCount }, (_, columnIndex) => sheet.getCell(rowIndex + 1, columnIndex + 1).style)
      ),
    });
  }
  return { namesAndStates, nonTargetSheetKeys };
}

function columnStructureSnapshot(sheet: ExcelJS.Worksheet): string {
  return comparableKey(
    Array.from({ length: sheet.columnCount }, (_, index) => {
      const column = sheet.getColumn(index + 1);
      return {
        width: column.width ?? null,
        hidden: Boolean(column.hidden),
        outlineLevel: column.outlineLevel ?? 0,
        style: column.style,
      };
    })
  );
}

function worksheetValidationModel(sheet: ExcelJS.Worksheet): Record<string, ExcelJS.DataValidation> {
  return (
    sheet as unknown as { dataValidations: { model: Record<string, ExcelJS.DataValidation> } }
  ).dataValidations.model;
}

function clearWorksheetDataValidations(sheet: ExcelJS.Worksheet): void {
  const model = worksheetValidationModel(sheet);
  for (const key of Object.keys(model)) delete model[key];
}

function compareStringSets(actual: string[], expected: string[]): boolean {
  const a = [...new Set(actual)].sort();
  const b = [...new Set(expected)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export async function buildSelectedPoConfirmWorkbook(
  input: BuildSelectedPoConfirmInput
): Promise<BuildSelectedPoConfirmResult> {
  const selectedPoNumbers = normalizedPoNumbers(input.selectedPoNumbers);
  const validationErrors: string[] = [];
  if (selectedPoNumbers.length === 0) validationErrors.push("선택한 발주번호가 없습니다.");
  if (new Set(selectedPoNumbers).size !== selectedPoNumbers.length) validationErrors.push("선택 발주번호에 중복이 있습니다.");
  if (validationErrors.length > 0) throw new PoConfirmSelectionValidationError(validationErrors);

  // 미리보기 이후의 생성 요청에서는 같은 원본을 스토리지/업로드 bytes에서 다시 읽고 해시를 확인한다.
  const inspected = await resolveSourceForGeneration(input);
  const { workbook, layout, manifest } = inspected;
  const selectedSet = new Set(selectedPoNumbers);
  const manifestByPo = new Map(manifest.purchaseOrders.map(order => [order.purchaseOrderNumber, order]));

  const quantitiesByPo = new Map<string, Map<string, number>>();
  for (const entry of input.confirmedQuantitiesByPo || []) {
    const poNumber = String(entry.poNumber || "").trim();
    if (!poNumber) {
      validationErrors.push("확정수량 목록에 발주번호가 비어 있습니다.");
      continue;
    }
    if (quantitiesByPo.has(poNumber)) {
      validationErrors.push(`발주서 ${poNumber}: 확정수량 묶음이 중복됐습니다.`);
      continue;
    }
    const quantities = new Map<string, number>();
    for (const item of Array.isArray(entry.quantities) ? entry.quantities : []) {
      const skuId = String(item.skuId || "").trim();
      const quantity = Number(item.confirmedQuantity);
      if (!skuId) {
        validationErrors.push(`발주서 ${poNumber}: 상품번호가 빈 확정수량 행이 있습니다.`);
        continue;
      }
      if (quantities.has(skuId)) {
        validationErrors.push(`발주서 ${poNumber}: 상품번호 ${skuId} 확정수량이 중복됐습니다.`);
        continue;
      }
      if (!Number.isInteger(quantity) || quantity < 0) {
        validationErrors.push(`발주서 ${poNumber} 상품번호 ${skuId}: 확정수량은 0 이상의 정수여야 합니다.`);
        continue;
      }
      quantities.set(skuId, quantity);
    }
    quantitiesByPo.set(poNumber, quantities);
  }

  for (const poNumber of selectedPoNumbers) {
    const order = manifestByPo.get(poNumber);
    if (!order) {
      validationErrors.push(`발주서 ${poNumber}: 원본 파일 내부에 없습니다.`);
      continue;
    }
    if (order.sourceConfirmed) validationErrors.push(`발주서 ${poNumber}: 원본 발주상태가 이미 완료입니다.`);
    validationErrors.push(...order.errorMessages.map(message => `발주서 ${poNumber}: ${message}`));
    if (!quantitiesByPo.has(poNumber)) validationErrors.push(`발주서 ${poNumber}: 확정수량 목록이 없습니다.`);
  }
  for (const poNumber of quantitiesByPo.keys()) {
    if (!selectedSet.has(poNumber)) validationErrors.push(`선택하지 않은 발주서 ${poNumber}의 확정수량이 포함됐습니다.`);
  }

  const selectedRows = inspected.rows.filter(row => selectedSet.has(row.purchaseOrderNumber));
  const sourceSkuSets = new Map<string, Set<string>>();
  for (const row of selectedRows) {
    let skuSet = sourceSkuSets.get(row.purchaseOrderNumber);
    if (!skuSet) {
      skuSet = new Set();
      sourceSkuSets.set(row.purchaseOrderNumber, skuSet);
    }
    skuSet.add(row.skuId);
    const confirmedQuantity = quantitiesByPo.get(row.purchaseOrderNumber)?.get(row.skuId);
    if (confirmedQuantity === undefined) {
      validationErrors.push(`발주서 ${row.purchaseOrderNumber} 상품번호 ${row.skuId}: 확정수량이 없습니다.`);
    } else if (confirmedQuantity > row.orderedQuantity) {
      validationErrors.push(
        `발주서 ${row.purchaseOrderNumber} 상품번호 ${row.skuId}: 확정수량 ${confirmedQuantity}이 발주수량 ${row.orderedQuantity}보다 큽니다.`
      );
    }
  }
  for (const poNumber of selectedPoNumbers) {
    const sourceSkuSet = sourceSkuSets.get(poNumber) || new Set<string>();
    const inputSkuSet = new Set(quantitiesByPo.get(poNumber)?.keys() || []);
    for (const skuId of inputSkuSet) {
      if (!sourceSkuSet.has(skuId)) validationErrors.push(`발주서 ${poNumber}: 원본에 없는 상품번호 ${skuId}가 포함됐습니다.`);
    }
  }
  if (validationErrors.length > 0) throw new PoConfirmSelectionValidationError([...new Set(validationErrors)]);

  const expectedRowCounts = Object.fromEntries(
    selectedPoNumbers.map(poNumber => [poNumber, manifestByPo.get(poNumber)!.rowCount])
  );
  const structureBefore = worksheetStructureSnapshot(workbook);
  const columnStructureBefore = columnStructureSnapshot(layout.sheet);
  const headerValueKeys = Array.from({ length: layout.sheet.columnCount }, (_, index) =>
    comparableKey(layout.sheet.getCell(layout.headerRow, index + 1).value)
  );
  const headerStyleKeys = Array.from({ length: layout.sheet.columnCount }, (_, index) =>
    comparableKey(layout.sheet.getCell(layout.headerRow, index + 1).style)
  );
  const expectedValidationRows = selectedRows.map(row => row.dataValidations.map(validation => ({ ...validation })));

  let shortageRowCount = 0;
  let reasonAppliedCount = 0;
  let matchedSkuCount = 0;
  const expectedOutputRows = selectedRows.map(row => ({
    purchaseOrderNumber: row.purchaseOrderNumber,
    skuId: row.skuId,
    valueKeys: [...row.valueKeys],
    styleKeys: [...row.styleKeys],
  }));

  // 위의 모든 행/집합 검증을 통과한 뒤에만 메모리 워크북의 I/M 값만 변경한다.
  for (let index = 0; index < selectedRows.length; index++) {
    const row = selectedRows[index];
    const confirmedQuantity = quantitiesByPo.get(row.purchaseOrderNumber)!.get(row.skuId)!;
    layout.sheet.getCell(row.originalRowNumber, layout.columns.confirmedQuantity).value = confirmedQuantity;
    expectedOutputRows[index].valueKeys[layout.columns.confirmedQuantity - 1] = comparableKey(confirmedQuantity);
    matchedSkuCount += 1;
    if (confirmedQuantity < row.orderedQuantity) {
      layout.sheet.getCell(row.originalRowNumber, layout.columns.shortageReason).value = SHORTAGE_REASON_TEXT;
      expectedOutputRows[index].valueKeys[layout.columns.shortageReason - 1] = comparableKey(SHORTAGE_REASON_TEXT);
      shortageRowCount += 1;
      reasonAppliedCount += 1;
    }
  }

  const retainedOriginalRows = new Set(selectedRows.map(row => row.originalRowNumber));
  for (let rowNumber = layout.sheet.rowCount; rowNumber > layout.headerRow; rowNumber--) {
    if (!retainedOriginalRows.has(rowNumber)) layout.sheet.spliceRows(rowNumber, 1);
  }

  // ExcelJS spliceRows는 삭제된 행의 dataValidation을 자동 제거하지 않으므로 전부 지우고
  // 선택 행에 실제로 있던 검증만 새 행번호에 다시 넣는다.
  clearWorksheetDataValidations(layout.sheet);
  for (let index = 0; index < expectedValidationRows.length; index++) {
    const outputRow = layout.headerRow + 1 + index;
    for (const entry of expectedValidationRows[index]) {
      layout.sheet.getCell(outputRow, entry.column).dataValidation = cloneSerializable(entry.validation);
    }
  }

  const generatedBuffer = (await workbook.xlsx.writeBuffer()) as ExcelJS.Buffer;
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(generatedBuffer);
  const reopenedLayout = findBatchWorkbookLayout(reopened);
  const reopenedManifest = (
    await inspectPoConfirmWorkbookDetailed(Buffer.from(generatedBuffer), {
      fileName: manifest.fileName,
      source: manifest.source,
      sourceId: manifest.sourceId,
    })
  ).manifest;

  if (!compareStringSets(reopenedManifest.purchaseOrders.map(order => order.purchaseOrderNumber), selectedPoNumbers)) {
    throw new PoConfirmBatchSelfCheckFailedError("선택 발주번호 집합과 결과 파일 발주번호 집합이 다릅니다.");
  }
  if (reopenedManifest.totalRowCount !== selectedRows.length) {
    throw new PoConfirmBatchSelfCheckFailedError(
      `전체 행 수가 다릅니다(예상 ${selectedRows.length}, 결과 ${reopenedManifest.totalRowCount}).`
    );
  }
  for (const poNumber of selectedPoNumbers) {
    const actual = reopenedManifest.purchaseOrders.find(order => order.purchaseOrderNumber === poNumber)?.rowCount ?? 0;
    if (actual !== expectedRowCounts[poNumber]) {
      throw new PoConfirmBatchSelfCheckFailedError(
        `발주서 ${poNumber} 행 수가 다릅니다(예상 ${expectedRowCounts[poNumber]}, 결과 ${actual}).`
      );
    }
  }

  const structureAfter = worksheetStructureSnapshot(reopened);
  if (comparableKey(structureAfter.namesAndStates) !== comparableKey(structureBefore.namesAndStates)) {
    throw new PoConfirmBatchSelfCheckFailedError("시트명 또는 숨김 상태가 원본과 다릅니다.");
  }
  for (const [sheetName, snapshot] of Object.entries(structureBefore.nonTargetSheetKeys)) {
    if (structureAfter.nonTargetSheetKeys[sheetName] !== snapshot) {
      throw new PoConfirmBatchSelfCheckFailedError(`보조 시트 ${sheetName} 내용 또는 서식이 원본과 다릅니다.`);
    }
  }
  if (columnStructureSnapshot(reopenedLayout.sheet) !== columnStructureBefore) {
    throw new PoConfirmBatchSelfCheckFailedError("열 너비·숨김·서식 구조가 원본과 다릅니다.");
  }
  for (let column = 1; column <= reopenedLayout.sheet.columnCount; column++) {
    if (comparableKey(reopenedLayout.sheet.getCell(reopenedLayout.headerRow, column).value) !== headerValueKeys[column - 1]) {
      throw new PoConfirmBatchSelfCheckFailedError(`${column}열 헤더 값이 원본과 다릅니다.`);
    }
    if (comparableKey(reopenedLayout.sheet.getCell(reopenedLayout.headerRow, column).style) !== headerStyleKeys[column - 1]) {
      throw new PoConfirmBatchSelfCheckFailedError(`${column}열 헤더 서식이 원본과 다릅니다.`);
    }
  }

  let expectedValidationCount = 0;
  for (let index = 0; index < expectedOutputRows.length; index++) {
    const actualRowNumber = reopenedLayout.headerRow + 1 + index;
    const expected = expectedOutputRows[index];
    if (
      cellText(reopenedLayout.sheet.getCell(actualRowNumber, reopenedLayout.columns.purchaseOrderNumber)) !== expected.purchaseOrderNumber ||
      cellText(reopenedLayout.sheet.getCell(actualRowNumber, reopenedLayout.columns.skuId)) !== expected.skuId
    ) {
      throw new PoConfirmBatchSelfCheckFailedError(`${actualRowNumber}행 발주번호 또는 상품번호 순서가 원본과 다릅니다.`);
    }
    for (let column = 1; column <= reopenedLayout.sheet.columnCount; column++) {
      const cell = reopenedLayout.sheet.getCell(actualRowNumber, column);
      if (comparableKey(cell.value) !== expected.valueKeys[column - 1]) {
        throw new PoConfirmBatchSelfCheckFailedError(`${actualRowNumber}행 ${column}열 값이 예상과 다릅니다.`);
      }
      if (comparableKey(cell.style) !== expected.styleKeys[column - 1]) {
        throw new PoConfirmBatchSelfCheckFailedError(`${actualRowNumber}행 ${column}열 서식이 원본과 다릅니다.`);
      }
    }
    const expectedValidations = new Map(expectedValidationRows[index].map(entry => [entry.column, entry.comparableKey]));
    expectedValidationCount += expectedValidations.size;
    for (let column = 1; column <= reopenedLayout.sheet.columnCount; column++) {
      const actualValidation = reopenedLayout.sheet.getCell(actualRowNumber, column).dataValidation;
      const actualKey = actualValidation && Object.keys(actualValidation).length > 0 ? comparableKey(actualValidation) : null;
      const expectedKey = expectedValidations.get(column) || null;
      if (actualKey !== expectedKey) {
        throw new PoConfirmBatchSelfCheckFailedError(`${actualRowNumber}행 ${column}열 데이터 유효성 검사가 원본과 다릅니다.`);
      }
    }
  }
  const actualValidationCount = Object.keys(worksheetValidationModel(reopenedLayout.sheet) || {}).length;
  if (actualValidationCount !== expectedValidationCount) {
    throw new PoConfirmBatchSelfCheckFailedError(
      `데이터 유효성 검사 수가 다릅니다(예상 ${expectedValidationCount}, 결과 ${actualValidationCount}).`
    );
  }

  return {
    buffer: generatedBuffer,
    source: manifest,
    selectedPoNumbers,
    totalRowCount: selectedRows.length,
    rowCountsByPo: expectedRowCounts,
    matchedSkuCount,
    shortageRowCount,
    reasonAppliedCount,
  };
}
