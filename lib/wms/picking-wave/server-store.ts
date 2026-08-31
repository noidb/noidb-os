import { promises as fs } from "node:fs";
import path from "node:path";
import { BlobPreconditionFailedError, get, head, put } from "@vercel/blob";
import { basketKey, emptyPickingWaveStoreSnapshot, type PickingWaveStoreMutation, type PickingWaveStoreSnapshot } from "./shared-store-types";
import { mergePoConfirmationRecords, removeTransientPoConfirmationRecordsForWave } from "../po-confirm-state";

const BLOB_PATH = "noidb-wms/picking-waves/v1/store.json";
const MAX_RETRIES = 6;
const LOCAL_STORE_PATH = process.env.WMS_PICKING_WAVE_STORE_FILE || path.join(process.cwd(), ".secrets", "picking-wave-store.json");

type LoadedSnapshot = { snapshot: PickingWaveStoreSnapshot; etag?: string };
let localMutationQueue: Promise<unknown> = Promise.resolve();

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
    deletedWaveIds: raw.deletedWaveIds && typeof raw.deletedWaveIds === "object" ? raw.deletedWaveIds : {},
    deletedItemIds: raw.deletedItemIds && typeof raw.deletedItemIds === "object" ? raw.deletedItemIds : {},
    deletedBasketKeys: raw.deletedBasketKeys && typeof raw.deletedBasketKeys === "object" ? raw.deletedBasketKeys : {},
    deletedPoConfirmationNumbers: raw.deletedPoConfirmationNumbers && typeof raw.deletedPoConfirmationNumbers === "object" ? raw.deletedPoConfirmationNumbers : {},
    deletedVendorDraftIds: raw.deletedVendorDraftIds && typeof raw.deletedVendorDraftIds === "object" ? raw.deletedVendorDraftIds : {},
    deletedVendorLineIds: raw.deletedVendorLineIds && typeof raw.deletedVendorLineIds === "object" ? raw.deletedVendorLineIds : {},
    deletedWarehouseSkuIds: raw.deletedWarehouseSkuIds && typeof raw.deletedWarehouseSkuIds === "object" ? raw.deletedWarehouseSkuIds : {},
  };
}

function useBlobStore(): boolean {
  return Boolean(process.env.VERCEL || process.env.BLOB_READ_WRITE_TOKEN);
}

async function readBlobSnapshot(): Promise<LoadedSnapshot> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const result = await get(BLOB_PATH, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) return { snapshot: emptyPickingWaveStoreSnapshot() };
    const body = await new Response(result.stream).text();
    const metadata = await head(BLOB_PATH);
    if (result.blob.etag === metadata.etag) {
      return { snapshot: normalizeSnapshot(JSON.parse(body)), etag: metadata.etag };
    }
  }
  throw new Error("웨이브 공용 저장소의 최신 버전을 안정적으로 읽지 못했습니다.");
}

async function writeBlobSnapshot(snapshot: PickingWaveStoreSnapshot, etag?: string): Promise<void> {
  await put(BLOB_PATH, JSON.stringify(snapshot), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: Boolean(etag),
    contentType: "application/json",
    ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
  });
}

function isBlobWriteConflict(error: unknown): boolean {
  if (error instanceof BlobPreconditionFailedError) return true;
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown; name?: unknown; message?: unknown };
  const status = Number(candidate.status ?? candidate.statusCode);
  const code = String(candidate.code || "").toLowerCase();
  const name = String(candidate.name || "").toLowerCase();
  const message = String(candidate.message || "").toLowerCase();
  return status === 412
    || code.includes("precondition")
    || name.includes("precondition")
    || message.includes("etag mismatch")
    || message.includes("precondition failed");
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

function applyMutation(current: PickingWaveStoreSnapshot, mutation: PickingWaveStoreMutation): PickingWaveStoreSnapshot {
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
  } else if (mutation.action === "deleteItem") {
    next.deletedItemIds[mutation.itemId] = mutation.deletedAt;
    next.items = next.items.filter(value => value.id !== mutation.itemId);
  } else if (mutation.action === "saveBasket") {
    if (next.deletedWaveIds[mutation.basket.waveId]) throw new Error("삭제된 웨이브에는 바구니를 저장할 수 없습니다.");
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
      const next = applyMutation(snapshot, mutation);
      await writeLocalSnapshot(next);
      return next;
    });
    localMutationQueue = task.catch(() => undefined);
    return task;
  }
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const { snapshot, etag } = await readBlobSnapshot();
    const next = applyMutation(snapshot, mutation);
    try {
      await writeBlobSnapshot(next, etag);
      return next;
    } catch (error) {
      if (!isBlobWriteConflict(error) || attempt === MAX_RETRIES - 1) throw error;
    }
  }
  throw new Error("웨이브 공용 저장소 동시 저장 충돌을 해결하지 못했습니다.");
}
