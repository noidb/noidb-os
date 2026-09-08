import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

export interface WeeklyReorderRow {
  purchaseOrderNumber: string;
  skuId: string;
  productName: string;
  shortageQuantity: number;
}

const TEMPLATE_PATH = path.join(process.cwd(), "lib", "wms", "templates", "Report_Issue_Reorder.xlsx");
const SHEET_PATH = "xl/worksheets/sheet1.xml";
const REORDER_REASON = "업체실수로 인한 출고누락";
const HEADERS = ["SKU ID", "발주번호", "발주 요청수량", "요청 입고예정일", "요청사유", "첨부 파일", "Comment"];

/** The first Friday strictly after the generation date in Korea. */
export function nextWeeklyReorderFriday(now = new Date()): string {
  if (!Number.isFinite(now.getTime())) throw new Error("재발주 파일 생성일이 올바르지 않습니다.");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find(value => value.type === type)?.value);
  const day = new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
  const daysUntilFriday = (5 - day.getUTCDay() + 7) % 7 || 7;
  day.setUTCDate(day.getUTCDate() + daysUntilFriday);
  return day.toISOString().slice(0, 10);
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function templateRow(xml: string, row: number): string {
  const match = xml.match(new RegExp(`<row\\b[^>]*\\br="${row}"[^>]*>[\\s\\S]*?<\\/row>`));
  if (!match) throw new Error(`재발주 양식의 ${row}행을 찾지 못했습니다.`);
  return match[0];
}

function templateCell(row: string, ref: string): string {
  const match = row.match(new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`));
  if (!match) throw new Error(`재발주 양식의 ${ref} 셀을 찾지 못했습니다.`);
  return match[0];
}

function validatedRows(rows: WeeklyReorderRow[]): WeeklyReorderRow[] {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("재발주할 미입고 항목이 없습니다.");
  if (rows.length > 1_048_574) throw new Error("재발주 항목이 엑셀 한 시트의 최대 행 수를 초과했습니다.");
  const keys = new Set<string>();
  return rows.map(row => {
    const purchaseOrderNumber = typeof row?.purchaseOrderNumber === "string" ? row.purchaseOrderNumber.trim() : "";
    const skuId = typeof row?.skuId === "string" ? row.skuId.trim() : "";
    if (!/^\d{1,20}$/.test(purchaseOrderNumber) || !/^\d{1,20}$/.test(skuId)) {
      throw new Error("재발주 항목의 발주번호 또는 SKU ID가 올바르지 않습니다.");
    }
    if (!Number.isSafeInteger(row.shortageQuantity) || row.shortageQuantity <= 0) {
      throw new Error(`발주 ${purchaseOrderNumber} · SKU ${skuId}의 미입고 수량을 확인해 주세요.`);
    }
    const key = `${purchaseOrderNumber}:${skuId}`;
    if (keys.has(key)) throw new Error(`발주 ${purchaseOrderNumber} · SKU ${skuId}가 재발주 목록에 중복되어 있습니다.`);
    keys.add(key);
    return { ...row, purchaseOrderNumber, skuId };
  });
}

/** Keep Coupang's identifying row, headers, validations, and every other ZIP part intact. */
export async function buildWeeklyReorderWorkbook(rows: WeeklyReorderRow[], now = new Date()): Promise<Buffer> {
  const items = validatedRows(rows);
  const requestedDate = nextWeeklyReorderFriday(now);
  const zip = await JSZip.loadAsync(await readFile(TEMPLATE_PATH));
  const sheet = zip.file(SHEET_PATH);
  if (!sheet) throw new Error("재발주 양식의 입력 시트를 찾지 못했습니다.");
  const original = await sheet.async("string");
  const firstRow = templateRow(original, 1);
  const headerRow = templateRow(original, 2);
  const sampleRow = templateRow(original, 3);
  const styles = HEADERS.map((header, index) => {
    const column = String.fromCharCode(65 + index);
    if (!templateCell(headerRow, `${column}2`).includes(`<t>${xmlEscape(header)}</t>`)) {
      throw new Error("재발주 양식의 열 구성이 변경되었습니다. 양식을 다시 확인해 주세요.");
    }
    const cell = templateCell(sampleRow, `${column}3`);
    if (/<f\b/.test(cell) || /<v>[^<]+<\/v>/.test(cell) || /<t(?:\s[^>]*)?>[^<]+<\/t>/.test(cell)) {
      throw new Error("재발주 양식의 입력행에 기존 값이 있습니다. 빈 양식을 확인해 주세요.");
    }
    return cell.match(/\bs="(\d+)"/)?.[1] || "0";
  });
  const dataRows = items.map((item, index) => {
    const rowNumber = index + 3;
    const values = [item.skuId, item.purchaseOrderNumber, item.shortageQuantity, requestedDate, REORDER_REASON, "", ""];
    const cells = values.map((value, columnIndex) => {
      const ref = `${String.fromCharCode(65 + columnIndex)}${rowNumber}`;
      const attributes = `r="${ref}" s="${styles[columnIndex]}"`;
      return typeof value === "number"
        ? `<c ${attributes} t="n"><v>${value}</v></c>`
        : `<c ${attributes} t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowNumber}">${cells}</row>`;
  }).join("");
  if (!/<sheetData>[\s\S]*?<\/sheetData>/.test(original) || !/<dimension\b[^>]*\bref="[^"]*"[^>]*\/>/.test(original)) {
    throw new Error("재발주 양식의 데이터 영역이 올바르지 않습니다.");
  }
  const updated = original
    .replace(/<sheetData>[\s\S]*?<\/sheetData>/, `<sheetData>${firstRow}${headerRow}${dataRows}</sheetData>`)
    .replace(/<dimension\b[^>]*\bref="[^"]*"[^>]*\/>/, `<dimension ref="A1:G${items.length + 2}"/>`);
  zip.file(SHEET_PATH, updated, { createFolders: false });
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
