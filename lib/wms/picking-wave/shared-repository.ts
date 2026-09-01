import type { BasketAssignment, PickingWave, PickingWaveItem } from "./types";
import type { PickingWaveRepository } from "./repository";
import { LocalPickingWaveRepository, readLocalPickingWaveSnapshot, replaceLocalPickingWaveSnapshot } from "./local-repository";
import type { PickingWaveStoreMutation, PickingWaveStoreSnapshot } from "./shared-store-types";
import { PO_CONFIRMATION_STORAGE_KEY, listPoConfirmationRecords, parsePoConfirmationRecords, removeTransientPoConfirmationRecordsForWave, replaceLocalPoConfirmationRecords, serializePoConfirmationRecords } from "../po-confirm-state";

const MIGRATION_KEY = "noidb_picking_wave_shared_migration_v1";
const DIRTY_KEY = "noidb_picking_wave_shared_dirty_v1";

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

async function requestSnapshot(mutation?: PickingWaveStoreMutation): Promise<PickingWaveStoreSnapshot> {
  const maxAttempts = mutation ? 2 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch("/api/wms/picking-waves", mutation ? {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mutation),
      cache: "no-store",
    } : { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (response.ok && result.ok && result.snapshot) return result.snapshot as PickingWaveStoreSnapshot;
    if (mutation && response.status === 503 && attempt + 1 < maxAttempts) {
      const seconds = Math.max(1, Math.min(60, Number(response.headers.get("Retry-After")) || 2));
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
      continue;
    }
    throw new Error(result.error || `웨이브 공용 저장소 요청 실패(HTTP ${response.status})`);
  }
  throw new Error("웨이브 공용 저장소 요청에 실패했습니다.");
}

function friendlyStoreError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/429|too many requests|rate.?limit|conditional|conflict|precondition|412|409/i.test(message)) {
    return new Error("저장 서버가 잠시 혼잡합니다. 자동 재시도 후에도 저장하지 못했습니다. 기존 데이터는 변경되지 않았습니다. 잠시 후 다시 시도해주세요.");
  }
  return error instanceof Error ? error : new Error("웨이브를 저장하지 못했습니다. 기존 데이터는 변경되지 않았습니다. 잠시 후 다시 시도해주세요.");
}

function mirrorServerSnapshot(snapshot: PickingWaveStoreSnapshot): void {
  replaceLocalPickingWaveSnapshot(snapshot);
  replaceLocalPoConfirmationRecords(snapshot.poConfirmationRecords || []);
  if (!isBrowser()) return;
  window.localStorage.setItem(MIGRATION_KEY, JSON.stringify({
    completedAt: new Date().toISOString(),
    serverRevision: snapshot.revision,
    waveIds: snapshot.waves.map(wave => wave.id).sort(),
  }));
  window.localStorage.removeItem(DIRTY_KEY);
}

function markDirty(): void {
  if (isBrowser()) window.localStorage.setItem(DIRTY_KEY, new Date().toISOString());
}

export class SharedPickingWaveRepository implements PickingWaveRepository {
  private readonly local = new LocalPickingWaveRepository();
  private migrationPromise: Promise<void> | null = null;

  private ensureMigrated(): Promise<void> {
    if (!isBrowser()) return Promise.resolve();
    if (this.migrationPromise) return this.migrationPromise;
    const needsMigration = !window.localStorage.getItem(MIGRATION_KEY) || Boolean(window.localStorage.getItem(DIRTY_KEY));
    this.migrationPromise = (async () => {
      if (needsMigration) {
        const localSnapshot = { ...readLocalPickingWaveSnapshot(), poConfirmationRecords: listPoConfirmationRecords() };
        const beforeWaveIds = localSnapshot.waves.map(wave => wave.id).sort();
        const serverSnapshot = await requestSnapshot({ action: "migrate", snapshot: localSnapshot });
        mirrorServerSnapshot(serverSnapshot);
        if (process.env.NODE_ENV !== "production") {
          console.info("[picking-wave-migration]", { beforeWaveIds, afterWaveIds: serverSnapshot.waves.map(wave => wave.id).sort(), serverRevision: serverSnapshot.revision });
        }
      }
    })().catch(error => {
      this.migrationPromise = null;
      throw error;
    });
    return this.migrationPromise;
  }

  private async refresh(): Promise<PickingWaveStoreSnapshot> {
    await this.ensureMigrated();
    const snapshot = await requestSnapshot();
    mirrorServerSnapshot(snapshot);
    return snapshot;
  }

  private async saveLocalThenServer(localSave: () => Promise<void>, mutation: PickingWaveStoreMutation): Promise<void> {
    let migrationError: unknown;
    try {
      await this.ensureMigrated();
    } catch (error) {
      migrationError = error;
    }
    await localSave();
    markDirty();
    if (migrationError) {
      throw new Error(`공용 저장소에 연결하지 못해 변경사항을 이 브라우저의 복구 캐시에 보존했습니다: ${migrationError instanceof Error ? migrationError.message : "알 수 없는 연결 오류"}`);
    }
    const snapshot = await requestSnapshot(mutation);
    mirrorServerSnapshot(snapshot);
  }

  async listWaves(): Promise<PickingWave[]> {
    try { return (await this.refresh()).waves.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
    catch { return this.local.listWaves(); }
  }

  async getWave(waveId: string): Promise<PickingWave | null> {
    try { return (await this.refresh()).waves.find(wave => wave.id === waveId) || null; }
    catch { return this.local.getWave(waveId); }
  }

  async saveWave(wave: PickingWave): Promise<void> {
    await this.saveLocalThenServer(() => this.local.saveWave(wave), { action: "saveWave", wave });
  }

  async createWaveBatch(operationId: string, wave: PickingWave, items: PickingWaveItem[], baskets: BasketAssignment[]): Promise<string> {
    try {
      await this.ensureMigrated();
      const snapshot = await requestSnapshot({ action: "createWaveBatch", operationId, wave, items, baskets });
      mirrorServerSnapshot(snapshot);
      return snapshot.completedCreateOperations?.[operationId]?.waveId || wave.id;
    } catch (error) {
      if (process.env.NODE_ENV !== "production") console.error("[create-wave-batch]", error);
      throw friendlyStoreError(error);
    }
  }

  async deleteWave(waveId: string): Promise<void> {
    await this.ensureMigrated();
    const snapshot = await requestSnapshot({ action: "deleteWave", waveId, deletedAt: new Date().toISOString() });
    mirrorServerSnapshot(snapshot);
    if (isBrowser()) {
      const records = parsePoConfirmationRecords(window.localStorage.getItem(PO_CONFIRMATION_STORAGE_KEY));
      window.localStorage.setItem(PO_CONFIRMATION_STORAGE_KEY, serializePoConfirmationRecords(removeTransientPoConfirmationRecordsForWave(records, waveId)));
    }
  }

  async listItems(waveId: string): Promise<PickingWaveItem[]> {
    try { return (await this.refresh()).items.filter(item => item.waveId === waveId); }
    catch { return this.local.listItems(waveId); }
  }

  async saveItem(item: PickingWaveItem): Promise<void> {
    await this.saveLocalThenServer(() => this.local.saveItem(item), { action: "saveItem", item });
  }

  async saveProgress(items: PickingWaveItem[], wave: PickingWave): Promise<void> {
    await this.saveLocalThenServer(
      () => this.local.saveProgress(items, wave),
      { action: "saveProgress", items, wave }
    );
  }

  async deleteItem(itemId: string): Promise<void> {
    await this.ensureMigrated();
    const snapshot = await requestSnapshot({ action: "deleteItem", itemId, deletedAt: new Date().toISOString() });
    mirrorServerSnapshot(snapshot);
  }

  async listBaskets(waveId: string): Promise<BasketAssignment[]> {
    try { return (await this.refresh()).baskets.filter(basket => basket.waveId === waveId); }
    catch { return this.local.listBaskets(waveId); }
  }

  async saveBasket(basket: BasketAssignment): Promise<void> {
    await this.saveLocalThenServer(() => this.local.saveBasket(basket), { action: "saveBasket", basket });
  }

  async deleteBasket(waveId: string, basketNumber: string): Promise<void> {
    await this.ensureMigrated();
    const snapshot = await requestSnapshot({ action: "deleteBasket", waveId, basketNumber, deletedAt: new Date().toISOString() });
    mirrorServerSnapshot(snapshot);
  }
}
