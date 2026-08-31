import type { ModelLocation, Shelf, SkuLocation, WarehouseBox, WarehouseMigrationMapping, WarehouseZone } from "@/lib/wms/types";
import type { WarehouseRepository } from "./repository";
import { LocalWarehouseRepository, readLocalWarehouseSnapshot, replaceLocalWarehouseSnapshot } from "./local-repository";
import type { PickingWaveStoreMutation, PickingWaveStoreSnapshot } from "@/lib/wms/picking-wave/shared-store-types";

const MIGRATION_KEY = "noidb_warehouse_shared_migration_v1";
const DIRTY_KEY = "noidb_warehouse_shared_dirty_v1";
const isBrowser = () => typeof window !== "undefined" && typeof window.localStorage !== "undefined";

async function requestSnapshot(mutation?: PickingWaveStoreMutation): Promise<PickingWaveStoreSnapshot> {
  const response = await fetch("/api/wms/picking-waves", mutation ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mutation), cache: "no-store" } : { cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok || !result.snapshot) throw new Error(result.error || `창고 공용 저장 실패(HTTP ${response.status})`);
  return result.snapshot;
}

function mirror(snapshot: PickingWaveStoreSnapshot) {
  replaceLocalWarehouseSnapshot(snapshot);
  if (isBrowser()) {
    window.localStorage.setItem(MIGRATION_KEY, JSON.stringify({ completedAt: new Date().toISOString(), serverRevision: snapshot.revision }));
    window.localStorage.removeItem(DIRTY_KEY);
  }
}

export class SharedWarehouseRepository implements WarehouseRepository {
  private readonly local = new LocalWarehouseRepository();
  private migrationPromise: Promise<void> | null = null;
  private ensureMigrated(): Promise<void> {
    if (!isBrowser()) return Promise.resolve();
    if (this.migrationPromise) return this.migrationPromise;
    const needed = !window.localStorage.getItem(MIGRATION_KEY) || Boolean(window.localStorage.getItem(DIRTY_KEY));
    this.migrationPromise = (async () => { if (needed) mirror(await requestSnapshot({ action: "migrate", snapshot: readLocalWarehouseSnapshot() })); })()
      .catch(error => { this.migrationPromise = null; throw error; });
    return this.migrationPromise;
  }
  private async refresh() { await this.ensureMigrated(); const snapshot = await requestSnapshot(); mirror(snapshot); return snapshot; }
  private async save(localSave: () => Promise<void>, mutation: PickingWaveStoreMutation) {
    let migrationError: unknown;
    try { await this.ensureMigrated(); } catch (error) { migrationError = error; }
    await localSave();
    if (isBrowser()) window.localStorage.setItem(DIRTY_KEY, new Date().toISOString());
    if (migrationError) throw new Error(`공용 저장 실패 — 브라우저 복구본 유지: ${migrationError instanceof Error ? migrationError.message : "연결 오류"}`);
    mirror(await requestSnapshot(mutation));
  }
  async listZones() { try { return (await this.refresh()).warehouseZones.sort((a, b) => a.sortOrder - b.sortOrder); } catch { return this.local.listZones(); } }
  async saveZone(zone: WarehouseZone) { await this.save(() => this.local.saveZone(zone), { action: "saveWarehouseZone", zone: { ...zone, updatedAt: new Date().toISOString() } }); }
  async listShelves() { try { return (await this.refresh()).warehouseShelves.sort((a, b) => a.sortOrder - b.sortOrder); } catch { return this.local.listShelves(); } }
  async saveShelf(shelf: Shelf) { await this.save(() => this.local.saveShelf(shelf), { action: "saveWarehouseShelf", shelf: { ...shelf, updatedAt: new Date().toISOString() } }); }
  async listBoxes() { try { return (await this.refresh()).warehouseBoxes.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)); } catch { return this.local.listBoxes(); } }
  async getBox(boxId: string) { try { return (await this.refresh()).warehouseBoxes.find(value => value.id === boxId) || null; } catch { return this.local.getBox(boxId); } }
  async saveBox(box: WarehouseBox) { await this.save(() => this.local.saveBox(box), { action: "saveWarehouseBox", box: { ...box, updatedAt: new Date().toISOString() } }); }
  async listModelLocations() { try { return (await this.refresh()).warehouseModelLocations; } catch { return this.local.listModelLocations(); } }
  async getModelLocation(modelName: string) { try { return (await this.refresh()).warehouseModelLocations.find(value => value.modelName === modelName) || null; } catch { return this.local.getModelLocation(modelName); } }
  async saveModelLocation(location: ModelLocation) { await this.save(() => this.local.saveModelLocation(location), { action: "saveWarehouseModelLocation", location: { ...location, updatedAt: new Date().toISOString() } }); }
  async listSkuExceptions() { try { return (await this.refresh()).warehouseSkuExceptions; } catch { return this.local.listSkuExceptions(); } }
  async saveSkuException(exception: SkuLocation) { await this.save(() => this.local.saveSkuException(exception), { action: "saveWarehouseSkuException", exception: { ...exception, updatedAt: new Date().toISOString() } }); }
  async deleteSkuException(skuId: string) { await this.ensureMigrated(); mirror(await requestSnapshot({ action: "deleteWarehouseSkuException", skuId, deletedAt: new Date().toISOString() })); }
  async listMigrationMappings() { try { return (await this.refresh()).warehouseMigrationMappings; } catch { return this.local.listMigrationMappings(); } }
  async saveMigrationMapping(mapping: WarehouseMigrationMapping) { await this.save(() => this.local.saveMigrationMapping(mapping), { action: "saveWarehouseMigrationMapping", mapping: { ...mapping, updatedAt: new Date().toISOString() } }); }
}
