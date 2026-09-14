import type { ShipmentOutputGeneration } from "./picking-wave/types";

interface ShippingGroupSummary {
  purchaseOrderNumbers: string[];
  fulfillmentCenter: string;
  expectedDate: string;
}

export interface PackingCenterTarget {
  key: string;
  generationIds: string[];
  label: string;
  complete: boolean;
}

export function buildPackingCenterTargets(
  generations: ShipmentOutputGeneration[],
  shippingGroups: ShippingGroupSummary[],
  shipmentNumbersByGeneration: Record<string, string[]>,
  dispatchedShipmentNumbers: Iterable<string>,
): PackingCenterTarget[] {
  const dispatched = new Set(dispatchedShipmentNumbers);
  const map = new Map<string, { centers: string[]; dates: string[]; ids: string[]; shipments: number }>();
  for (const generation of generations.filter(candidate => !candidate.supersededByGenerationId && candidate.status === "shipment_generated" && candidate.shipmentFileName)) {
    const poSet = new Set(generation.purchaseOrderNumbers);
    const matched = shippingGroups.filter(group => group.purchaseOrderNumbers.some(po => poSet.has(po)));
    const centers = [...new Set(matched.map(group => group.fulfillmentCenter))];
    const dates = [...new Set(matched.map(group => group.expectedDate))];
    const single = centers.length === 1 && dates.length === 1;
    const key = single ? `${dates[0]}\u0000${centers[0]}` : generation.generationId;
    const target = map.get(key) || { centers: [], dates: [], ids: [], shipments: 0 };
    centers.forEach(center => { if (!target.centers.includes(center)) target.centers.push(center); });
    dates.forEach(date => { if (!target.dates.includes(date)) target.dates.push(date); });
    target.ids.push(generation.generationId);
    target.shipments += generation.expectedShippingGroupCount;
    map.set(key, target);
  }
  return [...map.entries()].map(([key, target]) => {
    const resolved = target.ids.every(id => (shipmentNumbersByGeneration[id]?.length || 0) > 0);
    const shipmentNumbers = [...new Set(target.ids.flatMap(id => shipmentNumbersByGeneration[id] || []))];
    return {
      key,
      generationIds: target.ids,
      complete: resolved && shipmentNumbers.length > 0 && shipmentNumbers.every(number => dispatched.has(number)),
      label: `${target.centers.join(" / ") || "물류센터 미확인"}${target.dates.length ? ` · ${target.dates.join(" / ")}` : ""} · Shipment ${target.shipments}개`,
    };
  }).sort((left, right) => left.label.localeCompare(right.label, "ko-KR", { numeric: true }));
}
