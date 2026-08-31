import type { BasketAssignment, PickingWave, PickingWaveItem } from "./types";
import type { PoConfirmationRecord } from "../po-confirm-state";
import type { VendorOrderDraft, VendorOrderDraftLine } from "../vendor-order/types";
import type { ModelLocation, Shelf, SkuLocation, WarehouseBox, WarehouseMigrationMapping, WarehouseZone } from "../types";

export interface PickingWaveStoreSnapshot {
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
  deletedWaveIds: Record<string, string>;
  deletedItemIds: Record<string, string>;
  deletedBasketKeys: Record<string, string>;
  deletedPoConfirmationNumbers: Record<string, string>;
  deletedVendorDraftIds: Record<string, string>;
  deletedVendorLineIds: Record<string, string>;
  deletedWarehouseSkuIds: Record<string, string>;
}

export type PickingWaveStoreMutation =
  | { action: "migrate"; snapshot: Partial<Pick<PickingWaveStoreSnapshot, "waves" | "items" | "baskets" | "poConfirmationRecords" | "vendorOrderDrafts" | "vendorOrderLines" | "warehouseZones" | "warehouseShelves" | "warehouseBoxes" | "warehouseModelLocations" | "warehouseSkuExceptions" | "warehouseMigrationMappings">> }
  | { action: "saveWave"; wave: PickingWave }
  | { action: "deleteWave"; waveId: string; deletedAt: string }
  | { action: "saveItem"; item: PickingWaveItem }
  | { action: "deleteItem"; itemId: string; deletedAt: string }
  | { action: "saveBasket"; basket: BasketAssignment }
  | { action: "deleteBasket"; waveId: string; basketNumber: string; deletedAt: string }
  | { action: "upsertPoConfirmationRecords"; records: PoConfirmationRecord[] }
  | { action: "clearPoConfirmationErrors"; poNumbers: string[]; waveId?: string; deletedAt: string }
  | { action: "saveVendorDraft"; draft: VendorOrderDraft }
  | { action: "deleteVendorDraft"; draftId: string; deletedAt: string }
  | { action: "saveVendorLine"; line: VendorOrderDraftLine }
  | { action: "deleteVendorLine"; lineId: string; deletedAt: string }
  | { action: "saveWarehouseZone"; zone: WarehouseZone }
  | { action: "saveWarehouseShelf"; shelf: Shelf }
  | { action: "saveWarehouseBox"; box: WarehouseBox }
  | { action: "saveWarehouseModelLocation"; location: ModelLocation }
  | { action: "saveWarehouseSkuException"; exception: SkuLocation }
  | { action: "deleteWarehouseSkuException"; skuId: string; deletedAt: string }
  | { action: "saveWarehouseMigrationMapping"; mapping: WarehouseMigrationMapping };

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
    warehouseZones: [],
    warehouseShelves: [],
    warehouseBoxes: [],
    warehouseModelLocations: [],
    warehouseSkuExceptions: [],
    warehouseMigrationMappings: [],
    deletedWaveIds: {},
    deletedItemIds: {},
    deletedBasketKeys: {},
    deletedPoConfirmationNumbers: {},
    deletedVendorDraftIds: {},
    deletedVendorLineIds: {},
    deletedWarehouseSkuIds: {},
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
  if (value.action === "migrate") {
    if (!isObject(value.snapshot)) return false;
    const arrays = Object.values(value.snapshot);
    return arrays.every(items => Array.isArray(items) && items.length <= 100_000);
  }
  if (value.action === "saveWave") return hasText(value.wave, "id") && hasText(value.wave, "updatedAt");
  if (value.action === "deleteWave") return hasText(value, "waveId") && hasText(value, "deletedAt");
  if (value.action === "saveItem") return hasText(value.item, "id") && hasText(value.item, "waveId") && hasText(value.item, "updatedAt");
  if (value.action === "deleteItem") return hasText(value, "itemId") && hasText(value, "deletedAt");
  if (value.action === "saveBasket") return hasText(value.basket, "waveId") && hasText(value.basket, "basketNumber") && hasText(value.basket, "updatedAt");
  if (value.action === "deleteBasket") return hasText(value, "waveId") && hasText(value, "basketNumber") && hasText(value, "deletedAt");
  if (value.action === "upsertPoConfirmationRecords") return Array.isArray(value.records) && value.records.length <= 10_000;
  if (value.action === "clearPoConfirmationErrors") return Array.isArray(value.poNumbers) && value.poNumbers.length <= 10_000 && hasText(value, "deletedAt");
  if (value.action === "saveVendorDraft") return hasText(value.draft, "id") && hasText(value.draft, "updatedAt");
  if (value.action === "deleteVendorDraft") return hasText(value, "draftId") && hasText(value, "deletedAt");
  if (value.action === "saveVendorLine") return hasText(value.line, "id") && hasText(value.line, "updatedAt");
  if (value.action === "deleteVendorLine") return hasText(value, "lineId") && hasText(value, "deletedAt");
  if (value.action === "saveWarehouseZone") return hasText(value.zone, "id");
  if (value.action === "saveWarehouseShelf") return hasText(value.shelf, "id");
  if (value.action === "saveWarehouseBox") return hasText(value.box, "id");
  if (value.action === "saveWarehouseModelLocation") return hasText(value.location, "modelName");
  if (value.action === "saveWarehouseSkuException") return hasText(value.exception, "skuId");
  if (value.action === "deleteWarehouseSkuException") return hasText(value, "skuId") && hasText(value, "deletedAt");
  if (value.action === "saveWarehouseMigrationMapping") return hasText(value.mapping, "id");
  return false;
}
