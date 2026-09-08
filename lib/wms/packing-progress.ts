import type { PickingWave, PickingWaveItem } from "./picking-wave/types";

export interface PackingRow {
  key: string; shipmentNumber: string; purchaseOrderNumber: string; skuId: string; barcode: string; quantity: number;
}
export interface PackingProgress {
  generationKey: string; manifestKey: string; rows: PackingRow[]; checkedKeys: string[]; dispatchedShipmentNumbers?: string[]; updatedAt: string; dispatchedAt?: string;
  /** Validated Shipment membership survives switching between packing centers. */
  shipmentPurchaseOrders?: Record<string, string[]>;
  shipmentManifestKeys?: Record<string, string>;
}
export function packingGenerationKey(wave: PickingWave): string {
  return JSON.stringify((wave.outputGenerations || []).filter(g => !g.supersededByGenerationId).map(g => [g.generationId, g.purchaseOrderNumbers, g.shipmentFileName || "", g.invoiceGroups || []]).sort((a,b) => String(a[0]).localeCompare(String(b[0]))));
}
export function packingManifestKey(rows: PackingRow[]): string { return JSON.stringify(rows); }
export function validatePackingRows(wave: PickingWave, items: PickingWaveItem[], rows: PackingRow[]): void {
  if (!Array.isArray(rows) || !rows.length || rows.length > 50000) throw new Error("검수할 동봉내역서를 확인해 주세요.");
  const includedPurchaseOrders = new Set(rows.map(row => row.purchaseOrderNumber));
  const expected = new Map<string, { quantity: number; barcode: string }>();
  for (const item of items) for (const source of item.sources) {
    if (!includedPurchaseOrders.has(source.purchaseOrderNumber)) continue;
    const allocation = item.allocations.find(a => a.purchaseOrderNumber === source.purchaseOrderNumber && a.basketNumber === source.basketNumber);
    const quantity = allocation?.fulfilledQuantity ?? (item.status === "full" ? source.requestedQuantity : 0);
    if (quantity > 0) {
      const key = JSON.stringify([source.purchaseOrderNumber, item.productCode]);
      expected.set(key, { quantity: (expected.get(key)?.quantity || 0) + quantity, barcode: item.barcode });
    }
  }
  const keys = new Set<string>(); const actual = new Map<string, number>(); const poShipment = new Map<string,string>();
  for (const row of rows) {
    if (!row || typeof row.key !== "string" || !row.key || keys.has(row.key) || !/^\d{8}$/.test(row.shipmentNumber) || !Number.isInteger(row.quantity) || row.quantity <= 0) throw new Error("동봉내역서 행 중복 또는 수량 오류입니다.");
    keys.add(row.key);
    const key = JSON.stringify([row.purchaseOrderNumber,row.skuId]); const source = expected.get(key);
    if (!wave.sourcePurchaseOrderNumbers.includes(row.purchaseOrderNumber) || !source || row.barcode !== source.barcode) throw new Error("동봉내역서와 발주서 SKU·바코드가 일치하지 않습니다.");
    if (poShipment.has(row.purchaseOrderNumber) && poShipment.get(row.purchaseOrderNumber) !== row.shipmentNumber) throw new Error("같은 발주서가 여러 Shipment에 포함되어 있습니다.");
    poShipment.set(row.purchaseOrderNumber,row.shipmentNumber);
    actual.set(key,(actual.get(key)||0)+row.quantity);
  }
  if (actual.size !== expected.size || [...expected].some(([key,value]) => actual.get(key) !== value.quantity)) throw new Error("동봉내역서와 현재 피킹 분배 수량이 다릅니다. 확정 수량과 출력파일을 먼저 확인해 주세요.");
}
export function packingShipmentPurchaseOrders(progress: PackingProgress): Record<string, string[]> {
  const members = Object.fromEntries(Object.entries(progress.shipmentPurchaseOrders || {}).map(([number, pos]) => [number, [...pos]]));
  for (const row of progress.rows) members[row.shipmentNumber] = [...new Set([...(members[row.shipmentNumber] || []), row.purchaseOrderNumber])];
  return members;
}

export function packingShipmentManifestKeys(rows: PackingRow[]): Record<string, string> {
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const parts = grouped.get(row.shipmentNumber) || [];
    parts.push(JSON.stringify([row.purchaseOrderNumber, row.skuId, row.barcode, row.quantity]));
    grouped.set(row.shipmentNumber, parts);
  }
  return Object.fromEntries([...grouped].map(([number, parts]) => [number, JSON.stringify(parts.sort())]));
}

/** Compare content per Shipment, so viewing another center preserves its completed
 * neighbors while a changed quantity or SKU resets only the affected Shipment. */
export function packingDispatchedShipmentNumbers(wave: PickingWave, progress?: PackingProgress, rows: PackingRow[] = []): string[] {
  if (!progress || progress.generationKey !== packingGenerationKey(wave)) return [];
  const saved = { ...(progress.shipmentManifestKeys || {}), ...packingShipmentManifestKeys(progress.rows) };
  const current = packingShipmentManifestKeys(rows);
  const dispatched = progress.dispatchedShipmentNumbers || (progress.dispatchedAt ? Object.keys(packingShipmentPurchaseOrders(progress)) : []);
  return [...new Set(dispatched)].filter(number => !Object.hasOwn(current, number) || saved[number] === current[number]);
}

/** Completion requires every current PO to be linked to a Shipment explicitly dispatched. */
export function isPackingFullyDispatched(wave: PickingWave, progress?: PackingProgress): boolean {
  if (!progress || progress.generationKey !== packingGenerationKey(wave) || !wave.sourcePurchaseOrderNumbers.length) return false;
  const members = packingShipmentPurchaseOrders(progress);
  const dispatched = new Set(progress.dispatchedShipmentNumbers || (progress.dispatchedAt ? Object.keys(members) : []));
  return wave.sourcePurchaseOrderNumbers.every(po => {
    const shipments = Object.entries(members).filter(([, pos]) => pos.includes(po)).map(([number]) => number);
    return shipments.length > 0 && shipments.every(number => dispatched.has(number));
  });
}

export function nextPackingProgress(wave: PickingWave, items: PickingWaveItem[], prior: PackingProgress | undefined, input: { generationKey: string; rows: PackingRow[]; checkedKeys: string[]; dispatchedShipmentNumbers?: string[]; expectedUpdatedAt: string | null; dispatched: boolean }, now: string): PackingProgress {
  if ((prior?.updatedAt || null) !== input.expectedUpdatedAt) throw new Error("다른 기기에서 검수 기록이 변경되었습니다. 새로고침해 주세요.");
  if (packingGenerationKey(wave) !== input.generationKey) throw new Error("송장 또는 출력 대상이 변경되었습니다. 동봉내역서를 다시 불러와 주세요.");
  validatePackingRows(wave,items,input.rows);
  const manifestKey = packingManifestKey(input.rows);
  if (!Array.isArray(input.checkedKeys) || new Set(input.checkedKeys).size !== input.checkedKeys.length || input.checkedKeys.some(key => !input.rows.some(row => row.key === key))) throw new Error("검수 체크 대상을 확인해 주세요.");
  const shipmentNumbers = [...new Set(input.rows.map(row => row.shipmentNumber))];
  const sameGeneration = prior?.generationKey === input.generationKey;
  // A matching Shipment number in a regenerated file is not evidence of a new dispatch.
  const priorDispatched = packingDispatchedShipmentNumbers(wave, prior, input.rows);
  const dispatchedShipmentNumbers = input.dispatched
    ? [...new Set([...priorDispatched, ...shipmentNumbers])]
    : input.dispatchedShipmentNumbers || priorDispatched;
  const priorDispatchedShipments = new Set(priorDispatched);
  if (new Set(dispatchedShipmentNumbers).size !== dispatchedShipmentNumbers.length || dispatchedShipmentNumbers.some(shipmentNumber => !shipmentNumbers.includes(shipmentNumber) && !priorDispatchedShipments.has(shipmentNumber))) throw new Error("Shipment 출고상태를 확인해 주세요.");
  if (prior && (prior.manifestKey !== manifestKey || prior.generationKey !== input.generationKey) && input.checkedKeys.length && !input.dispatched) throw new Error("출력 내용이 바뀌었습니다. 변경된 목록의 검수를 처음부터 확인해 주세요.");
  if (input.dispatched && input.checkedKeys.length !== input.rows.length) throw new Error("모든 상품의 바코드 부착·박스 포장을 확인한 뒤 출고완료해 주세요.");
  const shipmentPurchaseOrders = sameGeneration ? packingShipmentPurchaseOrders(prior) : {};
  // A regenerated Shipment replaces the prior membership for these POs.
  const incomingPos = new Set(input.rows.map(row => row.purchaseOrderNumber));
  for (const number of Object.keys(shipmentPurchaseOrders)) {
    shipmentPurchaseOrders[number] = shipmentPurchaseOrders[number].filter(po => !incomingPos.has(po));
    if (!shipmentPurchaseOrders[number].length) delete shipmentPurchaseOrders[number];
  }
  for (const row of input.rows) shipmentPurchaseOrders[row.shipmentNumber] = [...new Set([...(shipmentPurchaseOrders[row.shipmentNumber] || []), row.purchaseOrderNumber])];
  const priorManifestKeys = sameGeneration ? { ...(prior.shipmentManifestKeys || {}), ...packingShipmentManifestKeys(prior.rows) } : {};
  const incomingManifestKeys = packingShipmentManifestKeys(input.rows);
  const changedManifest = Object.entries(incomingManifestKeys).some(([number, key]) => priorManifestKeys[number] !== key);
  const shipmentManifestKeys = { ...priorManifestKeys, ...incomingManifestKeys };
  for (const number of Object.keys(shipmentManifestKeys)) if (!shipmentPurchaseOrders[number]) delete shipmentManifestKeys[number];
  const progress: PackingProgress = { generationKey: input.generationKey, manifestKey, rows: input.rows, checkedKeys: input.checkedKeys, dispatchedShipmentNumbers, shipmentPurchaseOrders, shipmentManifestKeys, updatedAt: now };
  if (isPackingFullyDispatched(wave, progress)) progress.dispatchedAt = (sameGeneration && !changedManifest ? prior.dispatchedAt : undefined) || now;
  return progress;
}
