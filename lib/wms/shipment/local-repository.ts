import type { ShipmentRepository } from "./repository";
import { createShipmentsInState, deleteShipmentFromState, renameShipmentInState, updateShipmentGenerationInState, updateShipmentStatusInState } from "./state";
import type { ShipmentOutputGeneration } from "../picking-wave/types";
import type { Shipment, ShipmentSplitPreview, ShipmentStatus } from "./types";

export const SHIPMENT_STORAGE_KEY = "noidb_wms_shipments_v1";

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readLocalShipments(): Shipment[] {
  if (!isBrowser()) return [];
  const raw = window.localStorage.getItem(SHIPMENT_STORAGE_KEY);
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("Shipment 저장값이 손상되어 작업을 중단했습니다."); }
  if (!Array.isArray(parsed) || !parsed.every(value => {
    if (!value || typeof value !== "object") return false;
    const shipment = value as Partial<Shipment>;
    return typeof shipment.id === "string" && typeof shipment.name === "string" && Array.isArray(shipment.purchaseOrders);
  })) throw new Error("Shipment 저장 형식이 올바르지 않아 작업을 중단했습니다.");
  return parsed as Shipment[];
}

export function replaceLocalShipments(all: readonly Shipment[]): void {
  if (isBrowser()) window.localStorage.setItem(SHIPMENT_STORAGE_KEY, JSON.stringify(all));
}

export class LocalShipmentRepository implements ShipmentRepository {
  async listShipments(): Promise<Shipment[]> {
    return readLocalShipments().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getShipment(shipmentId: string): Promise<Shipment | null> {
    return readLocalShipments().find(shipment => shipment.id === shipmentId) ?? null;
  }

  async createFromPreviews(previews: readonly ShipmentSplitPreview[], now = new Date().toISOString()): Promise<Shipment[]> {
    // 쓰기 직전에 최신 원장을 다시 읽고 전체 중복검사를 한 뒤 한 번만 저장한다.
    const result = createShipmentsInState(readLocalShipments(), previews, now);
    replaceLocalShipments(result.all);
    return result.created;
  }

  async renameShipment(shipmentId: string, name: string): Promise<Shipment> {
    const result = renameShipmentInState(readLocalShipments(), shipmentId, name, new Date().toISOString());
    replaceLocalShipments(result.all);
    return result.updated;
  }

  async updateShipmentStatus(shipmentId: string, status: ShipmentStatus): Promise<Shipment> {
    const result = updateShipmentStatusInState(readLocalShipments(), shipmentId, status, new Date().toISOString());
    replaceLocalShipments(result.all);
    return result.updated;
  }

  async updateShipmentGeneration(shipmentId: string, generation: ShipmentOutputGeneration): Promise<Shipment> {
    const result = updateShipmentGenerationInState(readLocalShipments(), shipmentId, generation, new Date().toISOString());
    replaceLocalShipments(result.all);
    return result.updated;
  }

  async deleteShipment(shipmentId: string): Promise<void> {
    // 해당 Shipment 하나만 제거한다. 발주서/피킹/제품DB/재고 저장소에는 접근하지 않는다.
    replaceLocalShipments(deleteShipmentFromState(readLocalShipments(), shipmentId));
  }
}
