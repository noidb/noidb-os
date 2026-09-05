import { promises as fs } from "node:fs";
import path from "node:path";
import { BlobPreconditionFailedError, get, put } from "@vercel/blob";
import { basketKey, emptyPickingWaveStoreSnapshot, type PickingWaveStoreMutation, type PickingWaveStoreSnapshot } from "./shared-store-types";
import { mergePoConfirmationRecords, removeTransientPoConfirmationRecordsForWave } from "../po-confirm-state";
import { createShipmentsInState, deleteShipmentFromState, renameShipmentInState, updateShipmentGenerationInState, updateShipmentStatusInState } from "../shipment/state";
import type { Shipment } from "../shipment/types";

const BLOB_PATH = "noidb-wms/picking-waves/v1/store.json";
const MAX_RETRIES = 6;
const LOCAL_STORE_PATH = process.env.WMS_PICKING_WAVE_STORE_FILE || path.join(process.cwd(), ".secrets", "picking-wave-store.json");

type LoadedSnapshot = { snapshot: PickingWaveStoreSnapshot; etag?: string };
let localMutationQueue: Promise<unknown> = Promise.resolve();
let blobMutationQueue: Promise<unknown> = Promise.resolve();

export interface PickingWaveStoreIoStats {
  blobGets: number;
  blobHeads: number;
  blobPuts: number;
  conflicts: number;
  rateLimits: number;
  retries: number;
}
const ioStats: PickingWaveStoreIoStats = { blobGets: 0, blobHeads: 0, blobPuts: 0, conflicts: 0, rateLimits: 0, retries: 0 };
export function resetPickingWaveStoreIoStats(): void { Object.assign(ioStats, { blobGets: 0, blobHeads: 0, blobPuts: 0, conflicts: 0, rateLimits: 0, retries: 0 }); }
export function getPickingWaveStoreIoStats(): PickingWaveStoreIoStats { return { ...ioStats }; }

export function normalizeEtag(value: string): string {
  return value.trim().replace(/^W\//i, "").replace(/^\"|\"$/g, "");
}

function recordTime(value: { updatedAt?: string; createdAt?: string }): string {
  return value.updatedAt || value.createdAt || new Date(0).toISOString();
}

function newer<T extends { updatedAt?: string; createdAt?: string }>(existing: T | undefined, incoming: T): T {
  if (!existing) return incoming;
  return recordTime(incoming).localeCompare(recordTime(existing)) > 0 ? incoming : existing;
}

function mergeByKey<T extends { updatedAt?: string; createdAt?: string }>(
  existing: readonly T[], incoming: readonly T[], keyOf: (value: T) => string, deleted: Record<string, string>, allowResurrection: boolean
): T[] {
  const merged = new Map(existing.map(value => [keyOf(value), value]));
  for (const value of incoming) {
    const key = keyOf(value);
    if (!key || (!allowResurrection && deleted[key])) continue;
    merged.set(key, newer(merged.get(key), value));
    if (allowResurrection) delete deleted[key];
  }
  return [...merged.values()];
}

function normalizeSnapshot(value: unknown): PickingWaveStoreSnapshot {
  const raw = value && typeof value === "object" ? value as Partial<PickingWaveStoreSnapshot> : {};
  return {
    schemaVersion: 1,
    revision: Number.isInteger(raw.revision) ? Number(raw.revision) : 0,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
    waves: Array.isArray(raw.waves) ? raw.waves : [],
    items: Array.isArray(raw.items) ? raw.items : [],
    baskets: Array.isArray(raw.baskets) ? raw.baskets : [],
    poConfirmationRecords: Array.isArray(raw.poConfirmationRecords) ? raw.poConfirmationRecords : [],
    vendorOrderDrafts: Array.isArray(raw.vendorOrderDrafts) ? raw.vendorOrderDrafts : [],
    vendorOrderLines: Array.isArray(raw.vendorOrderLines) ? raw.vendorOrderLines : [],
    warehouseZones: Array.isArray(raw.warehouseZones) ? raw.warehouseZones : [],
    warehouseShelves: Array.isArray(raw.warehouseShelves) ? raw.warehouseShelves : [],
    warehouseBoxes: Array.isArray(raw.warehouseBoxes) ? raw.warehouseBoxes : [],
    warehouseModelLocations: Array.isArray(raw.warehouseModelLocations) ? raw.warehouseModelLocations : [],
    warehouseSkuExceptions: Array.isArray(raw.warehouseSkuExceptions) ? raw.warehouseSkuExceptions : [],
    warehouseMigrationMappings: Array.isArray(raw.warehouseMigrationMappings) ? raw.warehouseMigrationMappings : [],
    shipments: Array.isArray(raw.shipments) ? raw.shipments : [],
    deletedWaveIds: raw.deletedWaveIds && typeof raw.deletedWaveIds === "object" ? raw.deletedWaveIds : {},
    deletedItemIds: raw.deletedItemIds && typeof raw.deletedItemIds === "object" ? raw.deletedItemIds : {},
    deletedBasketKeys: raw.deletedBasketKeys && typeof raw.deletedBasketKeys === "object" ? raw.deletedBasketKeys : {},
    deletedPoConfirmationNumbers: raw.deletedPoConfirmationNumbers && typeof raw.deletedPoConfirmationNumbers === "object" ? raw.deletedPoConfirmationNumbers : {},
    deletedVendorDraftIds: raw.deletedVendorDraftIds && typeof raw.deletedVendorDraftIds === "object" ? raw.deletedVendorDraftIds : {},
    deletedVendorLineIds: raw.deletedVendorLineIds && typeof raw.deletedVendorLineIds === "object" ? raw.deletedVendorLineIds : {},
    deletedWarehouseSkuIds: raw.deletedWarehouseSkuIds && typeof raw.deletedWarehouseSkuIds === "object" ? raw.deletedWarehouseSkuIds : {},
    deletedShipmentIds: raw.deletedShipmentIds && typeof raw.deletedShipmentIds === "object" ? raw.deletedShipmentIds : {},
    completedCreateOperations: raw.completedCreateOperations && typeof raw.completedCreateOperations === "object" ? raw.completedCreateOperations : {},
    completedShipmentCreateOperations: raw.completedShipmentCreateOperations && typeof raw.completedShipmentCreateOperations === "object" ? raw.completedShipmentCreateOperations : {},
  };
}

function mergeShipmentMigration(existing: Shipment[], incoming: readonly Shipment[], deleted: Record<string, string>): Shipment[] {
  const merged = new Map(existing.map(shipment => [shipment.id, shipment]));
  const assigned = new Map(existing.flatMap(shipment => shipment.purchaseOrders.map(order => [order.purchaseOrderNumber, shipment.id] as const)));
  for (const shipment of [...incoming].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (!shipment.id || deleted[shipment.id]) continue;
    const current = merged.get(shipment.id);
    if (current) {
      if (recordTime(shipment).localeCompare(recordTime(current)) > 0) merged.set(shipment.id, shipment);
      continue;
    }
    if (shipment.purchaseOrders.some(order => assigned.has(order.purchaseOrderNumber))) continue;
    merged.set(shipment.id, shipment);
    for (const order of shipment.purchaseOrders) assigned.set(order.purchaseOrderNumber, shipment.id);
  }
  return [...merged.values()];
}

function useBlobStore(): boolean {
  return Boolean(process.env.VERCEL || process.env.BLOB_READ_WRITE_TOKEN);
}

async function readBlobSnapshot(): Promise<LoadedSnapshot> {
  ioStats.blobGets += 1;
  let result;
  try {
    result = await get(BLOB_PATH, { access: "private", useCache: false });
  } catch (error) {
    if (!isForbiddenConsistentRead(error)) throw error;
    ioStats.blobGets += 1;
    result = await get(BLOB_PATH, { access: "private" });
  }
  if (!result || result.statusCode !== 200) return { snapshot: emptyPickingWaveStoreSnapshot() };
  const body = await new Response(result.stream).text();
  return { snapshot: normalizeSnapshot(JSON.parse(body)), etag: result.blob.etag };
}

async function writeBlobSnapshot(snapshot: PickingWaveStoreSnapshot, etag?: string): Promise<void> {
  const ifMatch = etag ? normalizeEtag(etag) : undefined;
  ioStats.blobPuts += 1;
  await put(BLOB_PATH, JSON.stringify(snapshot), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: Boolean(ifMatch),
    contentType: "application/json",
    ...(ifMatch ? { ifMatch } : { allowOverwrite: false }),
  });
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
    || message.includes("conflicting operation")
    || message.includes("conditional request");
}

export function isRateLimit(error: unknown): boolean {
  if (!error || typeof error !== "object") return /too many requests|rate.?limit|429/i.test(String(error));
  const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown; message?: unknown };
  return Number(candidate.status ?? candidate.statusCode) === 429 || /too many requests|rate.?limit|429/i.test(`${candidate.code || ""} ${candidate.message || ""}`);
}

function isForbiddenConsistentRead(error: unknown): boolean {
  if (!error || typeof error !== "object") return /403 forbidden/i.test(String(error));
  const candidate = error as { status?: unknown; statusCode?: unknown; message?: unknown };
  return Number(candidate.status ?? candidate.statusCode) === 403 || /403 forbidden/i.test(String(candidate.message || ""));
}

export function retryAfterMs(error: unknown): number | null {
  const candidate = error && typeof error === "object" ? error as { retryAfter?: unknown; message?: unknown } : {};
  const direct = Number(candidate.retryAfter);
  if (Number.isFinite(direct) && direct > 0) return direct > 1000 ? direct : direct * 1000;
  const match = String(candidate.message || error || "").match(/(?:try again in|retry after)\s+(\d+)\s*seconds?/i);
  return match ? Number(match[1]) * 1000 : null;
}

function wait(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }

export class PickingWaveStoreBusyError extends Error {
  constructor(message: string, public readonly retryAfterSeconds: number) { super(message); this.name = "PickingWaveStoreBusyError"; }
}

async function readLocalSnapshot(): Promise<LoadedSnapshot> {
  try {
    return { snapshot: normalizeSnapshot(JSON.parse(await fs.readFile(LOCAL_STORE_PATH, "utf8"))) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { snapshot: emptyPickingWaveStoreSnapshot() };
    throw error;
  }
}

async function writeLocalSnapshot(snapshot: PickingWaveStoreSnapshot): Promise<void> {
  await fs.mkdir(path.dirname(LOCAL_STORE_PATH), { recursive: true });
  const temporaryPath = `${LOCAL_STORE_PATH}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(snapshot, null, 2), "utf8");
  await fs.rename(temporaryPath, LOCAL_STORE_PATH);
}

export function applyPickingWaveStoreMutation(current: PickingWaveStoreSnapshot, mutation: PickingWaveStoreMutation): PickingWaveStoreSnapshot {
  const next = normalizeSnapshot(structuredClone(current));
  if (mutation.action === "migrate") {
    next.waves = mergeByKey(next.waves, mutation.snapshot.waves || [], value => value.id, next.deletedWaveIds, false);
    next.items = mergeByKey(next.items, mutation.snapshot.items || [], value => value.id, next.deletedItemIds, false)
      .filter(item => !next.deletedWaveIds[item.waveId]);
    next.baskets = mergeByKey(next.baskets, mutation.snapshot.baskets || [], value => basketKey(value.waveId, value.basketNumber), next.deletedBasketKeys, false)
      .filter(basket => !next.deletedWaveIds[basket.waveId]);
    const incomingPoRecords = (mutation.snapshot.poConfirmationRecords || []).filter(record => !next.deletedPoConfirmationNumbers[record.poNumber]);
    next.poConfirmationRecords = mergePoConfirmationRecords(next.poConfirmationRecords, incomingPoRecords);
    next.vendorOrderDrafts = mergeByKey(next.vendorOrderDrafts, mutation.snapshot.vendorOrderDrafts || [], value => value.id, next.deletedVendorDraftIds, false);
    next.vendorOrderLines = mergeByKey(next.vendorOrderLines, mutation.snapshot.vendorOrderLines || [], value => value.id, next.deletedVendorLineIds, false)
      .filter(line => !next.deletedVendorDraftIds[line.draftId]);
    next.warehouseZones = mergeByKey(next.warehouseZones, mutation.snapshot.warehouseZones || [], value => value.id, {}, false);
    next.warehouseShelves = mergeByKey(next.warehouseShelves, mutation.snapshot.warehouseShelves || [], value => value.id, {}, false);
    next.warehouseBoxes = mergeByKey(next.warehouseBoxes, mutation.snapshot.warehouseBoxes || [], value => value.id, {}, false);
    next.warehouseModelLocations = mergeByKey(next.warehouseModelLocations, mutation.snapshot.warehouseModelLocations || [], value => value.modelName, {}, false);
    next.warehouseSkuExceptions = mergeByKey(next.warehouseSkuExceptions, mutation.snapshot.warehouseSkuExceptions || [], value => value.skuId, next.deletedWarehouseSkuIds, false);
    next.warehouseMigrationMappings = mergeByKey(next.warehouseMigrationMappings, mutation.snapshot.warehouseMigrationMappings || [], value => value.id, {}, false);
  } else if (mutation.action === "saveWave") {
    next.waves = mergeByKey(next.waves, [mutation.wave], value => value.id, next.deletedWaveIds, true);
  } else if (mutation.action === "deleteWave") {
    next.deletedWaveIds[mutation.waveId] = mutation.deletedAt;
    next.waves = next.waves.filter(value => value.id !== mutation.waveId);
    next.items = next.items.filter(value => value.waveId !== mutation.waveId);
    next.baskets = next.baskets.filter(value => value.waveId !== mutation.waveId);
    for (const record of next.poConfirmationRecords) {
      if (record.waveId === mutation.waveId && record.stage !== "confirmed") next.deletedPoConfirmationNumbers[record.poNumber] = mutation.deletedAt;
    }
    next.poConfirmationRecords = removeTransientPoConfirmationRecordsForWave(next.poConfirmationRecords, mutation.waveId);
    for (const draft of next.vendorOrderDrafts.filter(value => value.waveId === mutation.waveId)) {
      next.deletedVendorDraftIds[draft.id] = mutation.deletedAt;
    }
    for (const line of next.vendorOrderLines.filter(value => value.waveId === mutation.waveId)) {
      next.deletedVendorLineIds[line.id] = mutation.deletedAt;
    }
    next.vendorOrderDrafts = next.vendorOrderDrafts.filter(value => value.waveId !== mutation.waveId);
    next.vendorOrderLines = next.vendorOrderLines.filter(value => value.waveId !== mutation.waveId);
  } else if (mutation.action === "saveItem") {
    if (next.deletedWaveIds[mutation.item.waveId]) throw new Error("삭제된 웨이브에는 피킹 아이템을 저장할 수 없습니다.");
    next.items = mergeByKey(next.items, [mutation.item], value => value.id, next.deletedItemIds, true);
  } else if (mutation.action === "saveProgress") {
    if (next.deletedWaveIds[mutation.wave.id]) throw new Error("삭제된 웨이브에는 피킹 진행상태를 저장할 수 없습니다.");
    if (mutation.items.some(item => item.waveId !== mutation.wave.id)) throw new Error("다른 웨이브의 피킹 아이템이 섞여 있습니다.");
    next.items = mergeByKey(next.items, mutation.items, value => value.id, next.deletedItemIds, true);
    next.waves = mergeByKey(next.waves, [mutation.wave], value => value.id, next.deletedWaveIds, true);
  } else if (mutation.action === "createWaveBatch") {
    if (next.completedCreateOperations[mutation.operationId]) return current;
    if (mutation.items.some(item => item.waveId !== mutation.wave.id) || mutation.baskets.some(basket => basket.waveId !== mutation.wave.id)) {
      throw new Error("신규 웨이브 batch에 다른 웨이브 데이터가 섞여 있습니다.");
    }
    if (next.waves.some(value => value.id === mutation.wave.id)) throw new Error("같은 웨이브 ID가 이미 존재합니다.");
    next.waves = mergeByKey(next.waves, [mutation.wave], value => value.id, next.deletedWaveIds, true);
    next.items = mergeByKey(next.items, mutation.items, value => value.id, next.deletedItemIds, true);
    next.baskets = mergeByKey(next.baskets, mutation.baskets, value => basketKey(value.waveId, value.basketNumber), next.deletedBasketKeys, true);
    next.completedCreateOperations[mutation.operationId] = { waveId: mutation.wave.id, completedAt: new Date().toISOString() };
  } else if (mutation.action === "deleteItem") {
    next.deletedItemIds[mutation.itemId] = mutation.deletedAt;
    next.items = next.items.filter(value => value.id !== mutation.itemId);
  } else if (mutation.action === "saveBasket") {
    if (next.deletedWaveIds[mutation.basket.waveId]) throw new Error("삭제된 웨이브에는 발주서 배정을 저장할 수 없습니다.");
    next.baskets = mergeByKey(next.baskets, [mutation.basket], value => basketKey(value.waveId, value.basketNumber), next.deletedBasketKeys, true);
  } else if (mutation.action === "deleteBasket") {
    const key = basketKey(mutation.waveId, mutation.basketNumber);
    next.deletedBasketKeys[key] = mutation.deletedAt;
    next.baskets = next.baskets.filter(value => basketKey(value.waveId, value.basketNumber) !== key);
  } else if (mutation.action === "upsertPoConfirmationRecords") {
    for (const record of mutation.records) delete next.deletedPoConfirmationNumbers[record.poNumber];
    next.poConfirmationRecords = mergePoConfirmationRecords(next.poConfirmationRecords, mutation.records);
  } else if (mutation.action === "clearPoConfirmationErrors") {
    const targets = new Set(mutation.poNumbers.map(value => value.trim()).filter(Boolean));
    next.poConfirmationRecords = next.poConfirmationRecords.filter(record => {
      const remove = record.stage === "error" && targets.has(record.poNumber) && (!mutation.waveId || record.waveId === mutation.waveId);
      if (remove) next.deletedPoConfirmationNumbers[record.poNumber] = mutation.deletedAt;
      return !remove;
    });
  } else if (mutation.action === "saveVendorDraft") {
    next.vendorOrderDrafts = mergeByKey(next.vendorOrderDrafts, [mutation.draft], value => value.id, next.deletedVendorDraftIds, true);
  } else if (mutation.action === "deleteVendorDraft") {
    next.deletedVendorDraftIds[mutation.draftId] = mutation.deletedAt;
    for (const line of next.vendorOrderLines.filter(value => value.draftId === mutation.draftId)) next.deletedVendorLineIds[line.id] = mutation.deletedAt;
    next.vendorOrderDrafts = next.vendorOrderDrafts.filter(value => value.id !== mutation.draftId);
    next.vendorOrderLines = next.vendorOrderLines.filter(value => value.draftId !== mutation.draftId);
  } else if (mutation.action === "saveVendorLine") {
    if (next.deletedVendorDraftIds[mutation.line.draftId]) throw new Error("삭제된 거래처 발주서에는 라인을 저장할 수 없습니다.");
    next.vendorOrderLines = mergeByKey(next.vendorOrderLines, [mutation.line], value => value.id, next.deletedVendorLineIds, true);
  } else if (mutation.action === "deleteVendorLine") {
    next.deletedVendorLineIds[mutation.lineId] = mutation.deletedAt;
    next.vendorOrderLines = next.vendorOrderLines.filter(value => value.id !== mutation.lineId);
  } else if (mutation.action === "saveWarehouseZone") {
    next.warehouseZones = mergeByKey(next.warehouseZones, [mutation.zone], value => value.id, {}, true);
  } else if (mutation.action === "saveWarehouseShelf") {
    next.warehouseShelves = mergeByKey(next.warehouseShelves, [mutation.shelf], value => value.id, {}, true);
  } else if (mutation.action === "saveWarehouseBox") {
    next.warehouseBoxes = mergeByKey(next.warehouseBoxes, [mutation.box], value => value.id, {}, true);
  } else if (mutation.action === "saveWarehouseModelLocation") {
    next.warehouseModelLocations = mergeByKey(next.warehouseModelLocations, [mutation.location], value => value.modelName, {}, true);
  } else if (mutation.action === "saveWarehouseSkuException") {
    next.warehouseSkuExceptions = mergeByKey(next.warehouseSkuExceptions, [mutation.exception], value => value.skuId, next.deletedWarehouseSkuIds, true);
  } else if (mutation.action === "deleteWarehouseSkuException") {
    next.deletedWarehouseSkuIds[mutation.skuId] = mutation.deletedAt;
    next.warehouseSkuExceptions = next.warehouseSkuExceptions.filter(value => value.skuId !== mutation.skuId);
  } else if (mutation.action === "saveWarehouseMigrationMapping") {
    next.warehouseMigrationMappings = mergeByKey(next.warehouseMigrationMappings, [mutation.mapping], value => value.id, {}, true);
  } else if (mutation.action === "migrateShipments") {
    next.shipments = mergeShipmentMigration(next.shipments, mutation.shipments, next.deletedShipmentIds);
  } else if (mutation.action === "createShipments") {
    if (next.completedShipmentCreateOperations[mutation.operationId]) return current;
    const result = createShipmentsInState(next.shipments, mutation.previews, mutation.now);
    next.shipments = result.all;
    next.completedShipmentCreateOperations[mutation.operationId] = { shipmentIds: result.created.map(shipment => shipment.id), completedAt: mutation.now };
  } else if (mutation.action === "renameShipment") {
    next.shipments = renameShipmentInState(next.shipments, mutation.shipmentId, mutation.name, mutation.now).all;
  } else if (mutation.action === "updateShipmentStatus") {
    next.shipments = updateShipmentStatusInState(next.shipments, mutation.shipmentId, mutation.status, mutation.now).all;
  } else if (mutation.action === "updateShipmentGeneration") {
    next.shipments = updateShipmentGenerationInState(next.shipments, mutation.shipmentId, mutation.generation, mutation.now).all;
  } else if (mutation.action === "deleteShipment") {
    next.shipments = deleteShipmentFromState(next.shipments, mutation.shipmentId);
    next.deletedShipmentIds[mutation.shipmentId] = mutation.deletedAt;
  }
  next.revision = current.revision + 1;
  next.updatedAt = new Date().toISOString();
  return next;
}

export async function readPickingWaveStore(): Promise<PickingWaveStoreSnapshot> {
  return (useBlobStore() ? readBlobSnapshot() : readLocalSnapshot()).then(result => result.snapshot);
}

export async function mutatePickingWaveStore(mutation: PickingWaveStoreMutation): Promise<PickingWaveStoreSnapshot> {
  if (!useBlobStore()) {
    const task = localMutationQueue.then(async () => {
      const { snapshot } = await readLocalSnapshot();
      const next = applyPickingWaveStoreMutation(snapshot, mutation);
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
        if (mutation.action === "createWaveBatch" && snapshot.completedCreateOperations[mutation.operationId]) return snapshot;
        const next = applyPickingWaveStoreMutation(snapshot, mutation);
        await writeBlobSnapshot(next, etag);
        return next;
      } catch (error) {
        if (isRateLimit(error)) {
          ioStats.rateLimits += 1;
          const requestedDelay = retryAfterMs(error);
          if (requestedDelay && requestedDelay > 5_000) throw new PickingWaveStoreBusyError("저장 서버가 잠시 혼잡합니다.", Math.ceil(requestedDelay / 1000));
          if (attempt === MAX_RETRIES - 1) throw error;
          ioStats.retries += 1;
          await wait(requestedDelay || Math.min(2_000, 250 * (2 ** attempt)) + Math.floor(Math.random() * 120));
          continue;
        }
        if (!isBlobWriteConflict(error) || attempt === MAX_RETRIES - 1) throw error;
        ioStats.conflicts += 1;
        ioStats.retries += 1;
        await wait(Math.min(1_000, 40 * (2 ** attempt)) + Math.floor(Math.random() * 80));
      }
    }
    throw new Error("웨이브 공용 저장소 동시 저장 충돌을 해결하지 못했습니다.");
  });
  blobMutationQueue = task.catch(() => undefined);
  return task;
}
