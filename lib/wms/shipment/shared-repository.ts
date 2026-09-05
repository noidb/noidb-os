import type { PickingWaveStoreMutation, PickingWaveStoreSnapshot } from "../picking-wave/shared-store-types";
import type { ShipmentRepository } from "./repository";
import { LocalShipmentRepository, readLocalShipments, replaceLocalShipments } from "./local-repository";
import type { ShipmentOutputGeneration } from "../picking-wave/types";
import type { Shipment, ShipmentSplitPreview, ShipmentStatus } from "./types";

const MIGRATION_KEY = "noidb_wms_shipments_shared_migration_v1";

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
    throw new Error(result.error || `Shipment 공용 저장소 요청 실패(HTTP ${response.status})`);
  }
  throw new Error("Shipment 공용 저장소 요청에 실패했습니다.");
}

function mirror(snapshot: PickingWaveStoreSnapshot): void {
  replaceLocalShipments(snapshot.shipments || []);
  if (isBrowser()) window.localStorage.setItem(MIGRATION_KEY, JSON.stringify({ completedAt: new Date().toISOString(), serverRevision: snapshot.revision }));
}

export class SharedShipmentRepository implements ShipmentRepository {
  private readonly local = new LocalShipmentRepository();
  private migrationPromise: Promise<void> | null = null;

  private ensureMigrated(): Promise<void> {
    if (!isBrowser()) return Promise.resolve();
    if (this.migrationPromise) return this.migrationPromise;
    this.migrationPromise = (async () => {
      if (!window.localStorage.getItem(MIGRATION_KEY)) {
        mirror(await requestSnapshot({ action: "migrateShipments", shipments: readLocalShipments() }));
      }
    })().catch(error => { this.migrationPromise = null; throw error; });
    return this.migrationPromise;
  }

  private async refresh(): Promise<PickingWaveStoreSnapshot> {
    await this.ensureMigrated();
    const snapshot = await requestSnapshot();
    mirror(snapshot);
    return snapshot;
  }

  private async mutate(mutation: PickingWaveStoreMutation): Promise<PickingWaveStoreSnapshot> {
    await this.ensureMigrated();
    const snapshot = await requestSnapshot(mutation);
    mirror(snapshot);
    return snapshot;
  }

  async listShipments(): Promise<Shipment[]> {
    try { return (await this.refresh()).shipments.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
    catch { return this.local.listShipments(); }
  }

  async getShipment(shipmentId: string): Promise<Shipment | null> {
    try { return (await this.refresh()).shipments.find(shipment => shipment.id === shipmentId) || null; }
    catch { return this.local.getShipment(shipmentId); }
  }

  async createFromPreviews(previews: readonly ShipmentSplitPreview[], now = new Date().toISOString()): Promise<Shipment[]> {
    const operationId = globalThis.crypto?.randomUUID?.() || `shipment-${now}-${Math.random().toString(36).slice(2)}`;
    const snapshot = await this.mutate({ action: "createShipments", operationId, previews: [...previews], now });
    const ids = snapshot.completedShipmentCreateOperations[operationId]?.shipmentIds || [];
    return ids.map(id => snapshot.shipments.find(shipment => shipment.id === id)).filter((shipment): shipment is Shipment => Boolean(shipment));
  }

  async renameShipment(shipmentId: string, name: string): Promise<Shipment> {
    const snapshot = await this.mutate({ action: "renameShipment", shipmentId, name, now: new Date().toISOString() });
    return this.requireShipment(snapshot, shipmentId);
  }

  async updateShipmentStatus(shipmentId: string, status: ShipmentStatus): Promise<Shipment> {
    const snapshot = await this.mutate({ action: "updateShipmentStatus", shipmentId, status, now: new Date().toISOString() });
    return this.requireShipment(snapshot, shipmentId);
  }

  async updateShipmentGeneration(shipmentId: string, generation: ShipmentOutputGeneration): Promise<Shipment> {
    const snapshot = await this.mutate({ action: "updateShipmentGeneration", shipmentId, generation, now: new Date().toISOString() });
    return this.requireShipment(snapshot, shipmentId);
  }

  async deleteShipment(shipmentId: string): Promise<void> {
    await this.mutate({ action: "deleteShipment", shipmentId, deletedAt: new Date().toISOString() });
  }

  private requireShipment(snapshot: PickingWaveStoreSnapshot, shipmentId: string): Shipment {
    const shipment = snapshot.shipments.find(value => value.id === shipmentId);
    if (!shipment) throw new Error("Shipment 저장 결과를 확인하지 못했습니다.");
    return shipment;
  }
}
