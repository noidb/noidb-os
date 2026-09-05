import type { VendorOrderRepository } from "./repository";
import type { VendorOrderDraft, VendorOrderDraftLine } from "./types";
import { LocalVendorOrderRepository, readLocalVendorOrderSnapshot, replaceLocalVendorOrderSnapshot } from "./local-repository";
import type { PickingWaveStoreMutation, PickingWaveStoreSnapshot } from "../picking-wave/shared-store-types";
import { deriveVendorOrderDrafts } from "./derive-drafts";

const MIGRATION_KEY = "noidb_vendor_order_shared_migration_v1";
const DIRTY_KEY = "noidb_vendor_order_shared_dirty_v1";

function isBrowser() { return typeof window !== "undefined" && typeof window.localStorage !== "undefined"; }

async function requestSnapshot(mutation?: PickingWaveStoreMutation): Promise<PickingWaveStoreSnapshot> {
  const response = await fetch("/api/wms/picking-waves", mutation ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mutation), cache: "no-store",
  } : { cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok || !result.snapshot) throw new Error(result.error || `거래처발주 공용 저장 실패(HTTP ${response.status})`);
  return result.snapshot;
}

function mirror(snapshot: PickingWaveStoreSnapshot) {
  replaceLocalVendorOrderSnapshot(snapshot);
  if (isBrowser()) {
    window.localStorage.setItem(MIGRATION_KEY, JSON.stringify({ completedAt: new Date().toISOString(), serverRevision: snapshot.revision }));
    window.localStorage.removeItem(DIRTY_KEY);
  }
}

export class SharedVendorOrderRepository implements VendorOrderRepository {
  private readonly local = new LocalVendorOrderRepository();
  private migrationPromise: Promise<void> | null = null;

  private ensureMigrated(): Promise<void> {
    if (!isBrowser()) return Promise.resolve();
    if (this.migrationPromise) return this.migrationPromise;
    const needed = !window.localStorage.getItem(MIGRATION_KEY) || Boolean(window.localStorage.getItem(DIRTY_KEY));
    this.migrationPromise = (async () => {
      if (needed) mirror(await requestSnapshot({ action: "migrate", snapshot: readLocalVendorOrderSnapshot() }));
    })().catch(error => { this.migrationPromise = null; throw error; });
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

  async listDrafts(waveId: string) { try { const snapshot = await this.refresh(); return deriveVendorOrderDrafts(snapshot.vendorOrderDrafts, snapshot.vendorOrderLines).filter(value => value.waveId === waveId); } catch { return this.local.listDrafts(waveId); } }
  async saveDraft(draft: VendorOrderDraft) { return this.save(() => this.local.saveDraft(draft), { action: "saveVendorDraft", draft }); }
  async deleteDraft(draftId: string) { await this.ensureMigrated(); mirror(await requestSnapshot({ action: "deleteVendorDraft", draftId, deletedAt: new Date().toISOString() })); }
  async listLines(waveId: string) { try { return (await this.refresh()).vendorOrderLines.filter(value => value.waveId === waveId); } catch { return this.local.listLines(waveId); } }
  async saveLine(line: VendorOrderDraftLine) { return this.save(() => this.local.saveLine(line), { action: "saveVendorLine", line }); }
  async deleteLine(lineId: string) { await this.ensureMigrated(); mirror(await requestSnapshot({ action: "deleteVendorLine", lineId, deletedAt: new Date().toISOString() })); }
  async listAllDrafts() { try { const snapshot = await this.refresh(); return deriveVendorOrderDrafts(snapshot.vendorOrderDrafts, snapshot.vendorOrderLines); } catch { return this.local.listAllDrafts(); } }
  async listAllLines() { try { return (await this.refresh()).vendorOrderLines; } catch { return this.local.listAllLines(); } }
}
