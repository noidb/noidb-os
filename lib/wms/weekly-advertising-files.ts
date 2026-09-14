import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

const TEMPLATE_PATH = path.join(process.cwd(), "lib", "wms", "templates", "Coupang_Advertising_Products.xlsx");
const SHEET_PATH = "xl/worksheets/sheet1.xml";
const MAX_OPTIONS_PER_FILE = 500;

interface WeeklyAdvertisingFile {
  fileName: string;
  buffer: Buffer;
  optionIds: string[];
}

function uniqueOptionIds(optionIds: string[]): string[] {
  if (!Array.isArray(optionIds)) throw new Error("광고등록 옵션ID 목록을 확인해 주세요.");
  const seen = new Set<string>();
  for (const raw of optionIds) {
    const value = typeof raw === "string" ? raw.trim() : "";
    // Identifiers must never pass through Number, including values beyond 2^53.
    if (!/^\d+$/.test(value) || !/[1-9]/.test(value)) throw new Error("광고등록 옵션ID는 0보다 큰 숫자로 된 문자열이어야 합니다.");
    seen.add(value);
  }
  return [...seen];
}

function templateRows(xml: string): Map<number, string> {
  const sheetData = xml.match(/<sheetData>[\s\S]*?<\/sheetData>/)?.[0];
  if (!sheetData) throw new Error("광고등록 양식의 입력 영역을 찾지 못했습니다.");
  const rows = new Map<number, string>();
  for (const match of sheetData.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g)) {
    const number = Number(match[1]);
    if (rows.has(number)) throw new Error("광고등록 양식에 중복 행이 있습니다.");
    rows.set(number, match[0]);
    if (number >= 2) {
      const input = match[0].match(new RegExp(`<c\\b[^>]*\\br="A${number}"[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`))?.[0];
      if (input && (/<f\b/.test(input) || /<v>[^<]+<\/v>/.test(input) || /<t(?:\s[^>]*)?>[^<]+<\/t>/.test(input))) {
        throw new Error("광고등록 양식에 기존 옵션ID가 있습니다. 빈 양식을 확인해 주세요.");
      }
    }
  }
  if (!rows.has(1) || !rows.has(2) || !rows.has(6) || !/<mergeCell\b[^>]*\bref="D2:F6"/.test(xml)) {
    throw new Error("광고등록 양식의 머리글 또는 도움말 구성이 변경되었습니다.");
  }
  return rows;
}

/** Preserve the supplied Sheet1 template and split the final selection into 500-ID files. */
export async function buildWeeklyAdvertisingFiles(optionIds: string[]): Promise<WeeklyAdvertisingFile[]> {
  const ids = uniqueOptionIds(optionIds);
  if (!ids.length) return [];
  const source = await readFile(TEMPLATE_PATH);
  const originalZip = await JSZip.loadAsync(source);
  const xml = await originalZip.file(SHEET_PATH)?.async("string");
  if (!xml) throw new Error("광고등록 양식의 Sheet1을 찾지 못했습니다.");
  const rows = templateRows(xml);
  if (!/<dimension\b[^>]*\bref="[^"]*"[^>]*\/>/.test(xml)) throw new Error("광고등록 양식의 범위를 확인하지 못했습니다.");
  const column = xml.match(/<col\b(?=[^>]*\bmin="1")(?=[^>]*\bmax="1")[^>]*\/>/)?.[0];
  const style = column?.match(/\bstyle="(\d+)"/)?.[1] || "0";
  const sourceLastRow = Math.max(...rows.keys());
  const files: WeeklyAdvertisingFile[] = [];
  for (let offset = 0; offset < ids.length; offset += MAX_OPTIONS_PER_FILE) {
    const selected = ids.slice(offset, offset + MAX_OPTIONS_PER_FILE);
    const lastRow = Math.max(sourceLastRow, selected.length + 1);
    const outputRows: string[] = [];
    for (let row = 1; row <= lastRow; row += 1) {
      let originalRow = rows.get(row) || `<row r="${row}"></row>`;
      if (row >= 2) {
        originalRow = originalRow.replace(new RegExp(`<c\\b[^>]*\\br="A${row}"[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`, "g"), "");
        const value = selected[row - 2];
        if (value !== undefined) {
          const cell = `<c r="A${row}" s="${style}" t="inlineStr"><is><t>${value}</t></is></c>`;
          originalRow = originalRow.replace(/(<row\b[^>]*>)/, `$1${cell}`);
        }
      }
      outputRows.push(originalRow);
    }
    const updated = xml
      .replace(/<sheetData>[\s\S]*?<\/sheetData>/, `<sheetData>${outputRows.join("")}</sheetData>`)
      .replace(/<dimension\b[^>]*\bref="[^"]*"[^>]*\/>/, `<dimension ref="A1:F${lastRow}"/>`);
    const zip = await JSZip.loadAsync(source);
    zip.file(SHEET_PATH, updated, { createFolders: false });
    files.push({ fileName: `3-${files.length + 1}_광고등록.xlsx`, buffer: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }), optionIds: selected });
  }
  return files;
}
