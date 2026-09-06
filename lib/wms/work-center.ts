import type { PickingWaveStoreSnapshot } from "./picking-wave/shared-store-types";
import type { PickingWave, PickingWaveItem, OutboundWorkState } from "./picking-wave/types";
import { summarizeShippingByDate } from "./picking-wave/wave-card-summary";
import { isSupersededOutputGeneration } from "./output-generation-progress";
import { deriveVendorOrderDrafts } from "./vendor-order/derive-drafts";
import type { PackingProgress } from "./packing-progress";

export function kstWorkDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(value => value.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export interface OutboundWorkSummary {
  id: string;
  title: string;
  updatedAt: string;
  state: OutboundWorkState | null;
  purchaseOrderCount: number;
  skuCount: number;
  totalQuantity: number;
  centerCount: number;
  expectedDates: string[];
  delay: string | null;
  pickedSkuCount: number;
  remainingShipmentPoCount: number;
  remainingOutputPoCount: number;
  nextLabel: string;
  nextHref: string;
  packingLabel: string | null;
  packingHref: string | null;
  packingTargets: Array<{ key: string; label: string; href: string }>;
  documentHref: string;
  pickingHref: string;
  vendorHref: string;
  canComplete: boolean;
}

/** Display projection only. It never changes picking, PO confirmation, or shipment state. */
export function summarizeOutboundWork(wave: PickingWave, items: PickingWaveItem[], state: OutboundWorkState | undefined, today: string, packingProgress?: PackingProgress): OutboundWorkSummary {
  const base = `/wms/picking/waves/${encodeURIComponent(wave.id)}`;
  const generations = (wave.outputGenerations || []).filter(generation => !generation.supersededByGenerationId);
  const purchaseOrders = new Set(wave.sourcePurchaseOrderNumbers);
  const shipmentPos = new Set(generations.filter(g => g.status === "shipment_generated").flatMap(g => g.purchaseOrderNumbers).filter(po => purchaseOrders.has(po)));
  const outputPos = new Set(generations.filter(g => g.status === "shipment_generated" && g.outputSetGeneratedAt && g.outputSetFileName).flatMap(g => g.purchaseOrderNumbers).filter(po => purchaseOrders.has(po)));
  const remainingShipmentPoCount = purchaseOrders.size - shipmentPos.size;
  const remainingOutputPoCount = purchaseOrders.size - outputPos.size;
  const pendingGeneration = generations.find(g => !isSupersededOutputGeneration(g, generations) && g.status !== "shipment_generated"
    && g.purchaseOrderNumbers.length > 0 && g.purchaseOrderNumbers.every(po => purchaseOrders.has(po) && !shipmentPos.has(po)));
  const pendingOutput = generations.find(g => g.status === "shipment_generated" && g.purchaseOrderNumbers.some(po => purchaseOrders.has(po) && !outputPos.has(po)));
  const packingGeneration = generations.find(generation => generation.generationId === wave.selectedOutputGenerationId && generation.status === "shipment_generated")
    || [...generations].reverse().find(generation => generation.status === "shipment_generated")
    || null;
  const packingHref = packingGeneration ? `${base}/packing?generation=${encodeURIComponent(packingGeneration.generationId)}` : null;
  const packingPoSet = new Set(packingGeneration?.purchaseOrderNumbers || []);
  const packingRows = (packingProgress?.rows || []).filter(row => packingPoSet.has(row.purchaseOrderNumber));
  const checkedPackingKeys = new Set(packingProgress?.checkedKeys || []);
  const shipmentNumbers = [...new Set(packingRows.map(row => row.shipmentNumber))];
  const currentShipmentNumber = shipmentNumbers.find(shipmentNumber => packingRows.some(row => row.shipmentNumber === shipmentNumber && !checkedPackingKeys.has(row.key))) || shipmentNumbers.at(-1);
  const currentShipmentIndex = currentShipmentNumber ? shipmentNumbers.indexOf(currentShipmentNumber) + 1 : 0;
  const currentPo = packingRows.find(row => row.shipmentNumber === currentShipmentNumber)?.purchaseOrderNumber || packingGeneration?.purchaseOrderNumbers[0];
  const currentCenter = wave.shippingGroups?.find(group => currentPo && group.purchaseOrderNumbers.includes(currentPo))?.fulfillmentCenter;
  const checkedPackingCount = packingRows.filter(row => checkedPackingKeys.has(row.key)).length;
  const expectedShipmentCount = shipmentNumbers.length || packingGeneration?.expectedShippingGroupCount || 0;
  const packingLabel = packingGeneration
    ? packingRows.length
      ? `${currentCenter ? `${currentCenter} · ` : ""}Shipment ${currentShipmentIndex}/${expectedShipmentCount} · 상품 확인·바코드 부착 (${checkedPackingCount}/${packingRows.length})`
      : `Shipment ${expectedShipmentCount}개 · 상품 확인·바코드 부착`
    : null;
  const packingTargetMap = new Map<string, { center: string; expectedDate: string; generationIds: string[]; shipmentCount: number; quantity: number }>();
  for (const generation of generations.filter(candidate => candidate.status === "shipment_generated" && candidate.shipmentFileName)) {
    const generationPoSet = new Set(generation.purchaseOrderNumbers);
    const matchingGroups = (wave.shippingGroups || []).filter(group => group.purchaseOrderNumbers.some(po => generationPoSet.has(po)));
    const centers = [...new Set(matchingGroups.map(group => group.fulfillmentCenter))];
    const dates = [...new Set(matchingGroups.map(group => group.expectedDate))];
    const isSingleDestination = centers.length === 1 && dates.length === 1;
    const key = isSingleDestination ? `${dates[0]}\u0000${centers[0]}` : generation.generationId;
    const target = packingTargetMap.get(key) || { center: isSingleDestination ? centers[0] : "복수 물류센터", expectedDate: isSingleDestination ? dates[0] : "", generationIds: [], shipmentCount: 0, quantity: 0 };
    target.generationIds.push(generation.generationId);
    target.shipmentCount += generation.expectedShippingGroupCount;
    target.quantity += items.reduce((sum, item) => sum + item.sources.filter(source => generationPoSet.has(source.purchaseOrderNumber)).reduce((sourceSum, source) => {
      const allocation = item.allocations.find(candidate => candidate.purchaseOrderNumber === source.purchaseOrderNumber && candidate.basketNumber === source.basketNumber);
      return sourceSum + (allocation?.fulfilledQuantity ?? (item.status === "full" ? source.requestedQuantity : 0));
    }, 0), 0);
    packingTargetMap.set(key, target);
  }
  const packingTargets = [...packingTargetMap.entries()].map(([key, target]) => ({
    key,
    label: `${target.center}${target.expectedDate ? ` · ${target.expectedDate}` : ""} · Shipment ${target.shipmentCount}개 · 총 ${target.quantity}개`,
    href: `${base}/packing?generations=${encodeURIComponent(target.generationIds.join(","))}`,
  })).sort((a, b) => b.label.localeCompare(a.label, "ko-KR", { numeric: true }));
  const shipping = summarizeShippingByDate(wave, items);
  const expectedDates = shipping.map(group => group.expectedDate).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  const earliest = expectedDates[0];
  const daysLate = earliest && earliest < today ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${earliest}T00:00:00Z`)) / 86_400_000) : 0;
  const pickedSkuCount = items.filter(item => item.status !== "pending").length;
  let nextLabel = "1단계 · 발주확정 통합파일";
  let nextHref = `${base}/complete#po-confirm`;
  const packingIsActive = Boolean(packingGeneration && (packingGeneration.outputSetGeneratedAt || packingRows.length) && !packingProgress?.dispatchedAt);
  if (wave.shipmentDocumentsCompletedAt) {
    nextLabel = "통합피킹 · Shipment별 출고작업 선택";
    nextHref = `${base}/complete`;
  } else if (packingIsActive && packingHref && packingLabel) {
    nextLabel = "Shipment 서류작업 확인";
    nextHref = `${base}/complete`;
  } else if (pendingGeneration) {
    nextLabel = `Shipment 묶음 ${generations.indexOf(pendingGeneration) + 1} 계속하기`;
    nextHref = `${base}/complete?generation=${encodeURIComponent(pendingGeneration.generationId)}#hanjin-step-3`;
  } else if (generations.length && remainingShipmentPoCount > 0) {
    nextLabel = `남은 발주 ${remainingShipmentPoCount}건 · 송장 묶음 만들기`;
    nextHref = `${base}/complete#hanjin-step-1`;
  } else if (pendingOutput) {
    nextLabel = `묶음 ${generations.indexOf(pendingOutput) + 1} · Shipment 출력세트`;
    nextHref = `${base}/complete?generation=${encodeURIComponent(pendingOutput.generationId)}#shipment-output-set`;
  } else if (generations.length && pickedSkuCount < items.length) {
    nextLabel = `실제 피킹 · 미처리 SKU ${items.length - pickedSkuCount}개`;
    nextHref = base;
  } else if (generations.length) {
    nextLabel = "Shipment별 검수·포장·출고완료";
    nextHref = `${base}/packing`;
  }
  const displayName = wave.displayName?.trim();
  return {
    id: wave.id,
    title: displayName && !/^WAVE-/i.test(displayName) ? displayName : `${expectedDates.length === 1 ? earliest + " 입고" : expectedDates.length > 1 ? earliest + " 외 입고" : "입고일 미정"} 출고작업`,
    updatedAt: wave.updatedAt,
    state: state || null,
    purchaseOrderCount: purchaseOrders.size,
    skuCount: items.length,
    totalQuantity: items.reduce((sum, item) => sum + item.totalQuantity, 0),
    centerCount: new Set(shipping.flatMap(group => group.centers.map(center => center.fulfillmentCenter))).size,
    expectedDates,
    delay: state?.status && state.status !== "active" ? null : daysLate > 0 ? daysLate <= 3 ? `출고 유예 ${daysLate}일째` : `입고예정일 ${daysLate}일 경과 · 계속 작업 가능` : null,
    pickedSkuCount,
    remainingShipmentPoCount,
    remainingOutputPoCount,
    nextLabel, nextHref, packingLabel, packingHref, packingTargets,
    documentHref: `${base}/complete`, pickingHref: base, vendorHref: `${base}/vendor-orders`,
    canComplete: purchaseOrders.size > 0 && remainingShipmentPoCount === 0 && remainingOutputPoCount === 0 && items.length > 0 && pickedSkuCount === items.length,
  };
}

export function buildWorkCenterOverview(snapshot: PickingWaveStoreSnapshot, now = new Date()) {
  const itemsByWave = new Map<string, PickingWaveItem[]>();
  for (const item of snapshot.items) {
    const list = itemsByWave.get(item.waveId) || [];
    list.push(item); itemsByWave.set(item.waveId, list);
  }
  const today = kstWorkDate(now);
  const works = snapshot.waves.map(wave => summarizeOutboundWork(wave, itemsByWave.get(wave.id) || [], snapshot.outboundWorkStates?.[wave.id], today, snapshot.packingProgress?.[wave.id]))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const draftsById = new Map(deriveVendorOrderDrafts(snapshot.vendorOrderDrafts, snapshot.vendorOrderLines).map(draft => [draft.id, draft]));
  const pending = snapshot.vendorOrderLines.filter(line => draftsById.has(line.draftId) && draftsById.get(line.draftId)?.status !== "sent" && line.shortageQuantity > 0);
  const sent = snapshot.vendorOrderLines.filter(line => draftsById.get(line.draftId)?.status === "sent" && (line.receivedQuantity || 0) < line.shortageQuantity);
  return {
    today, works,
    pendingVendorCount: new Set(pending.map(line => line.vendorName)).size,
    pendingVendorSkuCount: new Set(pending.map(line => line.skuId)).size,
    receivingVendorSkuCount: new Set(sent.map(line => line.skuId)).size,
  };
}

export type WorkCenterOverview = ReturnType<typeof buildWorkCenterOverview>;
