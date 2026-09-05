import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { fetchSheetRows } from "./google-sheets";
import { analyzeInboundImportSafety, parseInboundSourceRows, type InboundImportDataset } from "./inbound-import-safety";
import { buildInboundCellPreview } from "./inbound-cell-preview";

export async function readInboundWorkbook(buffer: Buffer, sourceFile: string): Promise<InboundImportDataset> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("입고파일의 시트를 찾을 수 없습니다.");
  const text = (value: ExcelJS.CellValue): string => {
    if (value === null || value === undefined) return "";
    if (value instanceof Date) return value.toISOString().replace("T", " ").slice(0, 19);
    if (typeof value !== "object") return String(value).replace(/\u00a0/g, " ").trim();
    if ("richText" in value) return value.richText.map(part => part.text || "").join("").trim();
    if ("result" in value) return String(value.result ?? "").trim();
    if ("text" in value) return String(value.text ?? "").trim();
    return "";
  };
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, row => rows.push(Array.from({ length: sheet.columnCount }, (_, i) => text(row.getCell(i + 1).value))));
  const headerIndex = rows.findIndex(row => row.some(value => ["SKU ID", "SKU번호", "SKU"].includes(value)));
  if (headerIndex < 0) throw new Error("입고파일의 SKU 열을 찾을 수 없습니다.");
  const headers = rows[headerIndex];
  const objects = rows.slice(headerIndex + 1).filter(row => row.some(Boolean)).map(row => Object.fromEntries(headers.map((header, i) => [header, row[i] || ""])));
  return { fingerprint: createHash("sha256").update(buffer).digest("hex"), sourceFile, items: parseInboundSourceRows(objects, sourceFile) };
}

export function buildInboundImportContext(datasets: InboundImportDataset[], historyRows: string[][], productRows: string[][], purchaseRows: string[][], sourceVersion = "") {
  const safety = analyzeInboundImportSafety(historyRows, datasets);
  if (safety.conflicts.length) throw new Error("기존 입고와 파일의 값이 다릅니다. 겹친 입고기록을 확인해 주세요.");
  const incoming = safety.acceptedDatasets.flatMap(dataset => dataset.items);
  const cellPreview = buildInboundCellPreview(productRows, purchaseRows, historyRows, incoming);
  const token = createHash("sha256").update(JSON.stringify([safety.previewToken, cellPreview.token, sourceVersion])).digest("hex");
  return { datasets, historyRows, productRows, purchaseRows, safety, incoming, cellPreview, token };
}
export type InboundImportContext = ReturnType<typeof buildInboundImportContext>;

export async function loadInboundImportContext(datasets: InboundImportDataset[], sourceVersion = ""): Promise<InboundImportContext> {
  const [history, products, purchases] = await Promise.all([
    fetchSheetRows("_입고요약"), fetchSheetRows("제품DB", { valueRenderOption: "FORMULA" }), fetchSheetRows("_발주이력"),
  ]);
  return buildInboundImportContext(datasets, history, products, purchases, sourceVersion);
}

export function inboundPreviewSummary(context: InboundImportContext) {
  const s = context.safety;
  return { parsed: context.cellPreview.skus.length, totalInbound: s.candidateInbound, totalOutbound: s.candidateOutbound,
    files: context.datasets.length, candidateEvents: s.candidateEventCount, duplicateEvents: s.duplicateEventCount,
    overlapDuplicateEvents: s.overlapDuplicateEventCount, previewToken: context.token, cellPreview: context.cellPreview };
}
