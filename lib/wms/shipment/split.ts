import type { BasketAssignment, PickingWave, PickingWaveItem } from "../picking-wave/types";
import type { Shipment, ShipmentPurchaseOrder, ShipmentSplitPreview } from "./types";

const COMPLETED_WAVE_STATUSES = new Set(["completed", "result_confirmed", "order_confirmed"]);

export interface ShipmentCandidate extends ShipmentPurchaseOrder {
  alreadyAssignedShipmentId?: string;
  sourceConflict?: boolean;
}
function logisticsForPo(wave: PickingWave, basket: BasketAssignment, purchaseOrderNumber: string) {
  const shippingGroup = wave.shippingGroups?.find(group => group.purchaseOrderNumbers.includes(purchaseOrderNumber));
  return {
    fulfillmentCenter: basket.fulfillmentCenter || shippingGroup?.fulfillmentCenter || "",
    expectedDate: shippingGroup?.expectedDate || "",
  };
}

/**
 * 완료 웨이브를 읽기만 하며 피킹 데이터를 수정하지 않는다. 수량은 확정 allocations를 우선하고,
 * 과거 전량완료 데이터에 allocations가 없을 때만 해당 발주서 원 요청수량을 사용한다.
 */
export function buildShipmentCandidates(
  waves: readonly PickingWave[],
  itemsByWave: ReadonlyMap<string, readonly PickingWaveItem[]>,
  basketsByWave: ReadonlyMap<string, readonly BasketAssignment[]>,
  shipments: readonly Shipment[]
): ShipmentCandidate[] {
  const assigned = new Map<string, string>();
  for (const shipment of shipments) {
    for (const order of shipment.purchaseOrders) assigned.set(order.purchaseOrderNumber, shipment.id);
  }

  const candidates: ShipmentCandidate[] = [];
  const seen = new Set<string>();
  const conflicts = new Set<string>();

  for (const wave of waves) {
    if (!COMPLETED_WAVE_STATUSES.has(wave.status)) continue;
    const items = itemsByWave.get(wave.id) ?? [];
    const baskets = basketsByWave.get(wave.id) ?? [];
    const basketByPo = new Map(baskets.map(basket => [basket.purchaseOrderNumber, basket]));

    for (const purchaseOrderNumber of wave.sourcePurchaseOrderNumbers) {
      const basket = basketByPo.get(purchaseOrderNumber);
      if (!basket) continue;
      if (seen.has(purchaseOrderNumber)) conflicts.add(purchaseOrderNumber);
      seen.add(purchaseOrderNumber);

      let skuCount = 0;
      let totalQuantity = 0;
      for (const item of items) {
        const source = item.sources.find(entry => entry.purchaseOrderNumber === purchaseOrderNumber);
        if (!source) continue;
        const allocation = item.allocations.find(entry => entry.purchaseOrderNumber === purchaseOrderNumber);
        const fulfilledQuantity = allocation?.fulfilledQuantity ?? (item.status === "full" ? source.requestedQuantity : 0);
        if (fulfilledQuantity > 0) skuCount += 1;
        totalQuantity += fulfilledQuantity;
      }
      const logistics = logisticsForPo(wave, basket, purchaseOrderNumber);
      candidates.push({
        purchaseOrderNumber,
        sourceWaveId: wave.id,
        basketNumber: basket.basketNumber,
        fulfillmentCenter: logistics.fulfillmentCenter,
        expectedDate: logistics.expectedDate,
        skuCount,
        totalQuantity,
        pickingCompletedAt: wave.completedAt || wave.updatedAt,
        alreadyAssignedShipmentId: assigned.get(purchaseOrderNumber),
      });
    }
  }

  return candidates
    .map(candidate => ({ ...candidate, sourceConflict: conflicts.has(candidate.purchaseOrderNumber) }))
    .sort((left, right) =>
      left.expectedDate.localeCompare(right.expectedDate) ||
      left.fulfillmentCenter.localeCompare(right.fulfillmentCenter, "ko") ||
      left.purchaseOrderNumber.localeCompare(right.purchaseOrderNumber)
    );
}

export function previewShipmentSplit(
  selected: readonly ShipmentPurchaseOrder[],
  maxTotalQuantity: number
): ShipmentSplitPreview[] {
  if (!Number.isInteger(maxTotalQuantity) || maxTotalQuantity < 1) {
    throw new Error("Shipment 최대수량은 1 이상의 정수여야 합니다.");
  }
  const duplicateCheck = new Set<string>();
  for (const order of selected) {
    if (duplicateCheck.has(order.purchaseOrderNumber)) throw new Error(`발주서 ${order.purchaseOrderNumber}가 중복 선택됐습니다.`);
    duplicateCheck.add(order.purchaseOrderNumber);
    if (!order.fulfillmentCenter || !order.expectedDate) throw new Error(`발주서 ${order.purchaseOrderNumber}의 물류센터 또는 입고예정일이 없습니다.`);
    if (!Number.isFinite(order.totalQuantity) || order.totalQuantity <= 0) throw new Error(`발주서 ${order.purchaseOrderNumber}의 총수량이 올바르지 않습니다.`);
  }

  const groups = new Map<string, ShipmentPurchaseOrder[]>();
  for (const order of selected) {
    const key = `${order.fulfillmentCenter}\u0000${order.expectedDate}`;
    groups.set(key, [...(groups.get(key) ?? []), order]);
  }

  const previews: ShipmentSplitPreview[] = [];
  const appendPreview = (chunk: ShipmentPurchaseOrder[], manualReviewRequired = false) => {
    if (!chunk.length) return;
    const sequence = previews.length + 1;
    previews.push({
      sequence,
      suggestedName: `Shipment ${sequence} · ${chunk[0].fulfillmentCenter} · ${chunk[0].expectedDate}`,
      fulfillmentCenter: chunk[0].fulfillmentCenter,
      expectedDate: chunk[0].expectedDate,
      purchaseOrders: chunk,
      purchaseOrderCount: chunk.length,
      skuCount: chunk.reduce((sum, order) => sum + order.skuCount, 0),
      totalQuantity: chunk.reduce((sum, order) => sum + order.totalQuantity, 0),
      firstPurchaseOrderNumber: chunk[0].purchaseOrderNumber,
      lastPurchaseOrderNumber: chunk[chunk.length - 1].purchaseOrderNumber,
      manualReviewRequired,
    });
  };
  for (const orders of groups.values()) {
    const sorted = [...orders].sort((a, b) => a.purchaseOrderNumber.localeCompare(b.purchaseOrderNumber));
    let chunk: ShipmentPurchaseOrder[] = [];
    let chunkQuantity = 0;
    for (const order of sorted) {
      // 발주서는 배정의 최소 단위다. 단일 발주가 한도를 넘으면 별도 묶음으로 남겨
      // 수동 확인을 요구할 뿐, SKU 행을 자동 분할하지 않는다.
      if (order.totalQuantity > maxTotalQuantity) {
        appendPreview(chunk);
        chunk = [];
        chunkQuantity = 0;
        appendPreview([order], true);
        continue;
      }
      if (chunk.length > 0 && chunkQuantity + order.totalQuantity > maxTotalQuantity) {
        appendPreview(chunk);
        chunk = [];
        chunkQuantity = 0;
      }
      chunk.push(order);
      chunkQuantity += order.totalQuantity;
    }
    appendPreview(chunk);
  }
  return previews;
}
