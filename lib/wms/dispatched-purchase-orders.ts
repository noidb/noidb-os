import type { PickingWave, PickingWaveItem, PickingWaveSourceRef } from "./picking-wave/types";
import type { PickingWaveStoreSnapshot } from "./picking-wave/shared-store-types";
import {
  packingDispatchedShipmentNumbers,
  packingShipmentManifestKeys,
  packingShipmentPurchaseOrders,
  type PackingProgress,
} from "./packing-progress";

type DispatchSnapshot = Pick<PickingWaveStoreSnapshot, "waves" | "items" | "outboundWorkStates" | "packingProgress">;

/** A PO number alone is not an identity: a rescheduled or changed order remains work. */
export interface DispatchedPurchaseOrderIdentity {
  purchaseOrderNumber: string;
  expectedDate: string;
  fulfillmentCenter: string;
  /** Sorted SKU, barcode, and original requested quantity; basket numbers are wave-local. */
  requestedItems: [string, string, number][];
  identityKey: string;
}

export interface DispatchedPurchaseOrderEvidence extends DispatchedPurchaseOrderIdentity {
  waveId: string;
  completedAt: string;
  source: "manual" | "packing";
  shipmentNumbers: string[];
}

export type DispatchedPurchaseOrderIndex = Map<string, DispatchedPurchaseOrderEvidence[]>;

export interface WaveDispatchedPurchaseOrderProjection {
  /** One newest matching external-wave completion per PO, in the target wave's PO order. */
  completed: DispatchedPurchaseOrderEvidence[];
  completedPurchaseOrderNumbers: string[];
  remainingPurchaseOrderNumbers: string[];
}

function timestamp(value: string | undefined): number {
  return value ? Date.parse(value) : Number.NaN;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function shippingIdentity(wave: PickingWave, source: PickingWaveSourceRef): [string, string] | null {
  const candidates: [string, string][] = [];
  if (source.shippingGroupKey) {
    const parts = source.shippingGroupKey.split("\u0000");
    if (parts.length !== 2) return null;
    candidates.push([text(parts[0]), text(parts[1])]);
  }
  for (const group of wave.shippingGroups || []) {
    if (group.purchaseOrderNumbers.includes(source.purchaseOrderNumber)) {
      candidates.push([text(group.expectedDate), text(group.fulfillmentCenter)]);
    }
  }
  if (!candidates.length) return null;
  const [date, center] = candidates[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(timestamp(date)) || !center || center === "물류센터 미정") return null;
  if (candidates.some(candidate => candidate[0] !== date || candidate[1] !== center)) return null;
  return [date, center];
}

/** Read-only identity from original sources; picked/shortage quantities do not redefine an order. */
export function dispatchedPurchaseOrderIdentity(wave: PickingWave, items: PickingWaveItem[], purchaseOrderNumber: string): DispatchedPurchaseOrderIdentity | null {
  if (!wave.sourcePurchaseOrderNumbers.includes(purchaseOrderNumber) || !text(purchaseOrderNumber)) return null;
  let shipping: [string, string] | null = null;
  const quantities = new Map<string, [string, string, number]>();
  for (const item of items) {
    if (item.waveId !== wave.id) continue;
    for (const source of item.sources) {
      if (source.purchaseOrderNumber !== purchaseOrderNumber) continue;
      const candidate = shippingIdentity(wave, source);
      const sku = text(item.productCode), barcode = text(item.barcode);
      if (!candidate || !sku || !Number.isSafeInteger(source.requestedQuantity) || source.requestedQuantity <= 0) return null;
      if (shipping && (shipping[0] !== candidate[0] || shipping[1] !== candidate[1])) return null;
      shipping = candidate;
      const key = JSON.stringify([sku, barcode]);
      const quantity = (quantities.get(key)?.[2] || 0) + source.requestedQuantity;
      if (!Number.isSafeInteger(quantity)) return null;
      quantities.set(key, [sku, barcode, quantity]);
    }
  }
  if (!shipping || !quantities.size) return null;
  const requestedItems = [...quantities.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value);
  return {
    purchaseOrderNumber,
    expectedDate: shipping[0],
    fulfillmentCenter: shipping[1],
    requestedItems,
    identityKey: JSON.stringify([purchaseOrderNumber, ...shipping, requestedItems]),
  };
}

/** A confirmed shortage is handled by the later re-order workflow. The dispatched
 * manifest must cover this PO's entire committed fulfillment, not an arbitrary subset. */
function fulfilledPurchaseOrderItems(wave: PickingWave, items: PickingWaveItem[], purchaseOrderNumber: string): [string, string, number][] | null {
  const quantities = new Map<string, [string, string, number]>();
  for (const item of items) {
    if (item.waveId !== wave.id) continue;
    for (const source of item.sources) {
      if (source.purchaseOrderNumber !== purchaseOrderNumber) continue;
      if (item.status === "pending") return null;
      const allocations = item.allocations.filter(allocation => allocation.purchaseOrderNumber === purchaseOrderNumber && allocation.basketNumber === source.basketNumber);
      if (allocations.length > 1) return null;
      const allocation = allocations[0];
      if (!allocation && item.status !== "full") return null;
      const fulfilled = allocation?.fulfilledQuantity ?? source.requestedQuantity;
      if (!Number.isSafeInteger(fulfilled) || fulfilled < 0 || fulfilled > source.requestedQuantity) return null;
      if (allocation && (allocation.requestedQuantity !== source.requestedQuantity || !Number.isSafeInteger(allocation.shortageQuantity)
        || allocation.shortageQuantity < 0 || fulfilled + allocation.shortageQuantity !== source.requestedQuantity)) return null;
      if (!fulfilled) continue;
      const sku = text(item.productCode), barcode = text(item.barcode), key = JSON.stringify([sku, barcode]);
      const quantity = (quantities.get(key)?.[2] || 0) + fulfilled;
      if (!Number.isSafeInteger(quantity)) return null;
      quantities.set(key, [sku, barcode, quantity]);
    }
  }
  return quantities.size ? [...quantities.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value) : null;
}

/** Stored manifests preserve completed centers even when the latest packing page shows another one. */
function dispatchedManifestItems(progress: PackingProgress, shipmentNumber: string, purchaseOrderNumber: string): [string, string, number][] | null {
  const manifest = { ...(progress.shipmentManifestKeys || {}), ...packingShipmentManifestKeys(progress.rows) }[shipmentNumber];
  if (!manifest) return null;
  try {
    const parts: unknown = JSON.parse(manifest);
    if (!Array.isArray(parts) || !parts.length) return null;
    const quantities = new Map<string, [string, string, number]>();
    for (const part of parts) {
      if (typeof part !== "string") return null;
      const row: unknown = JSON.parse(part);
      if (!Array.isArray(row) || row.length !== 4 || typeof row[0] !== "string" || typeof row[1] !== "string" || typeof row[2] !== "string" || !Number.isSafeInteger(row[3]) || row[3] <= 0) return null;
      if (row[0] !== purchaseOrderNumber) continue;
      const sku = text(row[1]), barcode = text(row[2]);
      if (!sku) return null;
      const key = JSON.stringify([sku, barcode]);
      const quantity = (quantities.get(key)?.[2] || 0) + row[3];
      if (!Number.isSafeInteger(quantity)) return null;
      quantities.set(key, [sku, barcode, quantity]);
    }
    return quantities.size ? [...quantities.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value) : null;
  } catch {
    return null;
  }
}

/** Build completion evidence without altering waves, picking rows, or their output generation keys. */
export function buildDispatchedPurchaseOrderIndex(snapshot: DispatchSnapshot): DispatchedPurchaseOrderIndex {
  const index: DispatchedPurchaseOrderIndex = new Map();
  const itemsByWave = new Map<string, PickingWaveItem[]>();
  for (const item of snapshot.items) {
    const items = itemsByWave.get(item.waveId) || [];
    items.push(item);
    itemsByWave.set(item.waveId, items);
  }
  for (const wave of snapshot.waves) {
    const state = snapshot.outboundWorkStates?.[wave.id];
    const manual = state?.status === "completed" && state.source !== "packing" && Number.isFinite(timestamp(state.updatedAt));
    const progress = snapshot.packingProgress?.[wave.id];
    const packingTime = timestamp(progress?.updatedAt);
    // Restoring a work item explicitly revokes its older automatic completion.
    const restoredAfterPacking = state?.status === "active" && timestamp(state.updatedAt) >= packingTime;
    const dispatched = new Set(!restoredAfterPacking && Number.isFinite(packingTime) ? packingDispatchedShipmentNumbers(wave, progress) : []);
    const members = progress && dispatched.size ? packingShipmentPurchaseOrders(progress) : {};
    if (!manual && !dispatched.size) continue;
    for (const po of new Set(wave.sourcePurchaseOrderNumbers)) {
      const identity = dispatchedPurchaseOrderIdentity(wave, itemsByWave.get(wave.id) || [], po);
      if (!identity) continue;
      let evidence: DispatchedPurchaseOrderEvidence | null = null;
      if (manual && state!.purchaseOrderNumbers && !state!.purchaseOrderNumbers.includes(po)) continue;
      if (manual) {
        // This is the user's explicit confirmation that the actual parcels were handed over.
        // A shortage remains a separate later re-order task, not an unshipped copy of this PO.
        evidence = { ...identity, waveId: wave.id, completedAt: state!.updatedAt, source: "manual", shipmentNumbers: [] };
      } else if (progress) {
        const shipments = Object.entries(members).filter(([, pos]) => pos.includes(po)).map(([number]) => number);
        // A partial or ambiguously split dispatch is insufficient to suppress a whole PO elsewhere.
        if (shipments.length !== 1 || !dispatched.has(shipments[0])) continue;
        const actual = dispatchedManifestItems(progress, shipments[0], po);
        const fulfilled = fulfilledPurchaseOrderItems(wave, itemsByWave.get(wave.id) || [], po);
        if (!actual || !fulfilled || JSON.stringify(actual) !== JSON.stringify(fulfilled)) continue;
        evidence = { ...identity, waveId: wave.id, completedAt: progress.updatedAt, source: "packing", shipmentNumbers: shipments };
      }
      if (evidence) index.set(po, [...(index.get(po) || []), evidence]);
    }
  }
  for (const evidence of index.values()) evidence.sort((a, b) => timestamp(b.completedAt) - timestamp(a.completedAt) || a.waveId.localeCompare(b.waveId));
  return index;
}

/** Only external matching completions are projected away. The original completed work stays in history. */
export function projectWaveDispatchedPurchaseOrders(snapshot: DispatchSnapshot, waveId: string, index = buildDispatchedPurchaseOrderIndex(snapshot)): WaveDispatchedPurchaseOrderProjection {
  const wave = snapshot.waves.find(candidate => candidate.id === waveId);
  const purchaseOrders = [...new Set(wave?.sourcePurchaseOrderNumbers || [])];
  const unchanged = (): WaveDispatchedPurchaseOrderProjection => ({ completed: [], completedPurchaseOrderNumbers: [], remainingPurchaseOrderNumbers: purchaseOrders });
  if (!wave) return unchanged();
  const state = snapshot.outboundWorkStates?.[waveId];
  const ownComplete = purchaseOrders.length > 0 && purchaseOrders.every(po => index.get(po)?.some(evidence => evidence.waveId === waveId));
  if (state?.status === "archived" || (state?.status === "completed" && state.source !== "packing") || ownComplete) return unchanged();
  const items = snapshot.items.filter(item => item.waveId === waveId);
  const completed: DispatchedPurchaseOrderEvidence[] = [];
  for (const po of purchaseOrders) {
    const identity = dispatchedPurchaseOrderIdentity(wave, items, po);
    if (!identity) continue;
    const evidence = index.get(po)?.find(candidate => candidate.waveId !== waveId
      && candidate.identityKey === identity.identityKey
      && !(state?.status === "active" && timestamp(state.updatedAt) >= timestamp(candidate.completedAt)));
    if (evidence) completed.push(evidence);
  }
  const excluded = new Set(completed.map(evidence => evidence.purchaseOrderNumber));
  return { completed, completedPurchaseOrderNumbers: [...excluded], remainingPurchaseOrderNumbers: purchaseOrders.filter(po => !excluded.has(po)) };
}
