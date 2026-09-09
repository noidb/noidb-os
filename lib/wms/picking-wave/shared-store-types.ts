import type { PackingProgress, PackingRow } from "../packing-progress";
import type { BasketAssignment, PickingWave, PickingWaveItem, OutboundWorkState } from "./types";
import type { PoConfirmationRecord } from "../po-confirm-state";
import type { VendorOrderDraft, VendorOrderDraftLine } from "../vendor-order/types";
import type { ModelLocation, Shelf, SkuLocation, WarehouseBox, WarehouseMigrationMapping, WarehouseZone } from "../types";
import type { Shipment, ShipmentSplitPreview, ShipmentStatus } from "../shipment/types";
import type { ShipmentOutputGeneration } from "./types";

export interface PickingWaveStoreSnapshot {
  activeVendorQueueId?: string;
  vendorQueueConsumedLineIds?: Record<string, string>;
  vendorQueueReceipts?: Record<string, import("../vendor-order/consolidate").VendorQueueReceipt>;
  /** SKU hidden after user deletion until an explicit manual/reorder add saves it again. */
  suppressedVendorSkuIds?: Record<string, string>;
  schemaVersion: 1;
  revision: number;
  updatedAt: string;
  waves: PickingWave[];
  items: PickingWaveItem[];
  baskets: BasketAssignment[];
  poConfirmationRecords: PoConfirmationRecord[];
  vendorOrderDrafts: VendorOrderDraft[];
  vendorOrderLines: VendorOrderDraftLine[];
  warehouseZones: WarehouseZone[];
  warehouseShelves: Shelf[];
  warehouseBoxes: WarehouseBox[];
  warehouseModelLocations: ModelLocation[];
  warehouseSkuExceptions: SkuLocation[];
  warehouseMigrationMappings: WarehouseMigrationMapping[];
  shipments: Shipment[];
  deletedWaveIds: Record<string, string>;
  deletedItemIds: Record<string, string>;
  deletedBasketKeys: Record<string, string>;
  deletedPoConfirmationNumbers: Record<string, string>;
  deletedVendorDraftIds: Record<string, string>;
  deletedVendorLineIds: Record<string, string>;
  deletedWarehouseSkuIds: Record<string, string>;
  deletedShipmentIds: Record<string, string>;
  completedCreateOperations: Record<string, { waveId: string; completedAt: string }>;
  completedShipmentCreateOperations: Record<string, { shipmentIds: string[]; completedAt: string }>;
  /** Optional for existing snapshots. No migration or Wave rewrite is required. */
  outboundWorkStates?: Record<string, OutboundWorkState>;
  packingProgress?: Record<string, PackingProgress>;
}

export type PickingWaveStoreMutation =
  | { action: "consolidateVendorOrders"; operationId: string; lines: VendorOrderDraftLine[]; now: string }
  | { action: "savePackingProgress"; waveId: string; generationKey: string; rows: PackingRow[]; checkedKeys: string[]; dispatchedShipmentNumbers?: string[]; expectedUpdatedAt: string | null; dispatched: boolean; now: string }
  | { action: "repairConfirmedFileLinks"; before: PoConfirmationRecord[]; fileName: string; contentHash: string; now: string }
  | { action: "setOutboundWorkState"; waveId: string; status: OutboundWorkState["status"]; expectedUpdatedAt: string | null; expectedWorkUpdatedAt?: string; confirmedDispatched?: boolean; now: string }
  | { action: "migrate"; snapshot: Partial<Pick<PickingWaveStoreSnapshot, "waves" | "items" | "baskets" | "poConfirmationRecords" | "vendorOrderDrafts" | "vendorOrderLines" | "warehouseZones" | "warehouseShelves" | "warehouseBoxes" | "warehouseModelLocations" | "warehouseSkuExceptions" | "warehouseMigrationMappings">> }
  | { action: "saveWave"; wave: PickingWave }
  | { action: "deleteWave"; waveId: string; deletedAt: string }
  | { action: "saveItem"; item: PickingWaveItem }
  | { action: "saveProgress"; items: PickingWaveItem[]; wave: PickingWave }
  | { action: "createWaveBatch"; operationId: string; wave: PickingWave; items: PickingWaveItem[]; baskets: BasketAssignment[] }
  | { action: "deleteItem"; itemId: string; deletedAt: string }
  | { action: "saveBasket"; basket: BasketAssignment }
  | { action: "deleteBasket"; waveId: string; basketNumber: string; deletedAt: string }
  | { action: "upsertPoConfirmationRecords"; records: PoConfirmationRecord[] }
  | { action: "clearPoConfirmationErrors"; poNumbers: string[]; waveId?: string; deletedAt: string }
  | { action: "saveVendorDraft"; draft: VendorOrderDraft; expectedUpdatedAt?: string | null; expectedLineIds?: string[] }
  | { action: "saveVendorWorkspace"; operationId: string; waveId: string; lines: VendorOrderDraftLine[]; drafts: VendorOrderDraft[]; removedLineIds: string[]; expectedUpdatedAtByLineId: Record<string, string | null>; expectedUpdatedAtByDraftId: Record<string, string | null>; expectedLineIdsByDraftId: Record<string, string[]>; now: string }
  | { action: "deleteVendorDraft"; draftId: string; deletedAt: string; expectedUpdatedAt?: string | null; expectedLineIds?: string[] }
  | { action: "restoreVendorDraft"; draft: VendorOrderDraft; lines: VendorOrderDraftLine[] }
  | { action: "saveVendorLine"; line: VendorOrderDraftLine; expectedUpdatedAt?: string | null }
  | { action: "saveVendorLineImage"; lineId: string; imageUrl: string; expectedImageUrl: string; now: string }
  | { action: "saveSimpleReceiving"; before: VendorOrderDraftLine; input: { quantity: number; unitPrice: number; usedImmediately: boolean }; now: string }
  | { action: "deleteVendorLine"; lineId: string; deletedAt: string }
  | { action: "deleteVendorLines"; waveId: string; lineIds: string[]; expectedUpdatedAtByLineId: Record<string, string>; deletedAt: string }
  | { action: "saveWarehouseZone"; zone: WarehouseZone }
  | { action: "saveWarehouseShelf"; shelf: Shelf }
  | { action: "saveWarehouseBox"; box: WarehouseBox }
  | { action: "saveWarehouseModelLocation"; location: ModelLocation }
  | { action: "saveWarehouseSkuException"; exception: SkuLocation }
  | { action: "deleteWarehouseSkuException"; skuId: string; deletedAt: string }
  | { action: "saveWarehouseMigrationMapping"; mapping: WarehouseMigrationMapping }
  | { action: "migrateShipments"; shipments: Shipment[] }
  | { action: "createShipments"; operationId: string; previews: ShipmentSplitPreview[]; now: string }
  | { action: "renameShipment"; shipmentId: string; name: string; now: string }
  | { action: "updateShipmentStatus"; shipmentId: string; status: ShipmentStatus; now: string }
  | { action: "updateShipmentGeneration"; shipmentId: string; generation: ShipmentOutputGeneration; now: string }
  | { action: "deleteShipment"; shipmentId: string; deletedAt: string };

export function emptyPickingWaveStoreSnapshot(): PickingWaveStoreSnapshot {
  return {
    schemaVersion: 1,
    revision: 0,
    updatedAt: new Date(0).toISOString(),
    waves: [],
    items: [],
    baskets: [],
    poConfirmationRecords: [],
    vendorOrderDrafts: [],
    vendorOrderLines: [],
    suppressedVendorSkuIds: {},
    warehouseZones: [],
    warehouseShelves: [],
    warehouseBoxes: [],
    warehouseModelLocations: [],
    warehouseSkuExceptions: [],
    warehouseMigrationMappings: [],
    shipments: [],
    deletedWaveIds: {},
    deletedItemIds: {},
    deletedBasketKeys: {},
    deletedPoConfirmationNumbers: {},
    deletedVendorDraftIds: {},
    deletedVendorLineIds: {},
    deletedWarehouseSkuIds: {},
    deletedShipmentIds: {},
    completedCreateOperations: {},
    completedShipmentCreateOperations: {},
  };
}

export function basketKey(waveId: string, basketNumber: string): string {
  return `${waveId.trim()}::${basketNumber.trim()}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasText(value: unknown, key: string): boolean {
  return isObject(value) && typeof value[key] === "string" && String(value[key]).trim().length > 0;
}

export function isPickingWaveStoreMutation(value: unknown): value is PickingWaveStoreMutation {
  if (!isObject(value) || typeof value.action !== "string") return false;
  if (value.action === "setOutboundWorkState") return hasText(value, "waveId") && ["active", "completed", "archived"].includes(String(value.status))
    && (value.expectedUpdatedAt === null || typeof value.expectedUpdatedAt === "string") && typeof value.now === "string" && Number.isFinite(Date.parse(value.now));
  if (value.action === "migrate") {
    if (!isObject(value.snapshot)) return false;
    const arrays = Object.values(value.snapshot);
    return arrays.every(items => Array.isArray(items) && items.length <= 100_000);
  }
  if (value.action === "saveWave") return hasText(value.wave, "id") && hasText(value.wave, "updatedAt");
  if (value.action === "deleteWave") return hasText(value, "waveId") && hasText(value, "deletedAt");
  if (value.action === "saveItem") return hasText(value.item, "id") && hasText(value.item, "waveId") && hasText(value.item, "updatedAt");
  if (value.action === "saveProgress") return hasText(value.wave, "id") && hasText(value.wave, "updatedAt")
    && Array.isArray(value.items) && value.items.length <= 10_000
    && value.items.every(item => hasText(item, "id") && hasText(item, "waveId") && hasText(item, "updatedAt"));
  if (value.action === "createWaveBatch") {
    if (!hasText(value, "operationId") || !hasText(value.wave, "id") || !hasText(value.wave, "updatedAt")) return false;
    if (!Array.isArray(value.items) || value.items.length > 10_000 || !value.items.every(item => hasText(item, "id") && hasText(item, "waveId") && hasText(item, "updatedAt"))) return false;
    return Array.isArray(value.baskets) && value.baskets.length <= 10_000 && value.baskets.every(basket => hasText(basket, "waveId") && hasText(basket, "basketNumber") && hasText(basket, "updatedAt"));
  }
  if (value.action === "deleteItem") return hasText(value, "itemId") && hasText(value, "deletedAt");
  if (value.action === "saveBasket") return hasText(value.basket, "waveId") && hasText(value.basket, "basketNumber") && hasText(value.basket, "updatedAt");
  if (value.action === "deleteBasket") return hasText(value, "waveId") && hasText(value, "basketNumber") && hasText(value, "deletedAt");
  if (value.action === "upsertPoConfirmationRecords") return Array.isArray(value.records) && value.records.length <= 10_000;
  if (value.action === "clearPoConfirmationErrors") return Array.isArray(value.poNumbers) && value.poNumbers.length <= 10_000 && hasText(value, "deletedAt");
  if (value.action === "saveVendorDraft") return hasText(value.draft, "id") && hasText(value.draft, "updatedAt")
    && (value.expectedUpdatedAt === undefined || value.expectedUpdatedAt === null || typeof value.expectedUpdatedAt === "string")
    && (value.expectedLineIds === undefined || Array.isArray(value.expectedLineIds) && value.expectedLineIds.length <= 10000 && value.expectedLineIds.every(id => typeof id === "string" && id.trim()) && new Set(value.expectedLineIds).size === value.expectedLineIds.length);
  if (value.action === "saveVendorWorkspace") {
    if (!hasText(value, "operationId") || !hasText(value, "waveId") || !hasText(value, "now") || !Number.isFinite(Date.parse(String(value.now)))) return false;
    if (!Array.isArray(value.lines) || value.lines.length > 5000 || !value.lines.every(line => hasText(line, "id") && hasText(line, "draftId") && hasText(line, "waveId") && hasText(line, "updatedAt") && (line as Record<string, unknown>).waveId === value.waveId)) return false;
    if (new Set(value.lines.map(line => (line as Record<string, unknown>).id)).size !== value.lines.length) return false;
    if (!Array.isArray(value.drafts) || value.drafts.length > 1000 || !value.drafts.every(draft => hasText(draft, "id") && hasText(draft, "waveId") && hasText(draft, "updatedAt") && (draft as Record<string, unknown>).waveId === value.waveId)) return false;
    if (new Set(value.drafts.map(draft => (draft as Record<string, unknown>).id)).size !== value.drafts.length) return false;
    if (!Array.isArray(value.removedLineIds) || value.removedLineIds.length > 5000 || !value.removedLineIds.every(id => typeof id === "string" && id.trim()) || new Set(value.removedLineIds).size !== value.removedLineIds.length) return false;
    if (!isObject(value.expectedUpdatedAtByLineId) || !isObject(value.expectedUpdatedAtByDraftId) || !isObject(value.expectedLineIdsByDraftId)) return false;
    const expectedUpdatedAtByLineId = value.expectedUpdatedAtByLineId;
    const expectedUpdatedAtByDraftId = value.expectedUpdatedAtByDraftId;
    const expectedLineIdsByDraftId = value.expectedLineIdsByDraftId;
    if (!value.lines.every(line => Object.hasOwn(expectedUpdatedAtByLineId, String((line as Record<string, unknown>).id)) && (expectedUpdatedAtByLineId[String((line as Record<string, unknown>).id)] === null || typeof expectedUpdatedAtByLineId[String((line as Record<string, unknown>).id)] === "string"))) return false;
    if (!value.removedLineIds.every(id => typeof expectedUpdatedAtByLineId[id] === "string")) return false;
    return value.drafts.every(draft => {
      const id = String((draft as Record<string, unknown>).id);
      const expected = expectedUpdatedAtByDraftId[id];
      const lineIds = expectedLineIdsByDraftId[id];
      return Object.hasOwn(expectedUpdatedAtByDraftId, id) && (expected === null || typeof expected === "string")
        && Array.isArray(lineIds) && lineIds.length <= 5000 && lineIds.every(lineId => typeof lineId === "string" && lineId.trim()) && new Set(lineIds).size === lineIds.length;
    });
  }
  if (value.action === "deleteVendorDraft") return hasText(value, "draftId") && hasText(value, "deletedAt")
    && Number.isFinite(Date.parse(String(value.deletedAt)))
    && (value.expectedUpdatedAt === undefined || value.expectedUpdatedAt === null || typeof value.expectedUpdatedAt === "string")
    && (value.expectedLineIds === undefined || Array.isArray(value.expectedLineIds) && value.expectedLineIds.length <= 5000
      && value.expectedLineIds.every(id => typeof id === "string" && id.trim()) && new Set(value.expectedLineIds).size === value.expectedLineIds.length);
  if (value.action === "restoreVendorDraft") {
    if (!isObject(value.draft) || !hasText(value.draft, "id") || !hasText(value.draft, "waveId") || !hasText(value.draft, "updatedAt") || !Array.isArray(value.lines) || value.lines.length > 10000) return false;
    const draft = value.draft;
    return value.lines.every(line => isObject(line) && hasText(line, "id") && hasText(line, "updatedAt") && line.draftId === draft.id && line.waveId === draft.waveId)
      && new Set(value.lines.map(line => (line as Record<string, unknown>).id)).size === value.lines.length;
  }
  if (value.action === "saveVendorLine") return hasText(value.line, "id") && hasText(value.line, "updatedAt") && (value.expectedUpdatedAt === undefined || value.expectedUpdatedAt === null || typeof value.expectedUpdatedAt === "string");
  if (value.action === "deleteVendorLine") return hasText(value, "lineId") && hasText(value, "deletedAt");
  if (value.action === "deleteVendorLines") return hasText(value, "waveId") && Array.isArray(value.lineIds) && value.lineIds.length > 0 && value.lineIds.length <= 5000
    && value.lineIds.every(id => typeof id === "string" && id.trim().length > 0) && new Set(value.lineIds).size === value.lineIds.length
    && isObject(value.expectedUpdatedAtByLineId) && value.lineIds.every(id => hasText(value.expectedUpdatedAtByLineId, id as string))
    && typeof value.deletedAt === "string" && Number.isFinite(Date.parse(value.deletedAt));
  if (value.action === "saveWarehouseZone") return hasText(value.zone, "id");
  if (value.action === "saveWarehouseShelf") return hasText(value.shelf, "id");
  if (value.action === "saveWarehouseBox") return hasText(value.box, "id");
  if (value.action === "saveWarehouseModelLocation") return hasText(value.location, "modelName");
  if (value.action === "saveWarehouseSkuException") return hasText(value.exception, "skuId");
  if (value.action === "deleteWarehouseSkuException") return hasText(value, "skuId") && hasText(value, "deletedAt");
  if (value.action === "saveWarehouseMigrationMapping") return hasText(value.mapping, "id");
  if (value.action === "migrateShipments") return Array.isArray(value.shipments) && value.shipments.length <= 10_000
    && value.shipments.every(shipment => hasText(shipment, "id") && hasText(shipment, "updatedAt") && Array.isArray((shipment as Record<string, unknown>).purchaseOrders));
  if (value.action === "createShipments") return hasText(value, "operationId") && hasText(value, "now")
    && Array.isArray(value.previews) && value.previews.length <= 10_000;
  if (value.action === "renameShipment") return hasText(value, "shipmentId") && hasText(value, "name") && hasText(value, "now");
  if (value.action === "updateShipmentStatus") return hasText(value, "shipmentId") && hasText(value, "status") && hasText(value, "now");
  if (value.action === "updateShipmentGeneration") return hasText(value, "shipmentId") && isObject(value.generation) && hasText(value, "now");
  if (value.action === "deleteShipment") return hasText(value, "shipmentId") && hasText(value, "deletedAt");
  return false;
}
