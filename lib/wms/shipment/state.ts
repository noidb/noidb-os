import type { ShipmentOutputGeneration } from "../picking-wave/types";
import type { Shipment, ShipmentSplitPreview, ShipmentStatus } from "./types";

const STATUS_ORDER: ShipmentStatus[] = ["draft", "invoice_generated", "tracking_verified", "upload_generated", "output_generated", "dispatched"];

export function canDeleteShipment(shipment: Shipment): boolean {
  return shipment.status === "draft" || shipment.status === "invoice_generated";
}

function nextShipmentIds(existing: readonly Shipment[], count: number, now: string): string[] {
  const date = now.slice(0, 10).replaceAll("-", "");
  const prefix = `SHP-${date}-`;
  const maximum = existing.reduce((max, shipment) => {
    const match = shipment.id.startsWith(prefix) ? Number(shipment.id.slice(prefix.length)) : 0;
    return Number.isInteger(match) ? Math.max(max, match) : max;
  }, 0);
  return Array.from({ length: count }, (_, index) => `${prefix}${String(maximum + index + 1).padStart(3, "0")}`);
}

export function createShipmentsInState(
  existing: readonly Shipment[],
  previews: readonly ShipmentSplitPreview[],
  now: string
): { all: Shipment[]; created: Shipment[] } {
  if (previews.length === 0) throw new Error("생성할 Shipment 미리보기가 없습니다.");
  const assigned = new Map(existing.flatMap(shipment => shipment.purchaseOrders.map(order => [order.purchaseOrderNumber, shipment.id] as const)));
  const selected = new Set<string>();
  for (const preview of previews) {
    if (preview.purchaseOrders.length === 0) throw new Error("발주서가 없는 Shipment는 생성할 수 없습니다.");
    for (const order of preview.purchaseOrders) {
      const existingShipmentId = assigned.get(order.purchaseOrderNumber);
      if (existingShipmentId) throw new Error(`발주서 ${order.purchaseOrderNumber}는 이미 ${existingShipmentId}에 포함됐습니다.`);
      if (selected.has(order.purchaseOrderNumber)) throw new Error(`발주서 ${order.purchaseOrderNumber}가 두 Shipment에 중복 포함됐습니다.`);
      selected.add(order.purchaseOrderNumber);
    }
  }
  const ids = nextShipmentIds(existing, previews.length, now);
  const created = previews.map((preview, index): Shipment => ({
    id: ids[index],
    name: preview.suggestedName,
    status: "draft",
    purchaseOrders: preview.purchaseOrders.map(order => ({ ...order })),
    createdAt: now,
    updatedAt: now,
  }));
  return { all: [...existing, ...created], created };
}

export function renameShipmentInState(existing: readonly Shipment[], shipmentId: string, name: string, now: string): { all: Shipment[]; updated: Shipment } {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Shipment 이름을 입력해주세요.");
  const target = existing.find(shipment => shipment.id === shipmentId);
  if (!target) throw new Error("Shipment를 찾지 못했습니다.");
  const updated = { ...target, name: trimmed, updatedAt: now };
  return { all: existing.map(shipment => shipment.id === shipmentId ? updated : shipment), updated };
}

export function updateShipmentStatusInState(existing: readonly Shipment[], shipmentId: string, status: ShipmentStatus, now: string): { all: Shipment[]; updated: Shipment } {
  const target = existing.find(shipment => shipment.id === shipmentId);
  if (!target) throw new Error("Shipment를 찾지 못했습니다.");
  if (STATUS_ORDER.indexOf(status) < STATUS_ORDER.indexOf(target.status)) return { all: [...existing], updated: target };
  const updated = { ...target, status, updatedAt: now };
  return { all: existing.map(shipment => shipment.id === shipmentId ? updated : shipment), updated };
}

export function updateShipmentGenerationInState(existing: readonly Shipment[], shipmentId: string, outputGeneration: ShipmentOutputGeneration, now: string): { all: Shipment[]; updated: Shipment } {
  const target = existing.find(shipment => shipment.id === shipmentId);
  if (!target) throw new Error("Shipment를 찾지 못했습니다.");
  const updated = { ...target, outputGeneration: { ...outputGeneration }, updatedAt: now };
  return { all: existing.map(shipment => shipment.id === shipmentId ? updated : shipment), updated };
}

export function deleteShipmentFromState(existing: readonly Shipment[], shipmentId: string): Shipment[] {
  const target = existing.find(shipment => shipment.id === shipmentId);
  if (!target) throw new Error("Shipment를 찾지 못했습니다.");
  if (!canDeleteShipment(target)) throw new Error("운송장 검증 이후 진행된 Shipment는 삭제할 수 없습니다.");
  return existing.filter(shipment => shipment.id !== shipmentId);
}
