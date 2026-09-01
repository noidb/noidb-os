import type { PickingWave, PickingWaveItem } from "./types";

export interface ShippingCenterSummary {
  fulfillmentCenter: string;
  totalQuantity: number;
}

export interface ShippingDateSummary {
  expectedDate: string;
  centers: ShippingCenterSummary[];
}

function sourceShippingIdentity(wave: PickingWave, source: PickingWaveItem["sources"][number]): [string, string] {
  const separatorIndex = source.shippingGroupKey?.indexOf("\u0000") ?? -1;
  if (separatorIndex >= 0 && source.shippingGroupKey) {
    return [
      source.shippingGroupKey.slice(0, separatorIndex).trim() || "입고예정일 미정",
      source.shippingGroupKey.slice(separatorIndex + 1).trim() || "물류센터 미정",
    ];
  }
  const group = wave.shippingGroups?.find(candidate => candidate.purchaseOrderNumbers.includes(source.purchaseOrderNumber));
  return [group?.expectedDate.trim() || "입고예정일 미정", group?.fulfillmentCenter.trim() || "물류센터 미정"];
}

/** sources의 발주서별 원본 요청수량을 입고예정일+물류센터 단위로만 합산한다. */
export function summarizeShippingByDate(wave: PickingWave, items: PickingWaveItem[]): ShippingDateSummary[] {
  const quantityByDateCenter = new Map<string, number>();
  for (const item of items) {
    for (const source of item.sources) {
      const [expectedDate, fulfillmentCenter] = sourceShippingIdentity(wave, source);
      const key = `${expectedDate}\u0000${fulfillmentCenter}`;
      quantityByDateCenter.set(key, (quantityByDateCenter.get(key) || 0) + source.requestedQuantity);
    }
  }
  const centersByDate = new Map<string, ShippingCenterSummary[]>();
  for (const [key, totalQuantity] of quantityByDateCenter) {
    const separatorIndex = key.indexOf("\u0000");
    const expectedDate = key.slice(0, separatorIndex);
    const fulfillmentCenter = key.slice(separatorIndex + 1);
    centersByDate.set(expectedDate, [...(centersByDate.get(expectedDate) || []), { fulfillmentCenter, totalQuantity }]);
  }
  return Array.from(centersByDate, ([expectedDate, centers]) => ({
    expectedDate,
    centers: centers.sort((a, b) => a.fulfillmentCenter.localeCompare(b.fulfillmentCenter, "ko", { numeric: true })),
  })).sort((a, b) => {
    if (a.expectedDate === "입고예정일 미정") return 1;
    if (b.expectedDate === "입고예정일 미정") return -1;
    return a.expectedDate.localeCompare(b.expectedDate);
  });
}
