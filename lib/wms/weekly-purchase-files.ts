import ExcelJS from "exceljs";
import JSZip from "jszip";

/** Read-only source metadata. The timestamp belongs to the uploaded outer file. */
export interface WeeklyPurchaseFileSource { name: string; modifiedTime: string; id?: string }
export interface WeeklyPurchaseRow {
  purchaseOrderNumber: string; skuId: string;
  orderedQuantity: number; confirmedQuantity: number | null; receivedQuantity: number | null;
  productName: string; optionName: string;
  sourceContainerFile: string; sourceEntryFile: string; sourceSheet: string; sourceRow: number;
  sourceModifiedTime: string; sourceId?: string;
}
export interface WeeklyPurchaseDocument {
  purchaseOrderNumber: string; rows: WeeklyPurchaseRow[]; source: WeeklyPurchaseFileSource;
  sourceEntryFile: string; sourceSheet: string;
}
export interface WeeklyPurchaseFileError {
  code: string; message: string; purchaseOrderNumber?: string; skuId?: string;
  sourceFile: string; sourceEntryFile?: string; sourceModifiedTime: string; sourceId?: string; sourceRow?: number;
}
export interface WeeklyPurchaseParseResult { documents: WeeklyPurchaseDocument[]; errors: WeeklyPurchaseFileError[] }
export interface WeeklyPurchaseResolution {
  resolvedRows: WeeklyPurchaseRow[]; errors: WeeklyPurchaseFileError[]; sourceFiles: WeeklyPurchaseFileSource[];
}

function text(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (typeof value === "object" && "richText" in value) return value.richText.map(part => part.text).join("").trim();
  if (typeof value === "object" && "text" in value) return String(value.text).trim();
  return "";
}
function hasFormula(cell: ExcelJS.Cell): boolean {
  const value = cell.value;
  return !!value && typeof value === "object" && ("formula" in value || "sharedFormula" in value);
}
function identifier(cell: ExcelJS.Cell): string {
  const value = text(cell.value);
  if (hasFormula(cell) || !/^[1-9]\d*$/.test(value)) throw new Error(`${cell.address}: 양의 정수 식별자를 확인할 수 없습니다.`);
  if (typeof cell.value === "number" && !Number.isSafeInteger(cell.value)) throw new Error(`${cell.address}: 식별자 숫자가 정확하게 보존되지 않았습니다.`);
  return value;
}
function quantity(cell: ExcelJS.Cell, allowBlank: boolean): number | null {
  if (hasFormula(cell)) throw new Error(`${cell.address}: 수식 수량은 원문 확정값을 확인할 수 없습니다.`);
  const value = text(cell.value);
  if (!value && allowBlank) return null;
  if (!/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(value)) throw new Error(`${cell.address}: 0 이상의 정수 수량을 확인할 수 없습니다.`);
  const result = Number(value.replace(/,/g, ""));
  if (!Number.isSafeInteger(result)) throw new Error(`${cell.address}: 수량이 안전한 정수 범위를 벗어났습니다.`);
  return result;
}
function filePoNumber(name: string): string | undefined {
  const base = name.replace(/\\/g, "/").split("/").pop() || "";
  return base.match(/^(?:PO[_ -]?|발주서[_ -]?)([1-9]\d*)\.xlsx$/i)?.[1] || base.match(/^([1-9]\d*)\.xlsx$/i)?.[1];
}
function failure(source: WeeklyPurchaseFileSource, entry: string | undefined, code: string, message: string, po?: string, row?: number, skuId?: string): WeeklyPurchaseFileError {
  return { code, message, purchaseOrderNumber: po, skuId, sourceFile: source.name, sourceEntryFile: entry,
    sourceModifiedTime: source.modifiedTime, sourceId: source.id, sourceRow: row };
}

async function parseWorkbook(buffer: Buffer, source: WeeklyPurchaseFileSource, entry: string): Promise<WeeklyPurchaseParseResult> {
  const result: WeeklyPurchaseParseResult = { documents: [], errors: [] };
  const filePo = filePoNumber(entry);
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer); }
  catch { return { documents: [], errors: [failure(source, entry, "WORKBOOK_UNREADABLE", "발주서 엑셀을 읽을 수 없습니다.", filePo)] }; }
  if (workbook.worksheets.length !== 1) return { documents: [], errors: [failure(source, entry, "SHEET_AMBIGUOUS", "단일 발주서 시트를 확인할 수 없습니다.", filePo)] };
  const sheet = workbook.worksheets[0];
  const poCandidates = new Set<string>();
  for (let row = 1; row <= Math.min(19, sheet.rowCount); row++) {
    for (let column = 1; column <= Math.min(sheet.columnCount, 40); column++) {
      const cell = sheet.getCell(row, column);
      if (cell.isMerged && cell.master.address !== cell.address) continue;
      const value = text(cell.value);
      const match = value.match(/발주서\s*No\.?\s*([1-9]\d*)/i) || value.match(/^발주번호\s*[:：]?\s*([1-9]\d*)$/);
      if (match && !hasFormula(cell)) poCandidates.add(match[1]);
      if (value === "발주번호") {
        for (let next = column + 1; next <= Math.min(sheet.columnCount, 40); next++) {
          const right = sheet.getCell(row, next);
          if (right.isMerged && right.master.address !== right.address) continue;
          if (!text(right.value) && !hasFormula(right)) continue;
          try { poCandidates.add(identifier(right)); } catch { poCandidates.add("INVALID"); }
          break;
        }
      }
    }
  }
  if (poCandidates.size !== 1 || poCandidates.has("INVALID") || (filePo && !poCandidates.has(filePo))) {
    const affected = [...new Set([filePo, ...poCandidates].filter((po): po is string => !!po && po !== "INVALID"))];
    for (const po of affected.length ? affected : [undefined]) result.errors.push(failure(source, entry, "PO_IDENTITY", "발주서 본문과 파일명의 발주번호가 없거나 일치하지 않습니다.", po));
    return result;
  }
  const po = [...poCandidates][0];
  let header: { row: number; line: number; sku: number; name: number; ordered: number; confirmed: number; received: number } | undefined;
  for (let row = 1; row <= Math.min(40, sheet.rowCount); row++) {
    const fields: Record<string, number> = {};
    for (let column = 1; column <= Math.min(sheet.columnCount, 40); column++) {
      const value = text(sheet.getCell(row, column).value);
      if (value === "No.") fields.line = column;
      if (value === "상품코드") fields.sku = column;
      if (value.startsWith("상품명/옵션")) fields.name = column;
      if (value === "발주수량") fields.ordered = column;
      if (value === "업체납품가능수량") fields.confirmed = column;
      if (value === "입고수량") fields.received = column;
    }
    if (fields.line && fields.sku && fields.name && fields.ordered && fields.confirmed && fields.received) {
      if (header && row > header.row + 1) {
        result.errors.push(failure(source, entry, "HEADER_AMBIGUOUS", "상품정보 표가 여러 개여서 완전한 발주서를 확인할 수 없습니다.", po));
        return result;
      }
      header = { row, line: fields.line, sku: fields.sku, name: fields.name, ordered: fields.ordered, confirmed: fields.confirmed, received: fields.received };
    }
  }
  if (!header) return { documents: [], errors: [failure(source, entry, "HEADER_MISSING", "상품코드·발주수량·업체납품가능수량·입고수량 헤더를 찾지 못했습니다.", po)] };
  const rows: WeeklyPurchaseRow[] = [];
  const seenSku = new Set<string>();
  let totalRow = 0;
  let expectedLine = 1;
  for (let row = header.row + 1; row <= sheet.rowCount; row++) {
    const lineCell = sheet.getCell(row, header.line);
    const skuCell = sheet.getCell(row, header.sku);
    if (text(lineCell.value) === "합계") { totalRow = row; break; }
    // Coupang prints each product and its barcode on two rows with shared core cells.
    if (skuCell.isMerged && Number(skuCell.master.row) < row) {
      const preceding = rows[rows.length - 1];
      const coreColumns = [header.line, header.sku, header.ordered, header.confirmed, header.received];
      if (!preceding || !coreColumns.every(column => sheet.getCell(row, column).isMerged && Number(sheet.getCell(row, column).master.row) === preceding.sourceRow)) {
        result.errors.push(failure(source, entry, "ITEM_ROW_AMBIGUOUS", "상품과 바코드 행의 병합 범위가 일치하지 않습니다.", po, row));
      }
      continue;
    }
    let skuId: string | undefined;
    try {
      const line = identifier(lineCell);
      if (line !== String(expectedLine)) throw new Error(`${lineCell.address}: 상품 순번이 연속되지 않습니다.`);
      expectedLine++;
      skuId = identifier(skuCell);
      if (seenSku.has(skuId)) throw new Error(`${skuCell.address}: SKU ${skuId}가 중복되어 있습니다.`);
      seenSku.add(skuId);
      const orderedQuantity = quantity(sheet.getCell(row, header.ordered), false)!;
      const confirmedQuantity = quantity(sheet.getCell(row, header.confirmed), true);
      const receivedQuantity = quantity(sheet.getCell(row, header.received), true);
      if (confirmedQuantity === null) throw new Error(`${sheet.getCell(row, header.confirmed).address}: 업체납품가능수량이 비어 있어 확정수량을 확인할 수 없습니다.`);
      const combinedName = text(sheet.getCell(row, header.name).value);
      const comma = combinedName.indexOf(",");
      rows.push({ purchaseOrderNumber: po, skuId, orderedQuantity, confirmedQuantity, receivedQuantity,
        productName: (comma < 0 ? combinedName : combinedName.slice(0, comma)).trim(),
        optionName: comma < 0 ? "" : combinedName.slice(comma + 1).trim(),
        sourceContainerFile: source.name, sourceEntryFile: entry, sourceSheet: sheet.name, sourceRow: row,
        sourceModifiedTime: source.modifiedTime, sourceId: source.id });
    } catch (error) { result.errors.push(failure(source, entry, "ITEM_INVALID", error instanceof Error ? error.message : "상품행을 확인할 수 없습니다.", po, row, skuId)); }
  }
  if (!rows.length) result.errors.push(failure(source, entry, "ITEMS_MISSING", "유효한 상품행을 찾지 못했습니다.", po));
  if (!totalRow) result.errors.push(failure(source, entry, "TOTAL_MISSING", "합계행이 없어 발주서 전체 품목을 확인할 수 없습니다.", po));
  if (totalRow && !result.errors.length) {
    for (const [column, key] of [[header.ordered, "orderedQuantity"], [header.confirmed, "confirmedQuantity"], [header.received, "receivedQuantity"]] as const) {
      try {
        const total = quantity(sheet.getCell(totalRow, column), key === "receivedQuantity");
        const values = rows.map(item => item[key]);
        if (total !== null && (values.some(value => value === null) || values.reduce<number>((sum, value) => sum + (value ?? 0), 0) !== total)) throw new Error(`${sheet.getCell(totalRow, column).address}: 합계와 상품별 수량이 일치하지 않습니다.`);
      } catch (error) { result.errors.push(failure(source, entry, "TOTAL_INVALID", error instanceof Error ? error.message : "합계수량을 확인할 수 없습니다.", po, totalRow)); }
    }
  }
  if (!result.errors.length) result.documents.push({ purchaseOrderNumber: po, rows, source, sourceEntryFile: entry, sourceSheet: sheet.name });
  return result;
}

/** Parse PO workbooks without writing to Sheets, Drive, or the operating workspace. */
export async function parseWeeklyPurchaseFile(buffer: Buffer, source: WeeklyPurchaseFileSource): Promise<WeeklyPurchaseParseResult> {
  if (!Number.isFinite(Date.parse(source.modifiedTime))) return { documents: [], errors: [failure(source, undefined, "SOURCE_TIME_INVALID", "파일 수정시각을 확인할 수 없습니다.", filePoNumber(source.name))] };
  if (/\.xlsx$/i.test(source.name)) return parseWorkbook(buffer, source, source.name);
  if (!/\.zip$/i.test(source.name)) return { documents: [], errors: [failure(source, undefined, "FILE_UNSUPPORTED", "ZIP 또는 XLSX 발주서가 아닙니다.", filePoNumber(source.name))] };
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(buffer); }
  catch { return { documents: [], errors: [failure(source, undefined, "ARCHIVE_UNREADABLE", "발주서 ZIP을 읽을 수 없습니다.")] }; }
  const entries = Object.values(zip.files).filter(entry => !entry.dir && !/(^|\/)__MACOSX\//.test(entry.name) && !/(^|\/)~\$/.test(entry.name) && /\.xlsx$/i.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name));
  if (!entries.length) return { documents: [], errors: [failure(source, undefined, "ARCHIVE_EMPTY", "ZIP 안에서 XLSX 발주서를 찾지 못했습니다.")] };
  const result: WeeklyPurchaseParseResult = { documents: [], errors: [] };
  for (const entry of entries) {
    try {
      const parsed = await parseWorkbook(await entry.async("nodebuffer"), source, entry.name);
      result.documents.push(...parsed.documents); result.errors.push(...parsed.errors);
    } catch { result.errors.push(failure(source, entry.name, "ENTRY_UNREADABLE", "ZIP 안의 발주서 파일을 읽을 수 없습니다.", filePoNumber(entry.name))); }
  }
  return result;
}

function documentValues(document: WeeklyPurchaseDocument): string {
  return JSON.stringify(document.rows.map(row => [row.skuId, row.orderedQuantity, row.confirmedQuantity, row.receivedQuantity]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

/** Select one complete latest snapshot per PO; never fill a broken newer PO from an older file. */
export function resolveWeeklyPurchaseDocuments(parsed: WeeklyPurchaseParseResult[], targetPoNumbers: string[]): WeeklyPurchaseResolution {
  const documents = parsed.flatMap(item => item.documents);
  const parseErrors = parsed.flatMap(item => item.errors);
  const result: WeeklyPurchaseResolution = { resolvedRows: [], errors: [], sourceFiles: [] };
  const sources = new Map<string, WeeklyPurchaseFileSource>();
  const remember = (source: WeeklyPurchaseFileSource) => sources.set(JSON.stringify([source.id || "", source.name, source.modifiedTime]), source);
  for (const po of [...new Set(targetPoNumbers)]) {
    const candidates = documents.filter(document => document.purchaseOrderNumber === po);
    const errors = parseErrors.filter(error => !error.purchaseOrderNumber || error.purchaseOrderNumber === po);
    const latestTime = candidates.length ? Math.max(...candidates.map(document => Date.parse(document.source.modifiedTime))) : -Infinity;
    const blocking = errors.filter(error => !Number.isFinite(Date.parse(error.sourceModifiedTime)) || Date.parse(error.sourceModifiedTime) >= latestTime);
    if (blocking.length) {
      for (const error of blocking) {
        result.errors.push({ ...error, purchaseOrderNumber: po });
        remember({ name: error.sourceFile, modifiedTime: error.sourceModifiedTime, id: error.sourceId });
      }
      continue;
    }
    if (!candidates.length) {
      result.errors.push({ code: "PO_SOURCE_MISSING", message: "해당 발주서 원문이 없어 확정수량과 누적 입고를 대조할 수 없습니다.",
        purchaseOrderNumber: po, sourceFile: "발주서리스트다운", sourceModifiedTime: "" });
      continue;
    }
    const latest = candidates.filter(document => Date.parse(document.source.modifiedTime) === latestTime)
      .sort((a, b) => [a.source.name, a.sourceEntryFile, a.source.id || ""].join("|").localeCompare([b.source.name, b.sourceEntryFile, b.source.id || ""].join("|")));
    if (new Set(latest.map(documentValues)).size > 1) {
      for (const document of latest) {
        result.errors.push(failure(document.source, document.sourceEntryFile, "LATEST_CONFLICT", "같은 수정시각의 발주서에서 SKU 구성 또는 발주·확정·입고수량이 서로 다릅니다.", po));
        remember(document.source);
      }
      continue;
    }
    result.resolvedRows.push(...latest[0].rows);
    for (const document of latest) remember(document.source);
  }
  result.errors.sort((a, b) => JSON.stringify([a.purchaseOrderNumber, a.sourceFile, a.sourceEntryFile, a.code, a.sourceRow, a.message])
    .localeCompare(JSON.stringify([b.purchaseOrderNumber, b.sourceFile, b.sourceEntryFile, b.code, b.sourceRow, b.message])));
  result.sourceFiles = [...sources.values()].sort((a, b) => a.name.localeCompare(b.name) || a.modifiedTime.localeCompare(b.modifiedTime));
  return result;
}
