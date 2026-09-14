import { readdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { cachedParsedFile } from "../parsed-file-cache";
import path from "node:path";
import JSZip from "jszip";
import { downloadDriveFile, isDriveReaderConfigured, listDriveFilesFromEnv, shouldRequireDriveReader } from "../google-drive-reader";
import { normalizeSkuId } from "../sku-normalize";
import { parsePurchaseOrderSource } from "./parser";
import type { PurchaseOrderBinaryInput, PurchaseOrderDuplicate, PurchaseOrderIndex, PurchaseOrderSourceDocument } from "./types";

const LOCAL_SOURCE_DIR = process.env.WMS_PURCHASE_ORDER_SOURCE_DIR || "G:\\내 드라이브\\쿠팡데이터\\발주서리스트다운";
const DEFAULT_INDEX_CACHE_TTL_MS = 5 * 60 * 1000;
let cachedIndex: { expiresAt: number; value: PurchaseOrderIndex } | null = null;
let indexPromise: Promise<PurchaseOrderIndex> | null = null;

async function expand(container: string, buffer: Buffer): Promise<PurchaseOrderBinaryInput[]> {
  if (!container.toLowerCase().endsWith(".zip")) return [{ sourceContainerFile: container, sourceEntryFile: container, buffer }];
  const zip = await JSZip.loadAsync(buffer);
  const inputs: PurchaseOrderBinaryInput[] = [];
  for (const [entryName, entry] of Object.entries(zip.files)) {
    if (!entry.dir && entryName.toLowerCase().endsWith(".xlsx")) {
      inputs.push({ sourceContainerFile: container, sourceEntryFile: entryName, buffer: await entry.async("nodebuffer") });
    }
  }
  return inputs;
}

interface ParsedContainer { documents: PurchaseOrderSourceDocument[]; errors: PurchaseOrderIndex["parseErrors"]; entries: number }
async function parseInputs(inputs: PurchaseOrderBinaryInput[]): Promise<ParsedContainer> {
  const documents: PurchaseOrderSourceDocument[] = [], errors: PurchaseOrderIndex["parseErrors"] = [];
  for (const input of inputs) {
    try { documents.push(await parsePurchaseOrderSource(input)); }
    catch (error) { errors.push({ sourceContainerFile: input.sourceContainerFile, sourceEntryFile: input.sourceEntryFile, message: error instanceof Error ? error.message : "파싱 실패" }); }
  }
  return { documents, errors, entries: inputs.length };
}
async function loadInputs(fresh: boolean): Promise<{ containers: number; parsed: ParsedContainer[] }> {
  const parsed: ParsedContainer[] = [];
  async function load(name: string, descriptor: unknown, download: () => Promise<Buffer>) {
    return cachedParsedFile("purchase-order-parser-1", descriptor, async () => {
      const buffer = await download();
      const value = await parseInputs(await expand(name, buffer));
      return { value, contentHash: createHash("sha256").update(buffer).digest("hex"), purchaseOrders: value.documents.map(item => item.purchaseOrderNumber) };
    }, (value): value is ParsedContainer => Boolean(value && typeof value === "object" && Array.isArray((value as ParsedContainer).documents) && Array.isArray((value as ParsedContainer).errors)), fresh);
  }
  if (isDriveReaderConfigured() || shouldRequireDriveReader()) {
    const files = (await listDriveFilesFromEnv("GOOGLE_DRIVE_COUPANG_PURCHASE_ORDER_FOLDER_ID"))
      .filter(file => /\.(zip|xlsx)$/i.test(file.name));
    for (const file of files) parsed.push(await load(file.name, [file.id, file.name, file.modifiedTime, file.size], () => downloadDriveFile(file.id)));
    return { containers: files.length, parsed };
  }
  const names = (await readdir(LOCAL_SOURCE_DIR)).filter(name => /\.(zip|xlsx)$/i.test(name));
  for (const name of names) {
    const filePath = path.join(LOCAL_SOURCE_DIR, name), info = await stat(filePath);
    parsed.push(await load(name, [filePath, info.mtimeMs, info.size], () => readFile(filePath)));
  }
  return { containers: names.length, parsed };
}

function signature(document: PurchaseOrderSourceDocument): string {
  return JSON.stringify({
    center: document.fulfillmentCenterName,
    date: document.expectedArrivalDate,
    recipient: document.recipientName,
    phone: document.phone,
    postalCode: document.postalCode,
    address: document.address,
    records: document.records.map(record => [record.skuId, record.barcode, record.productName, record.optionName, record.orderedQuantity]),
  });
}

function duplicate(po: string, documents: PurchaseOrderSourceDocument[]): PurchaseOrderDuplicate {
  return { purchaseOrderNumber: po, sources: documents.map(item => `${item.sourceContainerFile} :: ${item.sourceEntryFile}`) };
}

export async function buildPurchaseOrderIndex(inputs?: PurchaseOrderBinaryInput[], sourceContainerCount?: number, fresh = true): Promise<PurchaseOrderIndex> {
  const loaded = inputs ? { containers: sourceContainerCount ?? new Set(inputs.map(item => item.sourceContainerFile)).size, parsed: [await parseInputs(inputs)] } : await loadInputs(fresh);
  const documentsByPo = new Map<string, PurchaseOrderSourceDocument[]>();
  const parseErrors: PurchaseOrderIndex["parseErrors"] = [];
  for (const container of loaded.parsed) {
    parseErrors.push(...container.errors);
    for (const document of container.documents) {
      const key = normalizeSkuId(document.purchaseOrderNumber);
      documentsByPo.set(key, [...(documentsByPo.get(key) || []), document]);
    }
  }

  const byPurchaseOrderNumber = new Map<string, PurchaseOrderSourceDocument>();
  const duplicateFiles: PurchaseOrderDuplicate[] = [];
  const identicalDuplicates: PurchaseOrderDuplicate[] = [];
  const conflicts: PurchaseOrderDuplicate[] = [];
  for (const [po, documents] of documentsByPo) {
    if (documents.length === 1) { byPurchaseOrderNumber.set(po, documents[0]); continue; }
    const info = duplicate(po, documents);
    duplicateFiles.push(info);
    if (new Set(documents.map(signature)).size === 1) {
      identicalDuplicates.push(info);
      byPurchaseOrderNumber.set(po, documents[0]);
    } else {
      conflicts.push(info);
    }
  }
  return { byPurchaseOrderNumber, duplicateFiles, identicalDuplicates, conflicts, parseErrors, sourceContainerCount: loaded.containers, sourceEntryCount: loaded.parsed.reduce((sum, item) => sum + item.entries, 0) };
}

/** 검색·미리보기에서 같은 Drive 원본을 버튼마다 다시 내려받지 않도록 하는 짧은 서버 캐시.
 * 실제 파일 생성 직전에는 buildPurchaseOrderIndex()를 직접 호출해 최신 원본을 다시 검증한다. */
export async function getCachedPurchaseOrderIndex(ttlMs = DEFAULT_INDEX_CACHE_TTL_MS): Promise<PurchaseOrderIndex> {
  if (cachedIndex && cachedIndex.expiresAt > Date.now()) return cachedIndex.value;
  if (!indexPromise) {
    indexPromise = buildPurchaseOrderIndex(undefined, undefined, false).then(value => {
      cachedIndex = { expiresAt: Date.now() + Math.max(1_000, ttlMs), value };
      return value;
    }).finally(() => {
      indexPromise = null;
    });
  }
  return indexPromise;
}
