import type { PickingWaveStoreMutation, PickingWaveStoreSnapshot } from "./picking-wave/shared-store-types";
import type { BasketAssignment, PickingAllocationResult, PickingWave, PickingWaveItem, PickingWaveSourceRef } from "./picking-wave/types";
import { projectWaveDispatchedPurchaseOrders } from "./dispatched-purchase-orders";

type WorkScope = { excludedPurchaseOrderNumbers: string[]; sourceRevision: number };
const sourceKey = (row: Pick<PickingWaveSourceRef, "purchaseOrderNumber" | "basketNumber">) => JSON.stringify([row.purchaseOrderNumber, row.basketNumber]);
const uniqueSorted = (values: readonly string[]) => [...new Set(values)].sort();
const sameSet = (left: readonly string[], right: readonly string[]) => JSON.stringify(uniqueSorted(left)) === JSON.stringify(uniqueSorted(right));
const stale = () => new Error("출고완료된 발주 또는 피킹 원본이 변경되었습니다. 새로고침 후 다시 처리해 주세요.");
const sumRequested = (sources: PickingWaveSourceRef[]) => sources.reduce((sum, source) => sum + source.requestedQuantity, 0);

function validAllocations(item: PickingWaveItem): Map<string, PickingAllocationResult> {
  const sources = new Map(item.sources.map(source => [sourceKey(source), source]));
  const found = new Map<string, PickingAllocationResult>();
  for (const allocation of item.allocations) {
    const key = sourceKey(allocation), source = sources.get(key);
    if (!source || found.has(key) || allocation.requestedQuantity !== source.requestedQuantity
      || !Number.isSafeInteger(allocation.fulfilledQuantity) || allocation.fulfilledQuantity < 0 || allocation.fulfilledQuantity > source.requestedQuantity
      || allocation.shortageQuantity !== source.requestedQuantity - allocation.fulfilledQuantity) throw stale();
    found.set(key, allocation);
  }
  return found;
}

/** A pending aggregate never means every unallocated PO was found or missing. */
function projectedQuantities(item: PickingWaveItem, sources: PickingWaveSourceRef[]) {
  const totalQuantity = sumRequested(sources);
  if (!sources.length) return { totalQuantity: 0, pickedQuantity: 0, shortageQuantity: 0, status: "pending" as const };
  const allocations = validAllocations(item);
  const unresolved = item.sources.filter(source => !allocations.has(sourceKey(source)));
  const unresolvedTotal = sumRequested(unresolved);
  const knownPicked = [...allocations.values()].reduce((sum, row) => sum + row.fulfilledQuantity, 0);
  const residualPicked = item.pickedQuantity - knownPicked;
  let pickedQuantity = 0, unknown = false;
  for (const source of sources) {
    const allocated = allocations.get(sourceKey(source));
    if (allocated) pickedQuantity += allocated.fulfilledQuantity;
    else if (item.status === "full" || unresolvedTotal > 0 && residualPicked === unresolvedTotal) pickedQuantity += source.requestedQuantity;
    else if (item.status === "notfound" || item.status !== "pending" && residualPicked === 0) continue;
    else unknown = true;
  }
  if (unknown) return { totalQuantity, pickedQuantity, shortageQuantity: 0, status: "pending" as const };
  const shortageQuantity = totalQuantity - pickedQuantity;
  return { totalQuantity, pickedQuantity, shortageQuantity,
    status: pickedQuantity === totalQuantity ? "full" as const : pickedQuantity === 0 ? "notfound" as const : "partial" as const };
}

export interface ActivePickingWork {
  wave: PickingWave | null;
  items: PickingWaveItem[];
  baskets: BasketAssignment[];
  excludedPurchaseOrderNumbers: string[];
  fullyCompletedElsewhere: boolean;
}

/** The raw snapshot and its object graph are never changed or written back. */
export function projectActivePickingWork(snapshot: PickingWaveStoreSnapshot, waveId: string): ActivePickingWork {
  const rawWave = snapshot.waves.find(wave => wave.id === waveId) || null;
  const rawItems = snapshot.items.filter(item => item.waveId === waveId);
  const rawBaskets = snapshot.baskets.filter(basket => basket.waveId === waveId);
  if (!rawWave) return { wave: null, items: rawItems, baskets: rawBaskets, excludedPurchaseOrderNumbers: [], fullyCompletedElsewhere: false };
  const projection = projectWaveDispatchedPurchaseOrders(snapshot, waveId);
  const excludedPurchaseOrderNumbers = uniqueSorted(projection.completedPurchaseOrderNumbers);
  if (!excludedPurchaseOrderNumbers.length) return { wave: rawWave, items: rawItems, baskets: rawBaskets, excludedPurchaseOrderNumbers, fullyCompletedElsewhere: false };
  const excluded = new Set(excludedPurchaseOrderNumbers);
  const scope: WorkScope = { excludedPurchaseOrderNumbers, sourceRevision: snapshot.revision };
  const items = rawItems.flatMap(item => {
    const sources = item.sources.filter(source => !excluded.has(source.purchaseOrderNumber));
    if (!sources.length) return [];
    const keys = new Set(sources.map(sourceKey));
    const quantities = sources.length === item.sources.length
      ? { totalQuantity: item.totalQuantity, pickedQuantity: item.pickedQuantity, shortageQuantity: item.shortageQuantity, status: item.status }
      : projectedQuantities(item, sources);
    return [{ ...item, ...quantities, sources, allocations: item.allocations.filter(row => keys.has(sourceKey(row))), workScope: scope }];
  });
  const wave: PickingWave = {
    ...rawWave, sourcePurchaseOrderNumbers: rawWave.sourcePurchaseOrderNumbers.filter(po => !excluded.has(po)),
    ...(rawWave.shippingGroups ? { shippingGroups: rawWave.shippingGroups.map(group => ({ ...group, purchaseOrderNumbers: group.purchaseOrderNumbers.filter(po => !excluded.has(po)) })).filter(group => group.purchaseOrderNumbers.length) } : {}),
    workScope: scope,
  };
  return { wave, items, baskets: rawBaskets.filter(basket => !excluded.has(basket.purchaseOrderNumber)), excludedPurchaseOrderNumbers, fullyCompletedElsewhere: wave.sourcePurchaseOrderNumbers.length === 0 };
}

function assertScope(snapshot: PickingWaveStoreSnapshot, waveId: string, scope: WorkScope, current?: ActivePickingWork): ActivePickingWork {
  if (!scope || !Number.isSafeInteger(scope.sourceRevision) || scope.sourceRevision < 0 || scope.sourceRevision > snapshot.revision
    || !Array.isArray(scope.excludedPurchaseOrderNumbers) || scope.excludedPurchaseOrderNumbers.some(po => typeof po !== "string")
    || uniqueSorted(scope.excludedPurchaseOrderNumbers).length !== scope.excludedPurchaseOrderNumbers.length) throw stale();
  const active = current || projectActivePickingWork(snapshot, waveId);
  if (!active.wave || active.wave.id !== waveId || !sameSet(scope.excludedPurchaseOrderNumbers, active.excludedPurchaseOrderNumbers)) throw stale();
  return active;
}
function stripScope<T extends { workScope?: WorkScope }>(value: T): T {
  const { workScope: _scope, ...raw } = value;
  return raw as T;
}
function itemOperationKey(item: PickingWaveItem): string {
  return JSON.stringify([item.status, item.totalQuantity, item.pickedQuantity, item.shortageQuantity, item.sources, item.allocations]);
}
function sourceIdentity(sources: PickingWaveSourceRef[]): string {
  return JSON.stringify([...sources].sort((a,b) => sourceKey(a).localeCompare(sourceKey(b))).map(source => [source.purchaseOrderNumber, source.basketNumber, source.requestedQuantity, source.shippingGroupKey || ""]));
}

function mergeItem(snapshot: PickingWaveStoreSnapshot, incoming: PickingWaveItem, inheritedScope?: WorkScope, current?: ActivePickingWork): PickingWaveItem {
  const raw = snapshot.items.find(item => item.id === incoming.id && item.waveId === incoming.waveId);
  const scope = incoming.workScope || inheritedScope;
  if (!raw) {
    if (scope || (current || projectActivePickingWork(snapshot, incoming.waveId)).excludedPurchaseOrderNumbers.length) throw stale();
    return incoming;
  }
  if (!scope) {
    const active = current || projectActivePickingWork(snapshot, incoming.waveId);
    if (active.excludedPurchaseOrderNumbers.length && itemOperationKey(raw) !== itemOperationKey(incoming)) throw stale();
    return incoming;
  }
  const active = assertScope(snapshot, incoming.waveId, scope, current);
  const shown = active.items.find(item => item.id === incoming.id);
  if (!shown || incoming.productCode !== raw.productCode || sourceIdentity(incoming.sources) !== sourceIdentity(shown.sources)
    || incoming.totalQuantity !== shown.totalQuantity) throw stale();
  validAllocations(incoming);
  const stripped = stripScope(incoming);
  const excluded = new Set(active.excludedPurchaseOrderNumbers);
  const excludedSources = raw.sources.filter(source => excluded.has(source.purchaseOrderNumber));
  if (!excludedSources.length) return stripped;
  const excludedKeys = new Set(excludedSources.map(sourceKey));
  const activeAllocations = incoming.allocations;
  const allocations = [...raw.allocations.filter(row => excludedKeys.has(sourceKey(row))), ...activeAllocations];
  const excludedQuantities = projectedQuantities(raw, excludedSources);
  const pickedQuantity = excludedQuantities.pickedQuantity + incoming.pickedQuantity;
  const shortageQuantity = excludedQuantities.shortageQuantity + incoming.shortageQuantity;
  const totalQuantity = sumRequested(raw.sources);
  const status = excludedQuantities.status === "pending" || incoming.status === "pending" ? "pending"
    : pickedQuantity === totalQuantity ? "full" : pickedQuantity === 0 ? "notfound" : "partial";
  return { ...stripped, sources: raw.sources, allocations, totalQuantity, pickedQuantity, shortageQuantity, status };
}

function assertOutputGenerationScope(raw: PickingWave, incoming: PickingWave, excludedPurchaseOrderNumbers: string[]): void {
  if (!excludedPurchaseOrderNumbers.length) return;
  const excluded = new Set(excludedPurchaseOrderNumbers);
  const saved = new Map((raw.outputGenerations || []).map(generation => [generation.generationId, generation]));
  for (const generation of incoming.outputGenerations || []) {
    if (!generation.purchaseOrderNumbers.some(po => excluded.has(po))) continue;
    const original = saved.get(generation.generationId);
    // An existing physical output may be retained, but excluded POs cannot enter a new output or a reused generation ID.
    if (!original || !sameSet(original.purchaseOrderNumbers, generation.purchaseOrderNumbers)) throw stale();
  }
}

function mergeWave(snapshot: PickingWaveStoreSnapshot, incoming: PickingWave, current?: ActivePickingWork): PickingWave {
  const raw = snapshot.waves.find(wave => wave.id === incoming.id);
  if (!raw) {
    if (incoming.workScope) throw stale();
    return incoming;
  }
  const currentActive = current || projectActivePickingWork(snapshot, incoming.id);
  assertOutputGenerationScope(raw, incoming, currentActive.excludedPurchaseOrderNumbers);
  if (!incoming.workScope) {
    const active = currentActive;
    if (active.excludedPurchaseOrderNumbers.length && (!sameSet(incoming.sourcePurchaseOrderNumbers, raw.sourcePurchaseOrderNumbers)
      || incoming.status !== raw.status || incoming.completedAt !== raw.completedAt || incoming.resultConfirmedAt !== raw.resultConfirmedAt
      || incoming.orderConfirmedAt !== raw.orderConfirmedAt || incoming.integratedPickingCompletedAt !== raw.integratedPickingCompletedAt)) throw stale();
    return incoming;
  }
  const active = assertScope(snapshot, incoming.id, incoming.workScope, currentActive);
  if (!sameSet(incoming.sourcePurchaseOrderNumbers, active.wave!.sourcePurchaseOrderNumbers)) throw stale();
  // Generation files retain their original PO membership. Source reconstruction must never edit a physical document's identity.
  const excluded = new Set(active.excludedPurchaseOrderNumbers);
  const generations = new Map((raw.outputGenerations || []).map(generation => [generation.generationId, generation]));
  const savedGenerationIds = new Set(generations.keys());
  const incomingGenerations = new Map((incoming.outputGenerations || []).map(generation => [generation.generationId, generation]));
  const activePurchaseOrders = new Set(active.wave!.sourcePurchaseOrderNumbers);
  for (const generation of incoming.outputGenerations || []) {
    const original = generations.get(generation.generationId);
    if (original?.purchaseOrderNumbers.some(po => excluded.has(po))) {
      const replacement = generation.supersededByGenerationId ? incomingGenerations.get(generation.supersededByGenerationId) : undefined;
      if (replacement && !savedGenerationIds.has(replacement.generationId) && replacement.waveId === incoming.id
        && !replacement.supersededByGenerationId && replacement.purchaseOrderNumbers.length > 0
        && replacement.purchaseOrderNumbers.every(po => activePurchaseOrders.has(po))
        && replacement.purchaseOrderNumbers.some(po => original.purchaseOrderNumbers.includes(po))) {
        generations.set(original.generationId, { ...original, supersededByGenerationId: replacement.generationId, updatedAt: generation.updatedAt });
      }
      continue;
    }
    generations.set(generation.generationId, generation);
  }
  return { ...stripScope(incoming), sourcePurchaseOrderNumbers: raw.sourcePurchaseOrderNumbers,
    ...(raw.shippingGroups ? { shippingGroups: raw.shippingGroups } : {}),
    ...(raw.outputGenerations || incoming.outputGenerations ? { outputGenerations: [...generations.values()] } : {}) };
}

/** Merge only the active portion of scoped edits into the latest raw source.
 * Unscoped old clients may update metadata, but cannot re-pick newly completed POs. */
export function mergeActivePickingWorkMutation(snapshot: PickingWaveStoreSnapshot, mutation: PickingWaveStoreMutation): PickingWaveStoreMutation {
  if (mutation.action === "migrate" && ((mutation.snapshot.waves || []).some(wave => wave.workScope !== undefined)
    || (mutation.snapshot.items || []).some(item => item.workScope !== undefined))) throw stale();
  if (mutation.action === "saveWave") {
    const active = projectActivePickingWork(snapshot, mutation.wave.id);
    return { ...mutation, wave: mergeWave(snapshot, mutation.wave, active) };
  }
  if (mutation.action === "saveItem") {
    const active = projectActivePickingWork(snapshot, mutation.item.waveId);
    return { ...mutation, item: mergeItem(snapshot, mutation.item, undefined, active) };
  }
  if (mutation.action === "saveProgress") {
    if (mutation.items.some(item => item.waveId !== mutation.wave.id)) throw stale();
    const scope = mutation.wave.workScope;
    const active = projectActivePickingWork(snapshot, mutation.wave.id);
    return { ...mutation, wave: mergeWave(snapshot, mutation.wave, active), items: mutation.items.map(item => mergeItem(snapshot, item, scope, active)) };
  }
  return mutation;
}
