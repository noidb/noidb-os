import { createHash } from "node:crypto";
import { downloadOAuthDriveFile, listOAuthDriveFolderFiles, resolveDriveFolderPath, type OAuthDriveFileInfo } from "./google-drive-oauth-reader";
import { createParsedFileCache } from "./parsed-file-cache";
import { parseWeeklyPurchaseFile, resolveWeeklyPurchaseDocuments, type WeeklyPurchaseParseResult, type WeeklyPurchaseResolution } from "./weekly-purchase-files";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const clean = (value: unknown) => String(value ?? "").trim();
const pair = (po: string, sku: string) => JSON.stringify([po, sku]);
// Analysis only: never persist parsed source files or import historical orders.
const cached = createParsedFileCache({ read: async () => null, write: async () => undefined });
const valid = (value: unknown): value is WeeklyPurchaseParseResult => Boolean(value && typeof value === "object"
  && Array.isArray((value as WeeklyPurchaseParseResult).documents) && Array.isArray((value as WeeklyPurchaseParseResult).errors));

export interface WeeklyPurchaseManifest { folderId: string; files: OAuthDriveFileInfo[]; token: string }
export function weeklyPurchaseManifestToken(files: OAuthDriveFileInfo[]): string {
  return hash(files.map(file => [file.id, file.name, file.modifiedTime, file.size]).sort((a, b) => a[0].localeCompare(b[0])));
}
export async function readWeeklyPurchaseManifest(): Promise<WeeklyPurchaseManifest> {
  const folderId = await resolveDriveFolderPath(["쿠팡데이터", "발주서리스트다운"]);
  const files = (await listOAuthDriveFolderFiles(folderId)).filter(file => /\.(zip|xlsx)$/i.test(file.name) && !file.name.startsWith("~$"));
  return { folderId, files, token: weeklyPurchaseManifestToken(files) };
}
export function weeklyOperationsWithPurchaseFiles(operations: string, fileToken: string): string {
  return hash(["weekly-purchase-files-v1", operations, fileToken]);
}
export async function readWeeklyPurchaseFiles(manifest: WeeklyPurchaseManifest, targetPos: string[]): Promise<WeeklyPurchaseResolution> {
  const parsed: WeeklyPurchaseParseResult[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, manifest.files.length) }, async () => {
    while (next < manifest.files.length) {
      const file = manifest.files[next++];
      try {
        parsed.push(await cached("weekly-purchase-file-v1", [file.id, file.name, file.modifiedTime, file.size], async () => {
          const buffer = await downloadOAuthDriveFile(file.id);
          const value = await parseWeeklyPurchaseFile(buffer, file);
          return { value, contentHash: createHash("sha256").update(buffer).digest("hex"), purchaseOrders: value.documents.map(item => item.purchaseOrderNumber) };
        }, valid));
      } catch {
        parsed.push({ documents: [], errors: [{ code: "DOWNLOAD_FAILED", message: "발주서 원문을 읽지 못했습니다.",
          sourceFile: file.name, sourceModifiedTime: file.modifiedTime, sourceId: file.id }] });
      }
    }
  }));
  const after = (await listOAuthDriveFolderFiles(manifest.folderId)).filter(file => /\.(zip|xlsx)$/i.test(file.name) && !file.name.startsWith("~$"));
  if (weeklyPurchaseManifestToken(after) !== manifest.token) throw new Error("확인 중 발주서 파일이 변경됐습니다. 업로드가 끝난 뒤 다시 확인해 주세요.");
  return resolveWeeklyPurchaseDocuments(parsed, targetPos);
}

/** Supplement a read model, preserving every original ledger row and explicit zero. */
export function mergeWeeklyPurchaseRows(history: string[][], source: WeeklyPurchaseResolution): { rows: string[][]; addedCount: number } {
  const required = ["발주번호", "SKU ID", "상품명", "발주수량", "확정수량", "발주현황", "_주간원문입고수량", "_주간원문검증오류"];
  const headers = (history[0] || []).map(clean);
  if (new Set(headers).size !== headers.length) throw new Error("발주이력에 중복된 열이 있어 원문 연결을 확인할 수 없습니다.");
  if (history.length > 1 && ["발주번호", "SKU ID"].some(header => !headers.includes(header))) throw new Error("발주이력의 발주번호·SKU 열을 확인할 수 없습니다.");
  const allHeaders = [...headers, ...required.filter(header => !headers.includes(header))];
  const records = history.slice(1).map(row => Object.fromEntries(allHeaders.map((header, index) => [header, index < headers.length ? clean(row[index]) : ""])));
  const sourceByPair = new Map(source.resolvedRows.map(row => [pair(row.purchaseOrderNumber, row.skuId), row]));
  const sourcePos = new Set(source.resolvedRows.map(row => row.purchaseOrderNumber));
  const errorsByPo = new Map<string, string[]>();
  for (const error of source.errors) if (error.purchaseOrderNumber) errorsByPo.set(error.purchaseOrderNumber,
    [...(errorsByPo.get(error.purchaseOrderNumber) || []), `${error.sourceFile}: ${error.message}`]);
  const found = new Set<string>();
  for (const row of records) {
    const po = row["발주번호"], sku = row["SKU ID"], key = pair(po, sku), original = sourceByPair.get(key);
    found.add(key);
    const issues = [...(errorsByPo.get(po) || [])];
    if (original) {
      if (original.receivedQuantity === null) issues.push("발주서 원문의 입고수량이 비어 있어 실제 누적 입고를 검산할 수 없습니다.");
      const legacyConfirmed = clean(row["확정수량"]) === "" ? clean(row["발주수량"]) : clean(row["확정수량"]);
      if (!/^\d+$/.test(legacyConfirmed.replace(/,/g, "")) || Number(legacyConfirmed.replace(/,/g, "")) !== original.confirmedQuantity) {
        issues.push("발주이력과 최신 발주서의 확정수량이 달라 미납 여부를 확정할 수 없습니다.");
      }
      row["_주간원문입고수량"] = original.receivedQuantity === null ? "" : String(original.receivedQuantity);
    } else if (sourcePos.has(po)) issues.push("최신 발주서에 해당 SKU가 없어 미납 여부를 확정할 수 없습니다.");
    row["_주간원문검증오류"] = [...new Set([row["_주간원문검증오류"], ...issues].filter(Boolean))].sort().join(" ");
  }
  let addedCount = 0;
  for (const original of source.resolvedRows) {
    if (found.has(pair(original.purchaseOrderNumber, original.skuId))) continue;
    if (original.confirmedQuantity === null) continue;
    records.push({ ...Object.fromEntries(allHeaders.map(header => [header, ""])),
      "발주번호": original.purchaseOrderNumber, "SKU ID": original.skuId,
      "상품명": [original.productName, original.optionName].filter(Boolean).join(", "),
      "발주수량": String(original.orderedQuantity), "확정수량": String(original.confirmedQuantity),
      "_주간원문입고수량": original.receivedQuantity === null ? "" : String(original.receivedQuantity),
      "_주간원문검증오류": [...new Set([...(errorsByPo.get(original.purchaseOrderNumber) || []),
        ...(original.receivedQuantity === null ? ["발주서 원문의 입고수량이 비어 있어 실제 누적 입고를 검산할 수 없습니다."] : [])])].sort().join(" ") });
    addedCount++;
  }
  return { rows: [allHeaders, ...records.map(row => allHeaders.map(header => row[header] || ""))], addedCount };
}
