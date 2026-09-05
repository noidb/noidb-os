import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  downloadDriveFile,
  isDriveReaderConfigured,
  searchDriveFilesByName,
  shouldRequireDriveReader,
} from "./google-drive-reader";

const WORKBOOK_PREFIX = "쉽먼트생성_업로드파일_";

export interface ShipmentPrintWorkbookSource {
  name: string;
  modifiedTime: string;
  buffer: Buffer;
}

export class ShipmentPrintWorkbookSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShipmentPrintWorkbookSelectionError";
  }
}

function normalizedName(value: string): string {
  return value.trim().normalize("NFC");
}

function normalizedPurchaseOrder(value: unknown): string {
  return String(value ?? "").trim().replace(/\.0$/, "");
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every(value => right.has(value));
}

async function workbookPurchaseOrders(buffer: Buffer): Promise<Set<string>> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  for (const sheet of workbook.worksheets) {
    const headers = new Map<string, number>();
    sheet.getRow(1).eachCell((cell, column) => headers.set(String(cell.value ?? "").trim(), column));
    const poColumn = headers.get("발주번호") ?? headers.get("발주번호(PO ID)");
    if (!poColumn) continue;
    const purchaseOrders = new Set<string>();
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const value = normalizedPurchaseOrder(sheet.getRow(rowNumber).getCell(poColumn).value);
      if (/^\d{9}$/.test(value)) purchaseOrders.add(value);
    }
    if (purchaseOrders.size) return purchaseOrders;
  }
  return new Set();
}

export async function loadShipmentPrintWorkbookSources(expectedWorkbookName = ""): Promise<ShipmentPrintWorkbookSource[]> {
  const exactName = normalizedName(expectedWorkbookName);
  if (isDriveReaderConfigured() || shouldRequireDriveReader()) {
    const files = (await searchDriveFilesByName(exactName || WORKBOOK_PREFIX))
      .filter(file => {
        const normalized = normalizedName(file.name);
        const name = normalized.toLocaleLowerCase("ko");
        return (!exactName || normalized === exactName)
          && name.startsWith(WORKBOOK_PREFIX.toLocaleLowerCase("ko"))
          && name.endsWith(".xlsx")
          && !file.mimeType.startsWith("application/vnd.google-apps.");
      })
      .sort((left, right) => right.modifiedTime.localeCompare(left.modifiedTime));
    return Promise.all(files.map(async file => ({
      name: file.name,
      modifiedTime: file.modifiedTime,
      buffer: await downloadDriveFile(file.id),
    })));
  }

  const directory = process.env.WMS_SHIPMENT_OUTPUT_DIR || "G:\\내 드라이브\\쿠팡데이터\\쉽먼트업로드완성";
  const names = await readdir(directory);
  const files = await Promise.all(names.filter(name => {
    const normalized = normalizedName(name);
    const lowered = normalized.toLocaleLowerCase("ko");
    return !name.startsWith("~$")
      && (!exactName || normalized === exactName)
      && lowered.startsWith(WORKBOOK_PREFIX.toLocaleLowerCase("ko"))
      && lowered.endsWith(".xlsx");
  }).map(async name => {
    const fullPath = path.join(directory, name);
    const info = await stat(fullPath);
    if (!info.isFile()) return null;
    return { name, modifiedTime: info.mtime.toISOString(), buffer: await readFile(fullPath) };
  }));
  return files
    .filter((file): file is ShipmentPrintWorkbookSource => file !== null)
    .sort((left, right) => right.modifiedTime.localeCompare(left.modifiedTime));
}

export async function selectShipmentPrintWorkbook(
  workbooks: readonly ShipmentPrintWorkbookSource[],
  expectedPurchaseOrderNumbers: readonly string[],
  options: { expectedWorkbookName?: string; strictName?: boolean } = {},
): Promise<ShipmentPrintWorkbookSource> {
  const expectedName = normalizedName(options.expectedWorkbookName || "");
  if (options.strictName && !expectedName) {
    throw new ShipmentPrintWorkbookSelectionError("현재 Shipment가 사용한 쉽먼트 XLSX 파일명이 없습니다.");
  }
  if (workbooks.length === 0) {
    throw new ShipmentPrintWorkbookSelectionError(options.strictName
      ? `현재 Shipment가 사용한 쉽먼트 XLSX를 찾지 못했습니다: ${expectedName}`
      : "생성된 쉽먼트 업로드 XLSX를 찾지 못했습니다.");
  }
  const expected = new Set(expectedPurchaseOrderNumbers.map(normalizedPurchaseOrder).filter(Boolean));

  if (options.strictName) {
    const named = workbooks.filter(file => normalizedName(file.name) === expectedName);
    if (named.length !== 1) {
      throw new ShipmentPrintWorkbookSelectionError(
        named.length === 0
          ? `현재 Shipment가 사용한 쉽먼트 XLSX를 찾지 못했습니다: ${expectedName}`
          : `같은 이름의 쉽먼트 XLSX가 ${named.length}개여서 최종수량 원본을 하나로 확정할 수 없습니다: ${expectedName}`,
      );
    }
    const purchaseOrders = await workbookPurchaseOrders(named[0].buffer);
    if (!sameSet(purchaseOrders, expected)) {
      throw new ShipmentPrintWorkbookSelectionError(`쉽먼트 XLSX의 발주 ${purchaseOrders.size}건이 현재 선택 발주 ${expected.size}건과 정확히 일치하지 않습니다.`);
    }
    return named[0];
  }

  if (expected.size === 0) return workbooks[0];
  const inspected = await Promise.all(workbooks.map(async file => ({ file, purchaseOrders: await workbookPurchaseOrders(file.buffer) })));
  const exact = inspected.filter(candidate => sameSet(candidate.purchaseOrders, expected));
  if (exact.length === 0) {
    const counts = inspected.map(candidate => `${normalizedName(candidate.file.name)}: ${candidate.purchaseOrders.size}건`).join(" / ");
    throw new ShipmentPrintWorkbookSelectionError(`현재 묶음 발주번호 ${expected.size}건과 정확히 일치하는 쉽먼트 XLSX가 없습니다. ${counts}`);
  }
  const named = expectedName ? exact.find(candidate => normalizedName(candidate.file.name) === expectedName) : undefined;
  return (named || exact[0]).file;
}
