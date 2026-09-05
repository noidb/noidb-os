import { readdir, readFile } from "node:fs/promises";
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

async function loadInputs(): Promise<{ containers: number; inputs: PurchaseOrderBinaryInput[] }> {
  if (isDriveReaderConfigured() || shouldRequireDriveReader()) {
    const files = (await listDriveFilesFromEnv("GOOGLE_DRIVE_COUPANG_PURCHASE_ORDER_FOLDER_ID"))
      .filter(file => /\.(zip|xlsx)$/i.test(file.name));
    const inputs: PurchaseOrderBinaryInput[] = [];
    for (const file of files) inputs.push(...await expand(file.name, await downloadDriveFile(file.id)));
    return { containers: files.length, inputs };
  }
  const names = (await readdir(LOCAL_SOURCE_DIR)).filter(name => /\.(zip|xlsx)$/i.test(name));
  const inputs: PurchaseOrderBinaryInput[] = [];
  for (const name of names) inputs.push(...await expand(name, await readFile(path.join(LOCAL_SOURCE_DIR, name))));
  return { containers: names.length, inputs };
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

export async function buildPurchaseOrderIndex(inputs?: PurchaseOrderBinaryInput[], sourceContainerCount?: number): Promise<PurchaseOrderIndex> {
  const loaded = inputs ? { containers: sourceContainerCount ?? new Set(inputs.map(item => item.sourceContainerFile)).size, inputs } : await loadInputs();
  const documentsByPo = new Map<string, PurchaseOrderSourceDocument[]>();
  const parseErrors: PurchaseOrderIndex["parseErrors"] = [];
  for (const input of loaded.inputs) {
    try {
      const document = await parsePurchaseOrderSource(input);
      const key = normalizeSkuId(document.purchaseOrderNumber);
      documentsByPo.set(key, [...(documentsByPo.get(key) || []), document]);
    } catch (error) {
      parseErrors.push({ sourceContainerFile: input.sourceContainerFile, sourceEntryFile: input.sourceEntryFile, message: error instanceof Error ? error.message : "파싱 실패" });
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
  return { byPurchaseOrderNumber, duplicateFiles, identicalDuplicates, conflicts, parseErrors, sourceContainerCount: loaded.containers, sourceEntryCount: loaded.inputs.length };
}

/** 검색·미리보기에서 같은 Drive 원본을 버튼마다 다시 내려받지 않도록 하는 짧은 서버 캐시.
 * 실제 파일 생성 직전에는 buildPurchaseOrderIndex()를 직접 호출해 최신 원본을 다시 검증한다. */
export async function getCachedPurchaseOrderIndex(ttlMs = DEFAULT_INDEX_CACHE_TTL_MS): Promise<PurchaseOrderIndex> {
  if (cachedIndex && cachedIndex.expiresAt > Date.now()) return cachedIndex.value;
  if (!indexPromise) {
    indexPromise = buildPurchaseOrderIndex().then(value => {
      cachedIndex = { expiresAt: Date.now() + Math.max(1_000, ttlMs), value };
      return value;
    }).finally(() => {
      indexPromise = null;
    });
  }
  return indexPromise;
}
