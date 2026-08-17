import type {
  WarehouseZone,
  Shelf,
  WarehouseBox,
  ModelLocation,
  SkuLocation,
  WarehouseMigrationMapping,
} from "@/lib/wms/types";
import type { WarehouseRepository } from "./repository";
import { DEFAULT_ZONES, SAMPLE_CATALOG } from "./sample-data";

/**
 * localStorage 기반 임시 저장소. 실제 구글시트 연동 전까지 화면 검증용으로 사용한다.
 * 키는 전부 noidb_warehouse_ 접두어를 써서 다른 기능(WMS 피킹 등)의 저장 공간과 겹치지 않게 한다.
 */

const KEYS = {
  zones: "noidb_warehouse_zones",
  shelves: "noidb_warehouse_shelves",
  boxes: "noidb_warehouse_boxes",
  modelLocations: "noidb_warehouse_model_locations",
  skuExceptions: "noidb_warehouse_sku_exceptions",
  migrationMappings: "noidb_warehouse_migration_mappings",
  seeded: "noidb_warehouse_seeded_v1",
} as const;

function nowIso(): string {
  return new Date().toISOString();
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readList<T>(key: string): T[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeList<T>(key: string, list: T[]): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(key, JSON.stringify(list));
}

function buildSeedMigrationMappings(): WarehouseMigrationMapping[] {
  const grouped = new Map<string, { models: Set<string>; skus: Set<string> }>();
  for (const item of SAMPLE_CATALOG) {
    const entry = grouped.get(item.legacyLocation) || { models: new Set<string>(), skus: new Set<string>() };
    entry.models.add(item.modelName);
    entry.skus.add(item.skuId);
    grouped.set(item.legacyLocation, entry);
  }
  const timestamp = nowIso();
  return [...grouped.entries()].map(([legacyLocation, entry], index) => ({
    id: `MIG-${index + 1}`,
    legacyLocation,
    connectedModelCount: entry.models.size,
    connectedSkuCount: entry.skus.size,
    status: "unverified" as const,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
}

function ensureSeeded(): void {
  if (!isBrowser()) return;
  if (window.localStorage.getItem(KEYS.seeded)) return;

  const timestamp = nowIso();
  const zones: WarehouseZone[] = DEFAULT_ZONES.map(zone => ({ ...zone, createdAt: timestamp, updatedAt: timestamp }));
  writeList(KEYS.zones, zones);
  writeList<Shelf>(KEYS.shelves, []);
  writeList<WarehouseBox>(KEYS.boxes, []);
  writeList<ModelLocation>(KEYS.modelLocations, []);
  writeList<SkuLocation>(KEYS.skuExceptions, []);
  writeList<WarehouseMigrationMapping>(KEYS.migrationMappings, buildSeedMigrationMappings());
  window.localStorage.setItem(KEYS.seeded, "1");
}

export class LocalWarehouseRepository implements WarehouseRepository {
  constructor() {
    ensureSeeded();
  }

  async listZones(): Promise<WarehouseZone[]> {
    return readList<WarehouseZone>(KEYS.zones).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async saveZone(zone: WarehouseZone): Promise<void> {
    const list = readList<WarehouseZone>(KEYS.zones);
    const index = list.findIndex(item => item.id === zone.id);
    const timestamp = nowIso();
    const next = { ...zone, updatedAt: timestamp, createdAt: zone.createdAt || timestamp };
    if (index >= 0) list[index] = next;
    else list.push(next);
    writeList(KEYS.zones, list);
  }

  async listShelves(): Promise<Shelf[]> {
    return readList<Shelf>(KEYS.shelves).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async saveShelf(shelf: Shelf): Promise<void> {
    const list = readList<Shelf>(KEYS.shelves);
    const index = list.findIndex(item => item.id === shelf.id);
    const timestamp = nowIso();
    const next = { ...shelf, updatedAt: timestamp, createdAt: shelf.createdAt || timestamp };
    if (index >= 0) list[index] = next;
    else list.push(next);
    writeList(KEYS.shelves, list);
  }

  async listBoxes(): Promise<WarehouseBox[]> {
    return readList<WarehouseBox>(KEYS.boxes).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  }

  async getBox(boxId: string): Promise<WarehouseBox | null> {
    const list = readList<WarehouseBox>(KEYS.boxes);
    return list.find(box => box.id === boxId) || null;
  }

  async saveBox(box: WarehouseBox): Promise<void> {
    const list = readList<WarehouseBox>(KEYS.boxes);
    const index = list.findIndex(item => item.id === box.id);
    const timestamp = nowIso();
    const next = { ...box, updatedAt: timestamp, createdAt: box.createdAt || timestamp };
    if (index >= 0) list[index] = next;
    else list.push(next);
    writeList(KEYS.boxes, list);
  }

  async listModelLocations(): Promise<ModelLocation[]> {
    return readList<ModelLocation>(KEYS.modelLocations);
  }

  async getModelLocation(modelName: string): Promise<ModelLocation | null> {
    const list = readList<ModelLocation>(KEYS.modelLocations);
    return list.find(item => item.modelName === modelName) || null;
  }

  async saveModelLocation(location: ModelLocation): Promise<void> {
    const list = readList<ModelLocation>(KEYS.modelLocations);
    const index = list.findIndex(item => item.modelName === location.modelName);
    const timestamp = nowIso();
    const next = { ...location, updatedAt: timestamp, createdAt: location.createdAt || timestamp };
    if (index >= 0) list[index] = next;
    else list.push(next);
    writeList(KEYS.modelLocations, list);
  }

  async listSkuExceptions(): Promise<SkuLocation[]> {
    return readList<SkuLocation>(KEYS.skuExceptions);
  }

  async saveSkuException(exception: SkuLocation): Promise<void> {
    const list = readList<SkuLocation>(KEYS.skuExceptions);
    const index = list.findIndex(item => item.skuId === exception.skuId);
    const timestamp = nowIso();
    const next = { ...exception, updatedAt: timestamp, createdAt: exception.createdAt || timestamp };
    if (index >= 0) list[index] = next;
    else list.push(next);
    writeList(KEYS.skuExceptions, list);
  }

  async deleteSkuException(skuId: string): Promise<void> {
    const list = readList<SkuLocation>(KEYS.skuExceptions).filter(item => item.skuId !== skuId);
    writeList(KEYS.skuExceptions, list);
  }

  async listMigrationMappings(): Promise<WarehouseMigrationMapping[]> {
    return readList<WarehouseMigrationMapping>(KEYS.migrationMappings);
  }

  async saveMigrationMapping(mapping: WarehouseMigrationMapping): Promise<void> {
    const list = readList<WarehouseMigrationMapping>(KEYS.migrationMappings);
    const index = list.findIndex(item => item.id === mapping.id);
    const timestamp = nowIso();
    const next = { ...mapping, updatedAt: timestamp, createdAt: mapping.createdAt || timestamp };
    if (index >= 0) list[index] = next;
    else list.push(next);
    writeList(KEYS.migrationMappings, list);
  }
}
