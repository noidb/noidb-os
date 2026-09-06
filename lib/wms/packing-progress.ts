import type { PickingWave, PickingWaveItem } from "./picking-wave/types";

export interface PackingRow {
  key: string; shipmentNumber: string; purchaseOrderNumber: string; skuId: string; barcode: string; quantity: number;
}
export interface PackingProgress {
  generationKey: string; manifestKey: string; rows: PackingRow[]; checkedKeys: string[]; dispatchedShipmentNumbers?: string[]; updatedAt: string; dispatchedAt?: string;
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
export function nextPackingProgress(wave: PickingWave, items: PickingWaveItem[], prior: PackingProgress | undefined, input: { generationKey: string; rows: PackingRow[]; checkedKeys: string[]; dispatchedShipmentNumbers?: string[]; expectedUpdatedAt: string | null; dispatched: boolean }, now: string): PackingProgress {
  if ((prior?.updatedAt || null) !== input.expectedUpdatedAt) throw new Error("다른 기기에서 검수 기록이 변경되었습니다. 새로고침해 주세요.");
  if (packingGenerationKey(wave) !== input.generationKey) throw new Error("송장 또는 출력 대상이 변경되었습니다. 동봉내역서를 다시 불러와 주세요.");
  validatePackingRows(wave,items,input.rows);
  const manifestKey = packingManifestKey(input.rows);
  if (prior?.dispatchedAt) throw new Error("이미 출고완료된 작업입니다. 기존 검수 기록을 보존합니다.");
  if (!Array.isArray(input.checkedKeys) || new Set(input.checkedKeys).size !== input.checkedKeys.length || input.checkedKeys.some(key => !input.rows.some(row => row.key === key))) throw new Error("검수 체크 대상을 확인해 주세요.");
  const shipmentNumbers = [...new Set(input.rows.map(row => row.shipmentNumber))];
  const dispatchedShipmentNumbers = input.dispatched
    ? shipmentNumbers
    : input.dispatchedShipmentNumbers || prior?.dispatchedShipmentNumbers || [];
  if (new Set(dispatchedShipmentNumbers).size !== dispatchedShipmentNumbers.length || dispatchedShipmentNumbers.some(shipmentNumber => !shipmentNumbers.includes(shipmentNumber))) throw new Error("Shipment 출고상태를 확인해 주세요.");
  if (prior && (prior.manifestKey !== manifestKey || prior.generationKey !== input.generationKey) && input.checkedKeys.length) throw new Error("출력 내용이 바뀌었습니다. 변경된 목록의 검수를 처음부터 확인해 주세요.");
  if (input.dispatched && input.checkedKeys.length !== input.rows.length) throw new Error("모든 상품의 바코드 부착·박스 포장을 확인한 뒤 출고완료해 주세요.");
  return { generationKey: input.generationKey, manifestKey, rows: input.rows, checkedKeys: input.checkedKeys, dispatchedShipmentNumbers, updatedAt: now, ...(input.dispatched ? { dispatchedAt: now } : {}) };
}
