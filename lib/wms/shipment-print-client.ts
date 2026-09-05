import JSZip from "jszip";
import { PDFDocument, rgb } from "pdf-lib";
import bwipjs from "bwip-js";
import { resolveBarcodeModelIdentifier } from "./barcode-model-identifier";
import type { ProductCatalogItem } from "./product-catalog";
import type { PickingWaveItem } from "./picking-wave/types";
import { resolveDisplayNameAndOption } from "./display-name";

export interface PdfTextItem {
  text: string;
  x: number;
  y: number;
}
export interface ShipmentPdfFile {
  shipmentNumber: string;
  file: File;
  pageCount: number;
  pageWidth: number;
  pageHeight: number;
  pblCode: string;
  trackingNumber: string;
  expectedDate: string;
  fulfillmentCenter: string;
  purchaseOrderNumbers: string[];
  boxNumber: string;
  items: { skuId: string; barcode: string; quantity: number }[];
}

export interface BarcodeSourceRow {
  purchaseOrderNumber: string;
  fulfillmentCenter: string;
  expectedDate: string;
  skuId: string;
  warehouseNumber: string;
  barcode: string;
  productName: string;
  optionLabel: string;
  quantity: number;
  sourceRowNumber: number;
  embeddedModelName: string;
  embeddedCountryOfOrigin: string;
  trackingNumber: string;
}

export interface ShipmentPrintGroup {
  shipmentNumber: string;
  label: ShipmentPdfFile;
  manifest: ShipmentPdfFile;
  barcodeRows: (BarcodeSourceRow & { modelName: string; countryOfOrigin: string })[];
  purchaseOrderNumbers: string[];
  fulfillmentCenter: string;
  expectedDate: string;
  boxNumber: string;
}

const A4: [number, number] = [595.28, 841.89];
const LABEL_PAGE: [number, number] = [134.65, 70.87]; // 47.5 x 25 mm

function filenameShipmentNumber(name: string): string | null {
  return name.match(/\((\d{8})\)/)?.[1] ?? null;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function formatShipmentQuantitySummary(skuCount: number, totalQuantity: number): string {
  return `SKU ${skuCount}종 / 총 ${totalQuantity}개`;
}

async function pdfTextPages(file: File): Promise<{ width: number; height: number; items: PdfTextItem[] }[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.worker.min.mjs";
  }
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: { width: number; height: number; items: PdfTextItem[] }[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    pages.push({
      width: viewport.width,
      height: viewport.height,
      items: content.items
        .filter((item): item is typeof item & { str: string; transform: number[] } => "str" in item && "transform" in item)
        .map(item => ({ text: item.str.trim(), x: item.transform[4], y: item.transform[5] }))
        .filter(item => item.text),
    });
  }
  return pages;
}

function findFirst(items: PdfTextItem[], pattern: RegExp): string {
  for (const item of items) {
    const match = item.text.match(pattern);
    if (match) return match[1] ?? match[0];
  }
  return "";
}

function topCenter(items: PdfTextItem[], height: number): string {
  return items
    .filter(item => item.y > height * 0.82 && item.x < 170)
    .map(item => item.text)
    .find(text => !/^\*/.test(text) && !/^박스/.test(text) && !/^\d+$/.test(text)) ?? "";
}

function parseManifestItems(pages: { items: PdfTextItem[] }[]): { skuId: string; barcode: string; quantity: number }[] {
  const rows: { skuId: string; barcode: string; quantity: number }[] = [];
  for (const page of pages) {
    const skuItems = page.items.filter(item => /^\d{7,9}$/.test(item.text) && item.x >= 115 && item.x < 200);
    for (const skuItem of skuItems) {
      const barcode = page.items.find(item => item.x < 125 && Math.abs(item.y - skuItem.y) <= 8 && /^[A-Z0-9-]{8,}$/.test(item.text))?.text ?? "";
      const quantityText = page.items.find(item => item.x >= 395 && item.x < 455 && Math.abs(item.y - skuItem.y) <= 8 && /^\d+$/.test(item.text))?.text ?? "";
      const quantity = Number(quantityText);
      if (barcode && Number.isInteger(quantity) && quantity > 0) rows.push({ skuId: skuItem.text, barcode, quantity });
    }
  }
  return rows;
}

export async function inspectShipmentPdf(file: File, kind: "label" | "manifest"): Promise<ShipmentPdfFile> {
  const shipmentNumberFromName = filenameShipmentNumber(file.name);
  if (!shipmentNumberFromName) throw new Error(`${file.name}: 파일명에서 8자리 쉽먼트번호를 찾지 못했습니다.`);
  let pages: Awaited<ReturnType<typeof pdfTextPages>>;
  try {
    pages = await pdfTextPages(file);
  } catch (error) {
    throw new Error(`${file.name}: PDF가 손상되었거나 암호화되어 읽을 수 없습니다. ${error instanceof Error ? error.message : ""}`.trim());
  }
  if (pages.length === 0) throw new Error(`${file.name}: PDF 페이지가 없습니다.`);
  const items = pages.flatMap(page => page.items);
  const allText = items.map(item => item.text).join(" ");
  const contentShipment = kind === "manifest" ? findFirst(items, /\b(\d{8})\b/) : shipmentNumberFromName;
  if (kind === "manifest" && contentShipment !== shipmentNumberFromName) {
    throw new Error(`${file.name}: 파일명 쉽먼트번호 ${shipmentNumberFromName}와 PDF 내용 ${contentShipment || "미확인"}이 다릅니다.`);
  }
  return {
    shipmentNumber: shipmentNumberFromName,
    file,
    pageCount: pages.length,
    pageWidth: pages[0].width,
    pageHeight: pages[0].height,
    pblCode: findFirst(items, /\b(PBL\d+)\b/),
    trackingNumber: findFirst(items, /\b(\d{12})\b/),
    expectedDate: findFirst(items, /\b(20\d{2}-\d{2}-\d{2})\b/),
    fulfillmentCenter: topCenter(pages[0].items, pages[0].height),
    purchaseOrderNumbers: kind === "label" ? unique(allText.match(/\b1[34]\d{7}\b/g) ?? []) : [],
    boxNumber: findFirst(items, /박스\s*([0-9]+-[0-9]+)/),
    items: kind === "manifest" ? parseManifestItems(pages) : [],
  };
}

export async function parseBarcodeWorkbook(file: File): Promise<BarcodeSourceRow[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch (error) {
    throw new Error(`${file.name}: xlsx 구조를 읽지 못했습니다. ${error instanceof Error ? error.message : ""}`.trim());
  }
  const parseXml = (xml: string) => new DOMParser().parseFromString(xml, "application/xml");
  const nodes = (root: Document | Element, localName: string) => [...root.getElementsByTagNameNS("*", localName)];
  const workbookXml = zip.file("xl/workbook.xml");
  const relsXml = zip.file("xl/_rels/workbook.xml.rels");
  if (!workbookXml || !relsXml) throw new Error(`${file.name}: xlsx 워크북 구조가 없습니다.`);
  const workbookDoc = parseXml(await workbookXml.async("text"));
  const relsDoc = parseXml(await relsXml.async("text"));
  const relTargets = new Map(nodes(relsDoc, "Relationship").map(node => [node.getAttribute("Id") ?? "", node.getAttribute("Target") ?? ""]));
  const sharedStringsFile = zip.file("xl/sharedStrings.xml");
  const sharedStrings = sharedStringsFile
    ? nodes(parseXml(await sharedStringsFile.async("text")), "si").map(node => nodes(node, "t").map(text => text.textContent ?? "").join(""))
    : [];
  const columnNumber = (reference: string) => [...(reference.match(/^[A-Z]+/)?.[0] ?? "")].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0);
  const sheetRows: { sheetName: string; rows: string[][] }[] = [];
  for (const sheetNode of nodes(workbookDoc, "sheet")) {
    const sheetName = sheetNode.getAttribute("name") ?? "";
    const relationId = sheetNode.getAttribute("r:id") ?? sheetNode.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? "";
    const target = relTargets.get(relationId)?.replace(/^\/?xl\//, "") ?? "";
    const sheetFile = zip.file(`xl/${target}`);
    if (!sheetFile) continue;
    const sheetDoc = parseXml(await sheetFile.async("text"));
    const parsedRows: string[][] = [];
    for (const rowNode of nodes(sheetDoc, "row")) {
      const values: string[] = [];
      for (const cellNode of nodes(rowNode, "c")) {
        const column = columnNumber(cellNode.getAttribute("r") ?? "");
        const type = cellNode.getAttribute("t") ?? "";
        const raw = nodes(cellNode, "v")[0]?.textContent ?? "";
        const inline = nodes(cellNode, "t").map(node => node.textContent ?? "").join("");
        values[column - 1] = type === "s" ? sharedStrings[Number(raw)] ?? "" : type === "inlineStr" ? inline : raw;
      }
      parsedRows.push(values);
    }
    sheetRows.push({ sheetName, rows: parsedRows });
  }
  const selected = sheetRows.map(sheet => ({
    ...sheet,
    headers: new Map(Array.from({ length: (sheet.rows[0] ?? []).length }, (_, index) => [String(sheet.rows[0]?.[index] ?? "").trim(), index] as const).filter(([header]) => header)),
  })).find(sheet =>
    (sheet.headers.has("발주번호") && sheet.headers.has("출력수량")) ||
    (sheet.headers.has("발주번호(PO ID)") && sheet.headers.has("납품수량(Shipped Qty)"))
  ) ?? null;
  if (!selected) throw new Error(`${file.name}: 바코드 출력 데이터 또는 쉽먼트 결과 열 구조를 찾지 못했습니다.`);
  const header = (...candidates: string[]) => candidates.find(candidate => selected.headers.has(candidate)) ?? "";
  const rows: BarcodeSourceRow[] = [];
  for (let rowIndex = 1; rowIndex < selected.rows.length; rowIndex += 1) {
    const row = selected.rows[rowIndex];
    const rowNumber = rowIndex + 1;
    const value = (...candidates: string[]) => String(row[selected.headers.get(header(...candidates)) ?? -1] ?? "").trim();
    const skuId = value("SKU ID", "상품번호(SKU ID)").replace(/\.0$/, "");
    if (!skuId) continue;
    const quantity = Number(value("출력수량", "납품수량(Shipped Qty)"));
    if (!Number.isInteger(quantity) || quantity <= 0) throw new Error(`${file.name} ${rowNumber}행 SKU ${skuId}: 출력수량을 확인할 수 없습니다.`);
    const rawDate = value("입고예정일", "입고예정일(EDD)").replace(/[^0-9]/g, "");
    rows.push({
      purchaseOrderNumber: value("발주번호", "발주번호(PO ID)").replace(/\.0$/, ""),
      fulfillmentCenter: value("센터", "물류센터(FC)"),
      expectedDate: rawDate.length === 8 ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6)}` : value("입고예정일", "입고예정일(EDD)"),
      skuId,
      warehouseNumber: selected.headers.has("창고번호") ? value("창고번호") : "",
      barcode: value("바코드", "상품바코드(SKU Barcode)"),
      productName: value("상품명", "상품이름(SKU Name)"),
      optionLabel: value("옵션명"),
      quantity,
      sourceRowNumber: rowNumber,
      embeddedModelName: selected.headers.has("모델명") ? value("모델명") : "",
      embeddedCountryOfOrigin: selected.headers.has("제조국명") ? value("제조국명") : "",
      trackingNumber: value("송장번호(Invoice Number)"),
    });
  }
  return rows;
}

export function matchShipmentPrintGroups(
  labels: ShipmentPdfFile[],
  manifests: ShipmentPdfFile[],
  barcodeRows: BarcodeSourceRow[],
  catalogItems: ProductCatalogItem[],
  _waveItems: PickingWaveItem[] = []
): ShipmentPrintGroup[] {
  const errors: string[] = [];
  const duplicateNumbers = (files: ShipmentPdfFile[]) => unique(files.map(file => file.shipmentNumber).filter((number, index, all) => all.indexOf(number) !== index));
  const duplicateLabels = duplicateNumbers(labels);
  const duplicateManifests = duplicateNumbers(manifests);
  if (duplicateLabels.length) errors.push(`Label 중복 쉽먼트번호: ${duplicateLabels.join(", ")}`);
  if (duplicateManifests.length) errors.push(`내역서 중복 쉽먼트번호: ${duplicateManifests.join(", ")}`);
  const labelByShipment = new Map(labels.map(file => [file.shipmentNumber, file]));
  const manifestByShipment = new Map(manifests.map(file => [file.shipmentNumber, file]));
  const allShipments = unique([...labelByShipment.keys(), ...manifestByShipment.keys()]);
  const catalogBySku = new Map<string, ProductCatalogItem[]>();
  for (const item of catalogItems) catalogBySku.set(item.skuId, [...(catalogBySku.get(item.skuId) ?? []), item]);
  const rowsBySku = new Map<string, BarcodeSourceRow[]>();
  for (const row of barcodeRows) rowsBySku.set(row.skuId, [...(rowsBySku.get(row.skuId) ?? []), row]);

  const groups: ShipmentPrintGroup[] = [];
  for (const shipmentNumber of allShipments) {
    const label = labelByShipment.get(shipmentNumber);
    const manifest = manifestByShipment.get(shipmentNumber);
    if (!label || !manifest) {
      errors.push(`${shipmentNumber}: ${label ? "내역서" : "Label"} 누락`);
      continue;
    }
    for (const field of ["pblCode", "trackingNumber", "expectedDate", "fulfillmentCenter"] as const) {
      if (!label[field] || !manifest[field] || label[field] !== manifest[field]) errors.push(`${shipmentNumber}: Label/내역서 ${field} 불일치 (${label.file.name}, ${manifest.file.name})`);
    }
    if (manifest.items.length === 0) errors.push(`${shipmentNumber}: 내역서에서 SKU/납품수량을 읽지 못했습니다 (${manifest.file.name})`);
    const matchedRows: ShipmentPrintGroup["barcodeRows"] = [];
    for (const item of manifest.items) {
      const allSourceCandidates = rowsBySku.get(item.skuId) ?? [];
      const sourceCandidates = allSourceCandidates.some(row => row.trackingNumber)
        ? allSourceCandidates.filter(row => row.trackingNumber === manifest.trackingNumber)
        : allSourceCandidates;
      if (sourceCandidates.length !== 1) {
        errors.push(`${shipmentNumber} SKU ${item.skuId}: 바코드 출력 데이터 ${sourceCandidates.length}건 (정확히 1건 필요)`);
        continue;
      }
      const source = sourceCandidates[0];
      if (source.barcode !== item.barcode) errors.push(`${shipmentNumber} SKU ${item.skuId}: 상품바코드 불일치`);
      if (source.quantity !== item.quantity) errors.push(`${shipmentNumber} SKU ${item.skuId}: 최종 납품수량 불일치 (${source.quantity}/${item.quantity})`);
      if (source.expectedDate !== manifest.expectedDate || source.fulfillmentCenter !== manifest.fulfillmentCenter) errors.push(`${shipmentNumber} SKU ${item.skuId}: 입고예정일 또는 물류센터 불일치`);
      const catalog = catalogBySku.get(item.skuId) ?? [];
      if (catalog.length !== 1) {
        errors.push(`${shipmentNumber} SKU ${item.skuId}: 제품DB ${catalog.length}건 (정확히 1건 필요)`);
        continue;
      }
      // SKU/바코드/상품명/옵션/수량은 발주서 기반 source를 유일한 기준으로 사용한다.
      // 제조국과 모델명만 SKU ID로 조회한 제품DB(구글시트) 값을 보강한다.
      const resolvedModelName = resolveBarcodeModelIdentifier(catalog[0]);
      if (!catalog[0].countryOfOrigin || !resolvedModelName) errors.push(`${shipmentNumber} SKU ${item.skuId}: 제품DB 제조국 또는 영문·숫자 모델SKU/모델명 누락`);
      const display = resolveDisplayNameAndOption(
        source.productName,
        source.optionLabel
      );
      matchedRows.push({
        ...source,
        productName: display.name,
        optionLabel: display.option,
        modelName: resolvedModelName,
        countryOfOrigin: catalog[0].countryOfOrigin,
      });
    }
    const purchaseOrderNumbers = unique(matchedRows.map(row => row.purchaseOrderNumber));
    const labelPo = [...label.purchaseOrderNumbers].sort().join(",");
    const dataPo = [...purchaseOrderNumbers].sort().join(",");
    if (labelPo !== dataPo) errors.push(`${shipmentNumber}: Label 발주번호(${labelPo || "미확인"})와 데이터(${dataPo || "미확인"}) 불일치`);
    groups.push({
      shipmentNumber,
      label,
      manifest,
      // manifest.items를 순회하며 쌓은 순서를 그대로 유지한다. 발주서 원본 행번호로
      // 다시 정렬하면 동봉내역서에 표시된 상품 순서와 바코드 출력 순서가 달라진다.
      barcodeRows: matchedRows,
      purchaseOrderNumbers,
      fulfillmentCenter: manifest.fulfillmentCenter,
      expectedDate: manifest.expectedDate,
      boxNumber: manifest.boxNumber,
    });
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return groups.sort((a, b) =>
    a.expectedDate.localeCompare(b.expectedDate) ||
    a.fulfillmentCenter.localeCompare(b.fulfillmentCenter, "ko") ||
    a.shipmentNumber.localeCompare(b.shipmentNumber)
  );
}

export async function buildFourUpLabelPdf(groups: ShipmentPrintGroup[]): Promise<Uint8Array> {
  const output = await PDFDocument.create();
  for (let index = 0; index < groups.length; index += 4) {
    const page = output.addPage(A4);
    const margin = 18;
    const gutter = 10;
    const cellWidth = (A4[0] - margin * 2 - gutter) / 2;
    const cellHeight = (A4[1] - margin * 2 - gutter) / 2;
    page.drawLine({ start: { x: A4[0] / 2, y: margin }, end: { x: A4[0] / 2, y: A4[1] - margin }, thickness: 0.35, color: rgb(0.65, 0.65, 0.65) });
    page.drawLine({ start: { x: margin, y: A4[1] / 2 }, end: { x: A4[0] - margin, y: A4[1] / 2 }, thickness: 0.35, color: rgb(0.65, 0.65, 0.65) });
    for (let slot = 0; slot < Math.min(4, groups.length - index); slot += 1) {
      const group = groups[index + slot];
      const source = await PDFDocument.load(await group.label.file.arrayBuffer());
      const [embedded] = await output.embedPdf(source, [0]);
      const scale = Math.min((cellWidth - 10) / embedded.width, (cellHeight - 10) / embedded.height);
      const width = embedded.width * scale;
      const height = embedded.height * scale;
      const column = slot % 2;
      const row = Math.floor(slot / 2);
      const cellX = margin + column * (cellWidth + gutter);
      const cellY = A4[1] - margin - (row + 1) * cellHeight - row * gutter;
      page.drawPage(embedded, { x: cellX + (cellWidth - width) / 2, y: cellY + (cellHeight - height) / 2, width, height });
    }
  }
  return output.save();
}

/**
 * 기존 BarTender 양식이 참조하는 7개 열 이름을 바꾸지 않고 출력용 XLSX를 만든다.
 * 각 쉽먼트 첫 행은 상품 바코드를 비워 구분표로 출력하고, 다음 행부터 최종 납품수량만큼
 * 상품행을 반복한다. 동봉내역서의 상품 순서는 matchShipmentPrintGroups에서 이미 보존된다.
 */
export async function buildBarTenderWorkbook(groups: ShipmentPrintGroup[]): Promise<Uint8Array> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("템플릿1");
  const headers = ["SKU ID", "번호", "바코드", "상품명", "옵션명", "제조국명", "모델명", "출력유형"];
  sheet.addRow(headers);
  const outputRows: (string | number)[][] = [];

  for (const group of groups) {
    const skuCount = group.barcodeRows.length;
    const totalQuantity = group.barcodeRows.reduce((sum, row) => sum + row.quantity, 0);
    outputRows.push([
      "쉽먼트 구분",
      "",
      "",
      group.fulfillmentCenter,
      `입고예정일 ${group.expectedDate}\n쉽먼트번호 ${group.shipmentNumber}`,
      `발주번호 ${group.purchaseOrderNumbers.join(", ")}`,
      formatShipmentQuantitySummary(skuCount, totalQuantity),
      "쉽먼트구분",
    ]);
    for (const row of group.barcodeRows) {
      for (let count = 0; count < row.quantity; count += 1) {
        outputRows.push([
          row.skuId,
          row.warehouseNumber,
          row.barcode,
          row.productName,
          row.optionLabel,
          row.countryOfOrigin,
          row.modelName,
          "상품",
        ]);
      }
    }
  }
  // 라벨 프린터는 먼저 출력한 라벨이 묶음의 아래쪽에 쌓인다. 전체 레코드를 역순으로
  // 전송해야 최종 묶음을 위에서 볼 때 구분표 → 해당 상품 순서가 된다.
  for (const row of outputRows.reverse()) sheet.addRow(row);
  sheet.getRow(1).font = { bold: true };
  sheet.columns = [12, 8, 18, 48, 36, 18, 24, 14].map(width => ({ width }));
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

export async function buildMergedManifestPdf(groups: ShipmentPrintGroup[]): Promise<Uint8Array> {
  const output = await PDFDocument.create();
  for (const group of groups) {
    const source = await PDFDocument.load(await group.manifest.file.arrayBuffer());
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach(page => output.addPage(page));
  }
  return output.save();
}

function canvas(width = 561, height = 295): HTMLCanvasElement {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  return element;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, start: number, min: number): number {
  for (let size = start; size >= min; size -= 1) {
    ctx.font = `700 ${size}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) return size;
  }
  return min;
}

function separatorCanvas(group: ShipmentPrintGroup): HTMLCanvasElement {
  const element = canvas();
  const ctx = element.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, element.width, element.height);
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, element.width - 10, element.height - 10);
  ctx.fillStyle = "#111";
  ctx.textAlign = "center";
  ctx.font = `900 ${fitText(ctx, group.fulfillmentCenter, 500, 68, 42)}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
  ctx.fillText(group.fulfillmentCenter, element.width / 2, 78);
  ctx.font = '800 28px "Noto Sans KR", "Malgun Gothic", sans-serif';
  ctx.fillText(`입고예정일 ${group.expectedDate}`, element.width / 2, 122);
  ctx.font = '700 23px "Noto Sans KR", "Malgun Gothic", sans-serif';
  ctx.fillText(`쉽먼트 ${group.shipmentNumber}`, element.width / 2, 160);
  ctx.font = '700 19px "Noto Sans KR", "Malgun Gothic", sans-serif';
  ctx.fillText(`발주 ${group.purchaseOrderNumbers.join(", ")}`, element.width / 2, 195);
  const total = group.barcodeRows.reduce((sum, row) => sum + row.quantity, 0);
  ctx.font = '800 24px "Noto Sans KR", "Malgun Gothic", sans-serif';
  ctx.fillText(formatShipmentQuantitySummary(group.barcodeRows.length, total), element.width / 2, 242);
  ctx.font = '600 14px "Noto Sans KR", "Malgun Gothic", sans-serif';
  ctx.fillText("이 구분표 다음 라벨부터 동일 쉽먼트", element.width / 2, 272);
  return element;
}

function barcodeCanvas(row: ShipmentPrintGroup["barcodeRows"][number]): HTMLCanvasElement {
  const element = canvas();
  const ctx = element.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, element.width, element.height);
  const barcode = canvas(470, 112);
  bwipjs.toCanvas(barcode, { bcid: "code128", text: row.barcode, scale: 3, height: 9, includetext: true, textxalign: "center", textsize: 9, paddingwidth: 4, paddingheight: 2 });
  ctx.drawImage(barcode, 45, 8, 470, 112);
  ctx.fillStyle = "#111";
  ctx.textAlign = "left";
  const title = `${row.productName} ${row.optionLabel}`.trim();
  ctx.font = `800 ${fitText(ctx, title, 520, 25, 14)}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
  ctx.fillText(title, 20, 151);
  ctx.font = '700 18px "Noto Sans KR", "Malgun Gothic", sans-serif';
  ctx.fillText(`SKU ${row.skuId}  번호 ${row.warehouseNumber || "-"}`, 20, 185);
  ctx.fillText(`모델 ${row.modelName}  제조국 ${row.countryOfOrigin}`, 20, 216);
  ctx.font = '600 14px "Noto Sans KR", "Malgun Gothic", sans-serif';
  ctx.fillText("출력 필드: SKU ID / 번호 / 바코드 / 상품명 / 옵션명 / 제조국명 / 모델명", 20, 260);
  return element;
}

async function canvasPng(element: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => element.toBlob(value => value ? resolve(value) : reject(new Error("PNG 생성 실패")), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

export async function buildSkuBarcodePdf(groups: ShipmentPrintGroup[], onProgress?: (done: number, total: number) => void): Promise<Uint8Array> {
  const output = await PDFDocument.create();
  const totalPages = groups.reduce((sum, group) => sum + 1 + group.barcodeRows.reduce((rowSum, row) => rowSum + row.quantity, 0), 0);
  let done = 0;
  for (const group of groups) {
    const separator = await output.embedPng(await canvasPng(separatorCanvas(group)));
    const separatorPage = output.addPage(LABEL_PAGE);
    separatorPage.drawImage(separator, { x: 0, y: 0, width: LABEL_PAGE[0], height: LABEL_PAGE[1] });
    onProgress?.(++done, totalPages);
    for (const row of group.barcodeRows) {
      const image = await output.embedPng(await canvasPng(barcodeCanvas(row)));
      for (let copy = 0; copy < row.quantity; copy += 1) {
        const page = output.addPage(LABEL_PAGE);
        page.drawImage(image, { x: 0, y: 0, width: LABEL_PAGE[0], height: LABEL_PAGE[1] });
        onProgress?.(++done, totalPages);
      }
    }
  }
  return output.save();
}

function transactionStatementCanvas(group: ShipmentPrintGroup, rows: ShipmentPrintGroup["barcodeRows"], pageNumber: number, pageCount: number): HTMLCanvasElement {
  const element = canvas(1240, 1754);
  const ctx = element.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, element.width, element.height);
  ctx.fillStyle = "#111";
  ctx.textAlign = "left";
  ctx.font = '900 48px "Noto Sans KR", "Malgun Gothic", sans-serif';
  ctx.fillText("거래명세서", 70, 90);
  ctx.font = '700 24px "Noto Sans KR", "Malgun Gothic", sans-serif';
  ctx.fillText(`물류센터  ${group.fulfillmentCenter}`, 70, 145);
  ctx.fillText(`입고예정일  ${group.expectedDate}`, 70, 182);
  ctx.fillText(`Shipment  ${group.shipmentNumber}`, 70, 219);
  ctx.fillText(`발주번호  ${group.purchaseOrderNumbers.join(" / ")}`, 70, 256);
  ctx.textAlign = "right";
  ctx.fillText(`${pageNumber}/${pageCount}`, 1170, 90);
  ctx.textAlign = "left";

  const columns = [70, 250, 780, 1100];
  const headerY = 320;
  ctx.fillStyle = "#ece8e2";
  ctx.fillRect(60, headerY - 36, 1120, 54);
  ctx.fillStyle = "#111";
  ctx.font = '800 22px "Noto Sans KR", "Malgun Gothic", sans-serif';
  ctx.fillText("SKU ID", columns[0], headerY);
  ctx.fillText("상품명 / 옵션", columns[1], headerY);
  ctx.fillText("바코드", columns[2], headerY);
  ctx.textAlign = "right";
  ctx.fillText("수량", columns[3] + 60, headerY);
  ctx.textAlign = "left";

  rows.forEach((row, index) => {
    const y = headerY + 65 + index * 58;
    ctx.strokeStyle = "#ddd8d1";
    ctx.beginPath(); ctx.moveTo(60, y + 18); ctx.lineTo(1180, y + 18); ctx.stroke();
    ctx.fillStyle = "#111";
    ctx.font = '600 19px "Noto Sans KR", "Malgun Gothic", sans-serif';
    ctx.fillText(row.skuId, columns[0], y);
    const name = `${row.productName}${row.optionLabel ? ` / ${row.optionLabel}` : ""}`;
    ctx.font = `600 ${fitText(ctx, name, 500, 19, 10)}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
    ctx.fillText(name, columns[1], y);
    ctx.fillText(row.barcode, columns[2], y);
    ctx.textAlign = "right";
    ctx.font = '800 21px "Noto Sans KR", "Malgun Gothic", sans-serif';
    ctx.fillText(String(row.quantity), columns[3] + 60, y);
    ctx.textAlign = "left";
  });
  return element;
}

export async function buildTransactionStatementPdf(groups: ShipmentPrintGroup[]): Promise<Uint8Array> {
  const output = await PDFDocument.create();
  const rowsPerPage = 22;
  for (const group of groups) {
    const pageCount = Math.max(1, Math.ceil(group.barcodeRows.length / rowsPerPage));
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const rows = group.barcodeRows.slice(pageIndex * rowsPerPage, (pageIndex + 1) * rowsPerPage);
      const image = await output.embedPng(await canvasPng(transactionStatementCanvas(group, rows, pageIndex + 1, pageCount)));
      const page = output.addPage(A4);
      page.drawImage(image, { x: 0, y: 0, width: A4[0], height: A4[1] });
    }
  }
  return output.save();
}

export async function buildShipmentPrintZip(files: { name: string; bytes: Uint8Array }[]): Promise<Blob> {
  const zip = new JSZip();
  files.forEach(file => zip.file(file.name, file.bytes));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
