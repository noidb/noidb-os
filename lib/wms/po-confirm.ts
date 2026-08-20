import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";

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

export type PoConfirmTemplateSource = "primary" | "project" | "legacy-drive";

interface FoundFile {
  filePath: string;
  fileName: string;
  source: PoConfirmTemplateSource;
}

function extractPoNumberFromFileName(fileName: string): string | null {
  const match = fileName.match(PO_NUMBER_IN_FILENAME);
  return match ? match[1] : null;
}

async function listXlsxFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries.filter(name => !name.startsWith("~$") && !name.startsWith(".") && name.toLowerCase().endsWith(".xlsx"));
  } catch {
    return [];
  }
}

/** 지정한 발주번호와 파일명 괄호 안 숫자가 정확히 전체 일치하는 파일만 모은다(부분일치 금지).
 *  기본 폴더 → 프로젝트 폴더 → 레거시 드라이브 폴더 순서로 전부 검색해 합친다. */
async function findAllMatchesForPo(poNumber: string): Promise<FoundFile[]> {
  const trimmed = poNumber.trim();
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
        matches.push({ filePath: path.join(dir, fileName), fileName, source });
      }
    }
  }
  return matches;
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
  const primaryDir = getPrimaryPoConfirmDir();
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
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(match.filePath);
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
  try {
    const info = await stat(getPrimaryPoConfirmDir());
    return info.isDirectory();
  } catch {
    return false;
  }
}

/** 업로드된(또는 이미 찾은) 워크북의 실제 내용에서 발주번호를 읽는다 — 파일명이 아니라 A열 값 기준. */
export function extractPoNumberFromWorkbook(workbook: ExcelJS.Workbook): string | null {
  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) return null;
  const text = String(sheet.getCell(HEADER_ROW + 1, PO_NUMBER_COLUMN).value ?? "").trim();
  return text || null;
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

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(match.filePath);
  } catch (error) {
    throw new PoConfirmFileReadError(poNumber, error instanceof Error ? error.message : "알 수 없는 오류");
  }

  const innerPoNumber = extractPoNumberFromWorkbook(workbook);
  if (innerPoNumber !== poNumber.trim()) {
    throw new PoConfirmMismatchError(poNumber, innerPoNumber);
  }

  const { matchedSkuIds, unmatchedSkuIds, shortageRowCount, reasonAppliedCount } = applyConfirmedQuantities(workbook, poNumber, confirmedQuantities);
  const buffer = await workbook.xlsx.writeBuffer();

  return { buffer, matchedSkuCount: matchedSkuIds.size, unmatchedSkuIds, sourceFileName: match.fileName, shortageRowCount, reasonAppliedCount };
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
