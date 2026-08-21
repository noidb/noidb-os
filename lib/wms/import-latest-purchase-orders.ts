import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import {
  getIncomingPurchaseOrdersDir,
  loadSupplierHubPurchaseOrders,
  loadSupplierHubPurchaseOrdersFromDriveFiles,
  parseSupplierHubPurchaseOrderBuffer,
} from "./supplier-hub-orders";
import {
  isDriveReaderConfigured,
  listDriveFilesFromEnv,
  shouldRequireDriveReader,
} from "./google-drive-reader";

/**
 * "최신 발주서 불러오기" 기능. 쿠팡 서플라이허브에서 다운로드해 구글드라이브에 쌓아두는
 * 발주서리스트 ZIP/xlsx 중 가장 최근 파일을 찾아, 안에 든 발주서 중 아직 incoming-purchase-orders
 * 폴더에 없는(=발주서번호 기준 신규) 것만 복사해 넣는다.
 *
 * 안전 규칙 (2026-08-19 사용자 확정):
 * - 원본 ZIP/xlsx(SOURCE_DIR)는 읽기만 하고 절대 수정·이동·삭제하지 않는다.
 * - 같은 발주서번호는 다시 쓰지 않는다(중복 방지) — 파일명이 아니라 엑셀 안의 실제 발주서번호로 판단한다.
 * - 이 모듈은 로컬 파일시스템(사용자 PC의 구글드라이브 동기화 폴더)만 다루며, 외부 API 호출이 없다.
 */

const SOURCE_DIR = "G:\\내 드라이브\\쿠팡데이터\\발주서리스트다운";

export interface ImportLatestResult {
  sourceFileName: string;
  addedPurchaseOrderNumbers: string[];
  skippedDuplicatePurchaseOrderNumbers: string[];
  totalPurchaseOrders: number;
  totalSkuTypes: number;
  totalQuantity: number;
}

async function findLatestSourceFile(): Promise<{ filePath: string; fileName: string } | null> {
  let entries: string[];
  try {
    entries = await readdir(SOURCE_DIR);
  } catch {
    return null;
  }

  const candidates = entries.filter(name => /\.(zip|xlsx)$/i.test(name));
  let latest: { filePath: string; fileName: string; mtimeMs: number } | null = null;

  for (const fileName of candidates) {
    const filePath = path.join(SOURCE_DIR, fileName);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) continue;
    if (!latest || fileStat.mtimeMs > latest.mtimeMs) {
      latest = { filePath, fileName, mtimeMs: fileStat.mtimeMs };
    }
  }

  return latest ? { filePath: latest.filePath, fileName: latest.fileName } : null;
}

/** ZIP이면 안의 .xlsx들을, xlsx 단일 파일이면 그 자체를 버퍼 배열로 반환한다. 원본 파일은 읽기만 한다. */
async function extractXlsxBuffers(filePath: string): Promise<{ name: string; buffer: Buffer }[]> {
  const { readFile } = await import("node:fs/promises");
  const raw = await readFile(filePath);

  if (filePath.toLowerCase().endsWith(".zip")) {
    const zip = await JSZip.loadAsync(raw);
    const results: { name: string; buffer: Buffer }[] = [];
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir || !name.toLowerCase().endsWith(".xlsx")) continue;
      const buffer = await entry.async("nodebuffer");
      results.push({ name, buffer });
    }
    return results;
  }

  return [{ name: path.basename(filePath), buffer: raw }];
}

/**
 * 최신 발주 파일을 찾아 신규 발주서만 incoming-purchase-orders 폴더에 복사하고,
 * 반영 후 전체 발주서 기준 요약(총 발주서 수/총 SKU 종류/총 수량)을 반환한다.
 */
export async function importLatestPurchaseOrders(): Promise<ImportLatestResult> {
  if (isDriveReaderConfigured() || shouldRequireDriveReader()) {
    const files = (await listDriveFilesFromEnv("GOOGLE_DRIVE_COUPANG_PURCHASE_ORDER_FOLDER_ID"))
      .filter(file => /\.(zip|xlsx)$/i.test(file.name))
      .sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
    const latest = files[0];
    if (!latest) throw new Error("Google Drive 발주서리스트 폴더에서 ZIP/xlsx 파일을 찾지 못했습니다.");

    const [latestOrders, previousOrders] = await Promise.all([
      loadSupplierHubPurchaseOrdersFromDriveFiles([latest]),
      loadSupplierHubPurchaseOrdersFromDriveFiles(files.slice(1)),
    ]);
    const previousPoNumbers = new Set(previousOrders.map(order => order.purchaseOrderNumber));
    const addedPurchaseOrderNumbers = latestOrders
      .map(order => order.purchaseOrderNumber)
      .filter(poNumber => !previousPoNumbers.has(poNumber));
    const skippedDuplicatePurchaseOrderNumbers = latestOrders
      .map(order => order.purchaseOrderNumber)
      .filter(poNumber => previousPoNumbers.has(poNumber));
    const finalByPo = new Map(previousOrders.map(order => [order.purchaseOrderNumber, order]));
    for (const order of latestOrders) finalByPo.set(order.purchaseOrderNumber, order);
    const finalOrders = [...finalByPo.values()];
    const skuCodes = new Set<string>();
    let totalQuantity = 0;
    for (const order of finalOrders) {
      for (const item of order.items) {
        skuCodes.add(item.productCode);
        totalQuantity += item.orderedQuantity;
      }
    }
    return {
      sourceFileName: latest.name,
      addedPurchaseOrderNumbers,
      skippedDuplicatePurchaseOrderNumbers,
      totalPurchaseOrders: finalOrders.length,
      totalSkuTypes: skuCodes.size,
      totalQuantity,
    };
  }

  const latest = await findLatestSourceFile();
  if (!latest) {
    throw new Error(`${SOURCE_DIR} 폴더에서 발주서리스트 ZIP/xlsx 파일을 찾지 못했습니다.`);
  }

  const [existingOrders, buffers] = await Promise.all([
    loadSupplierHubPurchaseOrders(),
    extractXlsxBuffers(latest.filePath),
  ]);
  const existingPoNumbers = new Set(existingOrders.map(order => order.purchaseOrderNumber));

  const addedPurchaseOrderNumbers: string[] = [];
  const skippedDuplicatePurchaseOrderNumbers: string[] = [];
  const now = new Date().toISOString();
  const incomingDir = getIncomingPurchaseOrdersDir();

  for (const { name, buffer } of buffers) {
    const parsed = await parseSupplierHubPurchaseOrderBuffer(buffer, name, now);
    if (!parsed || !parsed.purchaseOrderNumber) continue;

    if (existingPoNumbers.has(parsed.purchaseOrderNumber)) {
      skippedDuplicatePurchaseOrderNumbers.push(parsed.purchaseOrderNumber);
      continue;
    }

    const destFileName = `PO_${parsed.purchaseOrderNumber}.xlsx`;
    await writeFile(path.join(incomingDir, destFileName), buffer);
    existingPoNumbers.add(parsed.purchaseOrderNumber);
    addedPurchaseOrderNumbers.push(parsed.purchaseOrderNumber);
  }

  const finalOrders = await loadSupplierHubPurchaseOrders();
  const skuCodes = new Set<string>();
  let totalQuantity = 0;
  for (const order of finalOrders) {
    for (const item of order.items) {
      skuCodes.add(item.productCode);
      totalQuantity += item.orderedQuantity;
    }
  }

  return {
    sourceFileName: latest.fileName,
    addedPurchaseOrderNumbers,
    skippedDuplicatePurchaseOrderNumbers,
    totalPurchaseOrders: finalOrders.length,
    totalSkuTypes: skuCodes.size,
    totalQuantity,
  };
}
