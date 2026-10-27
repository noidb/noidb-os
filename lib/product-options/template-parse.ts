import ExcelJS from "exceljs";
import { isAlwaysBlankHeader, isSiteFilledHeader } from "./defaults";
import type { TemplateField, TemplateInfo } from "./types";

/**
 * 쿠팡 로켓배송 견적서 양식(QF_ 시트)을 읽는다.
 * 4행 묶음 이름, 5행 칸 이름, 6행 필수/선택, 7행 설명, 8행 예시, 칸의 드롭다운(숨김 시트 목록)을 꺼낸다.
 */

const text = (value: unknown): string => {
  if (value == null) return "";
  if (typeof value === "object") {
    const rich = value as { richText?: { text: string }[]; text?: string; result?: unknown };
    if (Array.isArray(rich.richText)) return rich.richText.map(part => part.text).join("");
    if (rich.text != null) return String(rich.text);
    if (rich.result != null) return String(rich.result);
  }
  return String(value);
};

export function findQfSheet(workbook: ExcelJS.Workbook) {
  return workbook.worksheets.find(ws => ws.name.startsWith("QF_")) || null;
}

function readRange(workbook: ExcelJS.Workbook, reference: string): string[] {
  const match = reference.match(/^'?(.+?)'?!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/);
  if (!match) return [];
  const [, sheetName, startCol, startRow, endColRaw, endRowRaw] = match;
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) return [];
  const startColumn = sheet.getColumn(startCol).number;
  const endColumn = sheet.getColumn(endColRaw || startCol).number;
  const firstRow = Number(startRow);
  const lastRow = Math.min(Number(endRowRaw || startRow), firstRow + 2000);
  const values: string[] = [];
  for (let row = firstRow; row <= lastRow; row++) {
    for (let col = startColumn; col <= endColumn; col++) {
      const value = text(sheet.getRow(row).getCell(col).value).trim();
      if (value) values.push(value);
    }
  }
  return values;
}

function listChoices(workbook: ExcelJS.Workbook, formula: string): string[] {
  const value = String(formula || "").trim().replace(/^=/, "");
  if (!value) return [];
  if (value.startsWith("\"")) {
    return value.replace(/^"|"$/g, "").split(",").map(item => item.trim()).filter(Boolean);
  }
  const named = (workbook.definedNames as unknown as { model: { name: string; ranges: string[] }[] }).model
    .find(item => item.name === value);
  const ranges = named ? named.ranges : [value];
  return [...new Set(ranges.flatMap(range => readRange(workbook, range)))];
}

export async function parseCoupangTemplate(buffer: ArrayBuffer | Buffer, fileName: string): Promise<TemplateInfo> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as ArrayBuffer);
  const sheet = findQfSheet(workbook);
  if (!sheet) throw new Error("쿠팡 견적서 양식이 아닙니다. 'QF_'로 시작하는 시트가 있는 Wing 로켓배송 상품등록 양식 파일을 올려주세요.");

  const validations = ((sheet as unknown as { dataValidations: unknown }).dataValidations as { model: Record<string, { type?: string; formulae?: string[] }> }).model || {};
  const choicesByColumn = new Map<string, string[]>();
  for (const [address, rule] of Object.entries(validations)) {
    const column = address.match(/^([A-Z]+)/)?.[1];
    if (!column || choicesByColumn.has(column) || rule?.type !== "list" || !rule.formulae?.[0]) continue;
    choicesByColumn.set(column, listChoices(workbook, rule.formulae[0]));
  }

  const fields: TemplateField[] = [];
  let group = "";
  const headerRow = sheet.getRow(5);
  for (let col = 2; col <= sheet.columnCount; col++) {
    const groupText = text(sheet.getRow(4).getCell(col).value).trim();
    if (groupText) group = groupText.split(/[:：]/)[0].trim();
    const header = text(headerRow.getCell(col).value).replace(/\s+/g, " ").trim();
    if (!header || isAlwaysBlankHeader(header)) continue;
    const column = sheet.getColumn(col).letter;
    fields.push({
      header,
      column,
      group,
      required: text(sheet.getRow(6).getCell(col).value).includes("필수"),
      description: text(sheet.getRow(7).getCell(col).value).trim().slice(0, 300),
      example: text(sheet.getRow(8).getCell(col).value).trim().slice(0, 200),
      choices: (choicesByColumn.get(column) || []).slice(0, 300),
      siteFilled: isSiteFilledHeader(header),
    });
  }
  if (!fields.length) throw new Error("양식에서 칸 이름(5행)을 찾지 못했습니다.");
  const categoryColumn = fields.find(field => field.header === "카테고리");
  return {
    fileName,
    sheetName: sheet.name,
    categoryPaths: categoryColumn?.choices || [],
    fields: fields.filter(field => field.header !== "카테고리"),
  };
}
