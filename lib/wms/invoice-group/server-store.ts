import { promises as fs } from "node:fs";
import path from "node:path";
import { BlobPreconditionFailedError, get, put } from "@vercel/blob";
import {
  emptyInvoiceGroupStoreSnapshot,
  type InvoiceGroupStoreMutation,
  type InvoiceGroupStoreSnapshot,
} from "./shared-store-types";
import { missingInvoiceGroupDispatchRequirements, nextInvoiceGroupStage, type InvoiceGroup } from "./types";

/**
 * 발주묶음 전용 서버 저장소 (2026-09-18 신규). lib/wms/picking-wave/server-store.ts와 같은
 * 이중화 방식(로컬 개발: JSON 파일 / 배포: Vercel Blob + etag 낙관적 동시성)을 그대로 쓰지만,
 * 완전히 별도의 blob 경로·로컬 파일을 쓰는 독립 저장소다 — 웨이브 스토어가 삭제돼도 영향 없다.
 */

const BLOB_PATH = "noidb-wms/invoice-groups/v1/store.json";
const MAX_RETRIES = 6;
const LOCAL_STORE_PATH = process.env.WMS_INVOICE_GROUP_STORE_FILE || path.join(process.cwd(), ".secrets", "invoice-group-store.json");

type LoadedSnapshot = { snapshot: InvoiceGroupStoreSnapshot; etag?: string };
let localMutationQueue: Promise<unknown> = Promise.resolve();
let blobMutationQueue: Promise<unknown> = Promise.resolve();

function useBlobStore(): boolean {
  return Boolean(process.env.VERCEL || process.env.BLOB_READ_WRITE_TOKEN);
}

function normalizeSnapshot(value: unknown): InvoiceGroupStoreSnapshot {
  const raw = value && typeof value === "object" ? value as Partial<InvoiceGroupStoreSnapshot> : {};
  return {
    schemaVersion: 1,
    revision: Number.isInteger(raw.revision) ? Number(raw.revision) : 0,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
    groups: Array.isArray(raw.groups) ? raw.groups : [],
    deletedGroupIds: raw.deletedGroupIds && typeof raw.deletedGroupIds === "object" ? raw.deletedGroupIds : {},
    excludedPurchaseOrderNumbers: raw.excludedPurchaseOrderNumbers && typeof raw.excludedPurchaseOrderNumbers === "object" ? raw.excludedPurchaseOrderNumbers : {},
  };
}

function normalizeEtag(value: string): string {
  return value.trim().replace(/^W\//i, "").replace(/^"|"$/g, "");
}

function isForbiddenConsistentRead(error: unknown): boolean {
  if (!error || typeof error !== "object") return /403 forbidden/i.test(String(error));
  const candidate = error as { status?: unknown; statusCode?: unknown; message?: unknown };
  return Number(candidate.status ?? candidate.statusCode) === 403 || /403 forbidden/i.test(String(candidate.message || ""));
}

export function isBlobWriteConflict(error: unknown): boolean {
  if (error instanceof BlobPreconditionFailedError) return true;
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown; name?: unknown; message?: unknown };
  const status = Number(candidate.status ?? candidate.statusCode);
  const code = String(candidate.code || "").toLowerCase();
  const name = String(candidate.name || "").toLowerCase();
  const message = String(candidate.message || "").toLowerCase();
  return status === 409 || status === 412
    || code.includes("precondition")
    || name.includes("precondition")
    || message.includes("etag mismatch")
    || message.includes("precondition failed")
    || message.includes("conditional request");
}

export function isRateLimit(error: unknown): boolean {
  if (!error || typeof error !== "object") return /too many requests|rate.?limit|429/i.test(String(error));
  const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown; message?: unknown };
  return Number(candidate.status ?? candidate.statusCode) === 429 || /too many requests|rate.?limit|429/i.test(`${candidate.code || ""} ${candidate.message || ""}`);
}

export class InvoiceGroupStoreBusyError extends Error {
  constructor(message: string, public readonly retryAfterSeconds: number) { super(message); this.name = "InvoiceGroupStoreBusyError"; }
}

async function readBlobSnapshot(): Promise<LoadedSnapshot> {
  let result;
  try {
    result = await get(BLOB_PATH, { access: "private", useCache: false });
  } catch (error) {
    if (!isForbiddenConsistentRead(error)) throw error;
    result = await get(BLOB_PATH, { access: "private" });
  }
  if (!result || result.statusCode !== 200) return { snapshot: emptyInvoiceGroupStoreSnapshot() };
  const body = await new Response(result.stream).text();
  return { snapshot: normalizeSnapshot(JSON.parse(body)), etag: result.blob.etag };
}

async function writeBlobSnapshot(snapshot: InvoiceGroupStoreSnapshot, etag?: string): Promise<void> {
  const ifMatch = etag ? normalizeEtag(etag) : undefined;
  await put(BLOB_PATH, JSON.stringify(snapshot), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: Boolean(ifMatch),
    contentType: "application/json",
    ...(ifMatch ? { ifMatch } : { allowOverwrite: false }),
  });
}

async function readLocalSnapshot(): Promise<LoadedSnapshot> {
  try {
    return { snapshot: normalizeSnapshot(JSON.parse(await fs.readFile(LOCAL_STORE_PATH, "utf8"))) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { snapshot: emptyInvoiceGroupStoreSnapshot() };
    throw error;
  }
}

async function writeLocalSnapshot(snapshot: InvoiceGroupStoreSnapshot): Promise<void> {
  await fs.mkdir(path.dirname(LOCAL_STORE_PATH), { recursive: true });
  const temporaryPath = `${LOCAL_STORE_PATH}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(snapshot, null, 2), "utf8");
  await fs.rename(temporaryPath, LOCAL_STORE_PATH);
}

function wait(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }

function outputEvidenceChanged(existing: InvoiceGroup, incoming: InvoiceGroup): boolean {
  const evidence = (group: InvoiceGroup) => ({
    invoiceFileName: group.invoiceFileName || "",
    invoiceFilePath: group.invoiceFilePath || "",
    invoiceGeneratedAt: group.invoiceGeneratedAt || "",
    shipmentInvoiceNumbers: [...group.shipmentInvoiceNumbers]
      .map(entry => [entry.purchaseOrderNumber, entry.invoiceNumber] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
    shipmentFileName: group.shipmentFileName || "",
    shipmentFilePath: group.shipmentFilePath || "",
    shipmentFileGeneratedAt: group.shipmentFileGeneratedAt || "",
    shipmentRegisteredAt: group.shipmentRegisteredAt || "",
    shipmentNumbers: [...group.shipmentNumbers].map(value => value.trim()).sort(),
    barcodeFileName: group.barcodeFileName || "",
    barcodeFilePath: group.barcodeFilePath || "",
    barcodeGeneratedAt: group.barcodeGeneratedAt || "",
  });
  return JSON.stringify(evidence(existing)) !== JSON.stringify(evidence(incoming));
}

export function applyInvoiceGroupStoreMutation(current: InvoiceGroupStoreSnapshot, mutation: InvoiceGroupStoreMutation): InvoiceGroupStoreSnapshot {
  const next = normalizeSnapshot(structuredClone(current));
  if (mutation.action === "save") {
    const incoming = mutation.group as InvoiceGroup;
    const existing = next.groups.find(group => group.id === incoming.id);
    if (!existing && next.deletedGroupIds[incoming.id]) throw new Error("삭제된 발주묶음 ID는 다시 저장할 수 없습니다.");
    if (!existing && incoming.stage !== "new") throw new Error("새 발주묶음은 신규 단계로만 만들 수 있습니다.");
    if (existing) {
      if (Date.parse(incoming.updatedAt) < Date.parse(existing.updatedAt)) throw new Error("더 최신 발주묶음 기록이 있어 이전 저장 요청을 차단했습니다.");
      const samePurchaseOrderSet = incoming.purchaseOrderNumbers.length === existing.purchaseOrderNumbers.length
        && incoming.purchaseOrderNumbers.every(po => existing.purchaseOrderNumbers.includes(po));
      if (!samePurchaseOrderSet || incoming.expectedDate !== existing.expectedDate || incoming.fulfillmentCenter !== existing.fulfillmentCenter) {
        throw new Error("생성된 발주묶음의 발주번호·입고예정일·물류센터는 변경할 수 없습니다.");
      }
      if (existing.outputSetGeneratedAt && incoming.outputSetGeneratedAt === existing.outputSetGeneratedAt && outputEvidenceChanged(existing, incoming)) {
        throw new Error("쉽먼트·송장·바코드 증빙이 바뀌었으므로 기존 출력세트 기록을 유지할 수 없습니다. 출력세트를 다시 생성해 주세요.");
      }
      if (existing.stage === "dispatched" || existing.stage === "shipment_closed") {
        if (JSON.stringify(incoming) === JSON.stringify(existing)) return current;
        throw new Error("출고완료 또는 쉽먼트마감 발주묶음은 수정할 수 없습니다.");
      }
    }
    if (existing && incoming.stage !== existing.stage && incoming.stage !== nextInvoiceGroupStage(existing.stage)) {
      throw new Error("발주묶음 단계는 한 단계씩만 명시적으로 변경할 수 있습니다.");
    }
    if (incoming.stage === "shipment_closed") throw new Error("쉽먼트마감은 이 물류 흐름에서 자동 또는 저장 요청으로 처리할 수 없습니다.");
    if (existing && incoming.stage !== existing.stage && (incoming.stage === "shipment_completed" || incoming.stage === "dispatched")) {
      const missing = missingInvoiceGroupDispatchRequirements(incoming);
      if (missing.length) throw new Error(`출고 단계에 필요한 기록이 없습니다: ${missing.join(", ")}`);
    }
    const incomingPoNumbers = new Set(incoming.purchaseOrderNumbers);
    if (incomingPoNumbers.size !== incoming.purchaseOrderNumbers.length || !incomingPoNumbers.size) throw new Error("발주묶음의 발주번호가 비어 있거나 중복되었습니다.");
    const duplicate = next.groups.find(group => group.id !== incoming.id && !group.supersededByGroupId && group.purchaseOrderNumbers.some(po => incomingPoNumbers.has(po)));
    if (duplicate) throw new Error(`발주서가 이미 다른 발주묶음에 포함되어 있습니다: ${duplicate.purchaseOrderNumbers.filter(po => incomingPoNumbers.has(po)).join(", ")}`);
    delete next.deletedGroupIds[mutation.group.id];
    const index = next.groups.findIndex(group => group.id === mutation.group.id);
    if (index >= 0) next.groups[index] = mutation.group;
    else next.groups.push(mutation.group);
  } else if (mutation.action === "delete") {
    next.deletedGroupIds[mutation.id] = mutation.deletedAt;
    next.groups = next.groups.filter(group => group.id !== mutation.id);
  } else if (mutation.action === "excludePurchaseOrders") {
    for (const purchaseOrderNumber of mutation.purchaseOrderNumbers) next.excludedPurchaseOrderNumbers[purchaseOrderNumber] = mutation.excludedAt;
  }
  next.revision = current.revision + 1;
  next.updatedAt = new Date().toISOString();
  return next;
}

export async function readInvoiceGroupStore(): Promise<InvoiceGroupStoreSnapshot> {
  return (useBlobStore() ? readBlobSnapshot() : readLocalSnapshot()).then(result => result.snapshot);
}

export async function mutateInvoiceGroupStore(mutation: InvoiceGroupStoreMutation): Promise<InvoiceGroupStoreSnapshot> {
  if (!useBlobStore()) {
    const task = localMutationQueue.then(async () => {
      const { snapshot } = await readLocalSnapshot();
      const next = applyInvoiceGroupStoreMutation(snapshot, mutation);
      await writeLocalSnapshot(next);
      return next;
    });
    localMutationQueue = task.catch(() => undefined);
    return task;
  }
  const task = blobMutationQueue.then(async () => {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      try {
        const { snapshot, etag } = await readBlobSnapshot();
        const next = applyInvoiceGroupStoreMutation(snapshot, mutation);
        await writeBlobSnapshot(next, etag);
        return next;
      } catch (error) {
        if (isRateLimit(error)) {
          if (attempt === MAX_RETRIES - 1) throw error;
          await wait(Math.min(2_000, 250 * (2 ** attempt)) + Math.floor(Math.random() * 120));
          continue;
        }
        if (!isBlobWriteConflict(error) || attempt === MAX_RETRIES - 1) throw error;
        await wait(Math.min(1_000, 40 * (2 ** attempt)) + Math.floor(Math.random() * 80));
      }
    }
    throw new Error("발주묶음 저장소 동시 저장 충돌을 해결하지 못했습니다.");
  });
  blobMutationQueue = task.catch(() => undefined);
  return task;
}
