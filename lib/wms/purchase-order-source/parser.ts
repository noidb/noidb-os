import ExcelJS from "exceljs";
import type { PurchaseOrderBinaryInput, PurchaseOrderSourceDocument, PurchaseOrderSourceRecord } from "./types";

function text(value: unknown): string {
  if (value && typeof value === "object") {
    const item = value as { richText?: { text?: string }[]; text?: string; result?: unknown; master?: unknown };
    if (Array.isArray(item.richText)) return item.richText.map(part => part.text || "").join("").trim();
    if (typeof item.text === "string") return item.text.trim();
    if (item.result !== undefined) return String(item.result ?? "").trim();
    if (item.master) return "";
  }
  return String(value ?? "").trim();
}

function quantity(value: unknown): number {
  const parsed = Number(text(value).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function findCells(sheet: ExcelJS.Worksheet, label: string): { row: number; column: number }[] {
  const found: { row: number; column: number }[] = [];
  for (let row = 1; row <= Math.min(40, sheet.rowCount); row += 1) {
    for (let column = 1; column <= sheet.columnCount; column += 1) {
      if (text(sheet.getCell(row, column).value) === label) found.push({ row, column });
    }
  }
  return found;
}

function valueBelow(sheet: ExcelJS.Worksheet, label: string, pattern?: RegExp): { value: string; row: number } | null {
  for (const cell of findCells(sheet, label)) {
    const value = text(sheet.getCell(cell.row + 1, cell.column).value);
    if (value && (!pattern || pattern.test(value))) return { value, row: cell.row + 1 };
  }
  return null;
}

function valueRight(sheet: ExcelJS.Worksheet, label: string): { value: string; row: number } | null {
  for (const cell of findCells(sheet, label)) {
    for (let column = cell.column + 1; column <= sheet.columnCount; column += 1) {
      const value = text(sheet.getCell(cell.row, column).value);
      if (value && value !== label) return { value, row: cell.row };
    }
  }
  return null;
}

function normalizeDate(value: string): string {
  const match = value.match(/^(\d{4})[\/-](\d{2})[\/-](\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : value;
}

function splitNameAndOption(value: string): { productName: string; optionName: string } {
  const comma = value.indexOf(",");
  return comma < 0
    ? { productName: value.trim(), optionName: "" }
    : { productName: value.slice(0, comma).trim(), optionName: value.slice(comma + 1).trim() };
}

function findItemHeader(sheet: ExcelJS.Worksheet): { row: number; line: number; sku: number; product: number; quantity: number } {
  let found: { row: number; line: number; sku: number; product: number; quantity: number } | null = null;
  for (let row = 1; row <= Math.min(35, sheet.rowCount); row += 1) {
    const columns: Record<string, number> = {};
    for (let column = 1; column <= sheet.columnCount; column += 1) {
      const value = text(sheet.getCell(row, column).value);
      if (value === "No.") columns.line = column;
      if (value === "상품코드") columns.sku = column;
      if (value === "상품명/옵션/BARCODE") columns.product = column;
      if (value === "발주수량") columns.quantity = column;
    }
    if (columns.line && columns.sku && columns.product && columns.quantity) found = { row, line: columns.line, sku: columns.sku, product: columns.product, quantity: columns.quantity };
  }
  if (found) return found;
  throw new Error("상품정보 필수 헤더(No./상품코드/상품명·옵션·BARCODE/발주수량)를 찾지 못했습니다.");
}

export async function parsePurchaseOrderSource(input: PurchaseOrderBinaryInput): Promise<PurchaseOrderSourceDocument> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(input.buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("첫 번째 워크시트를 찾지 못했습니다.");

  const po = valueRight(sheet, "발주번호");
  const center = valueBelow(sheet, "물류센터");
  const address = valueBelow(sheet, "주소");
  const expectedDate = valueBelow(sheet, "입고예정일시", /^\d{4}[\/-]\d{2}[\/-]\d{2}/);
  const phone = valueBelow(sheet, "택배수령담당자");
  if (!po?.value) throw new Error("발주번호 헤더 또는 값을 찾지 못했습니다.");
  if (!center?.value) throw new Error(`발주서 ${po.value}: 물류센터 값을 찾지 못했습니다.`);
  if (!expectedDate?.value) throw new Error(`발주서 ${po.value}: 입고예정일시 값을 찾지 못했습니다.`);

  const header = findItemHeader(sheet);
  const records: PurchaseOrderSourceRecord[] = [];
  for (let row = header.row + 1; row <= sheet.rowCount; row += 2) {
    const lineNumber = text(sheet.getCell(row, header.line).value);
    if (!/^\d+$/.test(lineNumber)) break;
    const skuId = text(sheet.getCell(row, header.sku).value);
    const combinedName = text(sheet.getCell(row, header.product).value);
    const barcode = text(sheet.getCell(row + 1, header.product).value);
    const orderedQuantity = quantity(sheet.getCell(row, header.quantity).value);
    const display = splitNameAndOption(combinedName);
    records.push({
      purchaseOrderNumber: po.value,
      sourceContainerFile: input.sourceContainerFile,
      sourceEntryFile: input.sourceEntryFile,
      sourceSheet: sheet.name,
      sourceRow: row,
      fulfillmentCenterName: center.value,
      expectedArrivalDate: normalizeDate(expectedDate.value),
      recipientName: "",
      phone: phone?.value || "",
      postalCode: "",
      address: address?.value || "",
      skuId,
      barcode,
      productName: display.productName,
      optionName: display.optionName,
      orderedQuantity,
    });
  }
  if (records.length === 0) throw new Error(`발주서 ${po.value}: 상품행을 찾지 못했습니다.`);

  return {
    purchaseOrderNumber: po.value,
    sourceContainerFile: input.sourceContainerFile,
    sourceEntryFile: input.sourceEntryFile,
    sourceSheet: sheet.name,
    sourceRow: po.row,
    fulfillmentCenterName: center.value,
    expectedArrivalDate: normalizeDate(expectedDate.value),
    recipientName: "",
    phone: phone?.value || "",
    postalCode: "",
    address: address?.value || "",
    records,
  };
}
