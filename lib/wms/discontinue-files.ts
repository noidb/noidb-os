import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import {
  downloadDriveFile,
  isDriveReaderConfigured,
  listDriveFilesFromEnv,
  searchDriveFilesByName,
} from "./google-drive-reader";

export const DISCONTINUE_TEMPLATE_NAME = "[양식]판매중지_SKU_영구생산중단.xlsx";
export const RELEASE_TEMPLATE_NAME = "이메일발송용_노이드비_단종해제 SKU리스트.xlsx";
export const DISCONTINUE_REASON = "리뉴얼 상품 없음 (NRO)";
export const DISCONTINUE_COMMENT = "영구적 생산 중단에 의한 발주 중단";
export const RELEASE_REASON = "공급사 공급 재개로 인한 상품 재공급";

const LOCAL_TEMPLATE_FOLDER = "G:\\내 드라이브\\쿠팡데이터\\단종 및 해제";
const BUNDLED_TEMPLATE_FOLDER = path.join(process.cwd(), "lib", "wms", "data", "discontinue-templates");
const DRIVE_FOLDER_ENV = "GOOGLE_DRIVE_DISCONTINUE_FOLDER_ID";

export interface DiscontinueFileItem {
  skuId: string;
  productName?: string;
}

export interface WorkbookBuildResult {
  buffer: Buffer;
  itemCount: number;
  preservedWorksheetXml: boolean;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function inlineCell(ref: string, value: string, style: number): string {
  const preserve = /^\s|\s$/.test(value) ? ' xml:space="preserve"' : "";
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t${preserve}>${xmlEscape(value)}</t></is></c>`;
}

function normalizedItems(items: DiscontinueFileItem[]): DiscontinueFileItem[] {
  const unique = new Map<string, DiscontinueFileItem>();
  for (const item of items) {
    const skuId = String(item.skuId || "").trim();
    if (!skuId || unique.has(skuId)) continue;
    unique.set(skuId, { skuId, productName: String(item.productName || "").trim() });
  }
  if (!unique.size) throw new Error("선택된 SKU가 없습니다.");
  return Array.from(unique.values());
}

function replaceSheetData(xml: string, rows: string, lastCell: string): string {
  if (!/<sheetData>[\s\S]*?<\/sheetData>/.test(xml)) throw new Error("엑셀 양식의 데이터 영역을 찾지 못했습니다.");
  const withRows = xml.replace(/<sheetData>[\s\S]*?<\/sheetData>/, `<sheetData>${rows}</sheetData>`);
  if (/<dimension ref="[^"]*"\/>/.test(withRows)) {
    return withRows.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:${lastCell}"/>`);
  }
  return withRows;
}

function rowXml(xml: string, rowNumber: number): string {
  const match = xml.match(new RegExp(`<row\\s+[^>]*r="${rowNumber}"[^>]*>[\\s\\S]*?<\\/row>`));
  if (!match) throw new Error(`엑셀 양식 ${rowNumber}행을 찾지 못했습니다.`);
  return match[0];
}

async function templateBuffer(fileName: string): Promise<Buffer> {
  if (isDriveReaderConfigured()) {
    let matches = [];
    try {
      matches = (await listDriveFilesFromEnv(DRIVE_FOLDER_ENV)).filter(file => file.name === fileName);
    } catch {
      matches = (await searchDriveFilesByName(fileName)).filter(file => file.name === fileName);
    }
    if (matches.length === 1) return downloadDriveFile(matches[0].id);
    if (matches.length > 1) throw new Error("단종 및 해제 폴더에 같은 이름의 양식이 여러 개 있습니다. 폴더 연결을 확인해 주세요.");
  }
  if (!process.env.VERCEL && process.env.NODE_ENV !== "production") {
    try {
      return await readFile(path.join(LOCAL_TEMPLATE_FOLDER, fileName));
    } catch {
      // 개발 PC에 G: 동기화 폴더가 없으면 검증된 앱 내 읽기 전용 복사본을 사용한다.
    }
  }
  try {
    return await readFile(path.join(BUNDLED_TEMPLATE_FOLDER, fileName));
  } catch {
    throw new Error(`단종 및 해제 폴더에서 '${fileName}' 양식을 찾지 못했습니다.`);
  }
}

export async function loadDiscontinueTemplate(): Promise<Buffer> {
  return templateBuffer(DISCONTINUE_TEMPLATE_NAME);
}

export async function loadReleaseTemplate(): Promise<Buffer> {
  return templateBuffer(RELEASE_TEMPLATE_NAME);
}

export async function buildDiscontinueWorkbook(
  source: Buffer,
  itemsInput: DiscontinueFileItem[],
  date: string,
): Promise<WorkbookBuildResult> {
  const items = normalizedItems(itemsInput);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("단종 요청 날짜 형식이 올바르지 않습니다.");
  const zip = await JSZip.loadAsync(source);
  const firstSheet = zip.file("xl/worksheets/sheet1.xml");
  const preservedSheet = zip.file("xl/worksheets/sheet2.xml");
  if (!firstSheet || !preservedSheet) throw new Error("단종 신청 양식의 필수 시트를 찾지 못했습니다.");
  const originalFirstXml = await firstSheet.async("string");
  const originalPreservedXml = await preservedSheet.async("string");
  const fixedRows = `${rowXml(originalFirstXml, 1)}${rowXml(originalFirstXml, 2)}`;
  const dataRows = items.map((item, index) => {
    const row = index + 3;
    return `<row r="${row}">${inlineCell(`A${row}`, item.skuId, 66)}${inlineCell(`B${row}`, DISCONTINUE_REASON, 66)}${inlineCell(`C${row}`, date, 66)}${inlineCell(`D${row}`, DISCONTINUE_COMMENT, 66)}</row>`;
  }).join("");
  zip.file("xl/worksheets/sheet1.xml", replaceSheetData(originalFirstXml, fixedRows + dataRows, `D${items.length + 2}`));
  const generated = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const verificationZip = await JSZip.loadAsync(generated);
  const generatedPreservedXml = await verificationZip.file("xl/worksheets/sheet2.xml")?.async("string");
  if (generatedPreservedXml !== originalPreservedXml) throw new Error("단종 신청 양식의 두 번째 탭 보존 검증에 실패했습니다.");
  return { buffer: generated, itemCount: items.length, preservedWorksheetXml: true };
}

export async function buildReleaseWorkbook(
  source: Buffer,
  itemsInput: DiscontinueFileItem[],
): Promise<WorkbookBuildResult> {
  const items = normalizedItems(itemsInput);
  const zip = await JSZip.loadAsync(source);
  const sheet = zip.file("xl/worksheets/sheet1.xml");
  if (!sheet) throw new Error("단종해제 양식의 입력 시트를 찾지 못했습니다.");
  const originalXml = await sheet.async("string");
  const header = rowXml(originalXml, 1);
  const dataRows = items.map((item, index) => {
    const row = index + 2;
    return `<row r="${row}" spans="1:3" x14ac:dyDescent="0.25">${inlineCell(`A${row}`, item.skuId, 2)}${inlineCell(`B${row}`, RELEASE_REASON, 3)}${inlineCell(`C${row}`, item.productName || "", 2)}</row>`;
  }).join("");
  const generatedXml = replaceSheetData(originalXml, header + dataRows, `C${items.length + 1}`);
  zip.file("xl/worksheets/sheet1.xml", generatedXml);
  const generated = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { buffer: generated, itemCount: items.length, preservedWorksheetXml: true };
}

export function koreaDateParts(now = new Date()): { iso: string; compact: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || "";
  const iso = `${get("year")}-${get("month")}-${get("day")}`;
  return { iso, compact: iso.replace(/-/g, "") };
}
