import type { PickingWaveStoreSnapshot } from "./picking-wave/shared-store-types";
import type { PickingWave, PickingWaveItem, OutboundWorkState } from "./picking-wave/types";
import { summarizeShippingByDate } from "./picking-wave/wave-card-summary";
import { isSupersededOutputGeneration } from "./output-generation-progress";
import { deriveVendorOrderDrafts } from "./vendor-order/derive-drafts";
import { isPackingFullyDispatched, packingGenerationKey, packingShipmentPurchaseOrders, type PackingProgress } from "./packing-progress";
import { projectActivePickingWork } from "./active-picking-work";
import type { ShippingDateSummary } from "./picking-wave/wave-card-summary";

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
  completedAt: string | null;
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
  fullyCompletedElsewhere?: boolean;
  excludedPurchaseOrderNumbers?: string[];
  shippingByDate?: ShippingDateSummary[];
}

function activeGenerationShipmentCount(generation: NonNullable<PickingWave["outputGenerations"]>[number], activePos: Set<string>, progress?: PackingProgress): number | undefined {
  const selected = generation.purchaseOrderNumbers.filter(po => activePos.has(po));
  if (!selected.length) return 0;
  const members = progress ? packingShipmentPurchaseOrders(progress) : {};
  const matching = Object.values(members).filter(pos => pos.some(po => selected.includes(po)));
  if (selected.every(po => matching.some(pos => pos.includes(po)))) return matching.length;
  const invoiceGroups = generation.invoiceGroups || [];
  if (invoiceGroups.length && selected.every(po => invoiceGroups.some(group => group.includes(po)))) return invoiceGroups.filter(group => group.some(po => selected.includes(po))).length;
  if (selected.length === generation.purchaseOrderNumbers.length) return generation.expectedShippingGroupCount;
  if (generation.expectedShippingGroupCount === generation.purchaseOrderNumbers.length) return selected.length;
  return undefined;
}

/** Display projection only. It never changes picking, PO confirmation, or shipment state. */
export function summarizeOutboundWork(wave: PickingWave, items: PickingWaveItem[], state: OutboundWorkState | undefined, today: string, packingProgress?: PackingProgress, originalWave = wave): OutboundWorkSummary {
  const base = `/wms/picking/waves/${encodeURIComponent(wave.id)}`;
  const currentPackingKey = packingGenerationKey(originalWave);
  const stalePackingCompletion = state?.status === "completed" && state.source === "packing" && state.generationKey !== currentPackingKey;
  // Keep the shared revision and history for CAS actions while projecting obsolete automatic filing as active.
  const visibleState = stalePackingCompletion ? { ...state, status: "active" as const } : state;
  const currentPackingProgress = packingProgress?.generationKey === currentPackingKey ? packingProgress : undefined;
  const purchaseOrders = new Set(wave.sourcePurchaseOrderNumbers);
  const originalGenerations = (wave.outputGenerations || []).filter(generation => !generation.supersededByGenerationId);
  // A physical file containing an already dispatched PO cannot be reused for the remaining POs.
  const generations = originalGenerations.filter(generation => generation.purchaseOrderNumbers.length > 0 && generation.purchaseOrderNumbers.every(po => purchaseOrders.has(po)));
  const hasMixedGeneration = originalGenerations.some(generation => generation.purchaseOrderNumbers.some(po => purchaseOrders.has(po)) && generation.purchaseOrderNumbers.some(po => !purchaseOrders.has(po)));
  const shipmentPos = new Set(generations.filter(g => g.status === "shipment_generated").flatMap(g => g.purchaseOrderNumbers).filter(po => purchaseOrders.has(po)));
  const outputPos = new Set(generations.filter(g => g.status === "shipment_generated" && g.outputSetGeneratedAt && g.outputSetFileName).flatMap(g => g.purchaseOrderNumbers).filter(po => purchaseOrders.has(po)));
  const remainingShipmentPoCount = purchaseOrders.size - shipmentPos.size;
  const remainingOutputPoCount = purchaseOrders.size - outputPos.size;
  const pendingGeneration = generations.find(g => !isSupersededOutputGeneration(g, generations) && g.status !== "shipment_generated"
    && g.purchaseOrderNumbers.length > 0 && g.purchaseOrderNumbers.every(po => purchaseOrders.has(po) && !shipmentPos.has(po)));
  const pendingOutput = generations.find(g => g.status === "shipment_generated" && g.purchaseOrderNumbers.some(po => purchaseOrders.has(po) && !outputPos.has(po)));
  const packingGeneration = generations.find(generation => generation.generationId === wave.selectedOutputGenerationId && generation.status === "shipment_generated" && generation.purchaseOrderNumbers.some(po => purchaseOrders.has(po)))
    || [...generations].reverse().find(generation => generation.status === "shipment_generated" && generation.purchaseOrderNumbers.some(po => purchaseOrders.has(po)))
    || null;
  const packingHref = packingGeneration ? `${base}/packing?generation=${encodeURIComponent(packingGeneration.generationId)}` : null;
  const packingPoSet = new Set((packingGeneration?.purchaseOrderNumbers || []).filter(po => purchaseOrders.has(po)));
  const packingRows = (currentPackingProgress?.rows || []).filter(row => packingPoSet.has(row.purchaseOrderNumber));
  const checkedPackingKeys = new Set(currentPackingProgress?.checkedKeys || []);
  const shipmentNumbers = [...new Set(packingRows.map(row => row.shipmentNumber))];
  const currentShipmentNumber = shipmentNumbers.find(shipmentNumber => packingRows.some(row => row.shipmentNumber === shipmentNumber && !checkedPackingKeys.has(row.key))) || shipmentNumbers.at(-1);
  const currentShipmentIndex = currentShipmentNumber ? shipmentNumbers.indexOf(currentShipmentNumber) + 1 : 0;
  const currentPo = packingRows.find(row => row.shipmentNumber === currentShipmentNumber)?.purchaseOrderNumber || [...packingPoSet][0];
  const currentCenter = wave.shippingGroups?.find(group => currentPo && group.purchaseOrderNumbers.includes(currentPo))?.fulfillmentCenter;
  const checkedPackingCount = packingRows.filter(row => checkedPackingKeys.has(row.key)).length;
  const expectedShipmentCount = shipmentNumbers.length || (packingGeneration ? activeGenerationShipmentCount(packingGeneration, purchaseOrders, currentPackingProgress) : 0);
  const packingLabel = packingGeneration
    ? packingRows.length
      ? `${currentCenter ? `${currentCenter} · ` : ""}Shipment ${currentShipmentIndex}/${expectedShipmentCount ?? "?"} · 상품 확인·바코드 부착 (${checkedPackingCount}/${packingRows.length})`
      : `Shipment ${expectedShipmentCount ?? "확인 필요"}개 · 상품 확인·바코드 부착`
    : null;
  const packingTargetMap = new Map<string, { center: string; expectedDate: string; generationIds: string[]; shipmentCount: number; shipmentCountKnown: boolean; quantity: number }>();
  for (const generation of generations.filter(candidate => candidate.status === "shipment_generated" && candidate.shipmentFileName && candidate.purchaseOrderNumbers.some(po => purchaseOrders.has(po)))) {
    const generationPoSet = new Set(generation.purchaseOrderNumbers.filter(po => purchaseOrders.has(po)));
    const matchingGroups = (wave.shippingGroups || []).filter(group => group.purchaseOrderNumbers.some(po => generationPoSet.has(po)));
    const centers = [...new Set(matchingGroups.map(group => group.fulfillmentCenter))];
    const dates = [...new Set(matchingGroups.map(group => group.expectedDate))];
    const isSingleDestination = centers.length === 1 && dates.length === 1;
    const key = isSingleDestination ? `${dates[0]}\u0000${centers[0]}` : generation.generationId;
    const target = packingTargetMap.get(key) || { center: centers.join(" / ") || "물류센터 미확인", expectedDate: dates.join(" / "), generationIds: [], shipmentCount: 0, shipmentCountKnown: true, quantity: 0 };
    target.generationIds.push(generation.generationId);
    const count = activeGenerationShipmentCount(generation, purchaseOrders, currentPackingProgress);
    target.shipmentCount += count || 0;
    target.shipmentCountKnown = target.shipmentCountKnown && count !== undefined;
    target.quantity += items.reduce((sum, item) => sum + item.sources.filter(source => generationPoSet.has(source.purchaseOrderNumber)).reduce((sourceSum, source) => {
      const allocation = item.allocations.find(candidate => candidate.purchaseOrderNumber === source.purchaseOrderNumber && candidate.basketNumber === source.basketNumber);
      return sourceSum + (allocation?.fulfilledQuantity ?? (item.status === "full" ? source.requestedQuantity : 0));
    }, 0), 0);
    packingTargetMap.set(key, target);
  }
  const packingTargets = [...packingTargetMap.entries()].map(([key, target]) => ({
    key,
    label: `${target.center}${target.expectedDate ? ` · ${target.expectedDate}` : ""} · ${target.shipmentCountKnown ? "Shipment " + target.shipmentCount + "개" : "Shipment 수 확인 필요"} · 총 ${target.quantity}개`,
    href: `${base}/packing?generations=${encodeURIComponent(target.generationIds.join(","))}`,
  })).sort((a, b) => b.label.localeCompare(a.label, "ko-KR", { numeric: true }));
  const shipping = summarizeShippingByDate(wave, items);
  const expectedDates = shipping.map(group => group.expectedDate).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  const earliest = expectedDates[0];
  const daysLate = earliest && earliest < today ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${earliest}T00:00:00Z`)) / 86_400_000) : 0;
  const pickedSkuCount = items.filter(item => item.status !== "pending").length;
  let nextLabel = "1단계 · 발주확정 통합파일";
  let nextHref = `${base}/complete#po-confirm`;
  const packingIsActive = Boolean(packingGeneration && (packingGeneration.outputSetGeneratedAt || packingRows.length) && !currentPackingProgress?.dispatchedAt);
  if (hasMixedGeneration && remainingShipmentPoCount > 0) {
    nextLabel = "남은 발주 " + remainingShipmentPoCount + "건 · 송장 묶음 만들기";
    nextHref = base + "/complete#hanjin-step-1";
  } else if (wave.shipmentDocumentsCompletedAt) {
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
  const restoredAfterDispatch = visibleState?.status === "active" && packingProgress && visibleState.updatedAt >= packingProgress.updatedAt;
  const completedAt = visibleState?.status === "completed" ? visibleState.updatedAt
    : !restoredAfterDispatch && isPackingFullyDispatched(originalWave, packingProgress) ? packingProgress!.dispatchedAt || packingProgress!.updatedAt : null;
  return {
    id: wave.id,
    title: displayName && !/^WAVE-/i.test(displayName) ? displayName : `${expectedDates.length === 1 ? earliest + " 입고" : expectedDates.length > 1 ? earliest + " 외 입고" : "입고일 미정"} 출고작업`,
    updatedAt: wave.updatedAt,
    state: visibleState || null,
    completedAt,
    purchaseOrderCount: purchaseOrders.size,
    skuCount: items.length,
    totalQuantity: items.reduce((sum, item) => sum + item.totalQuantity, 0),
    centerCount: new Set(shipping.flatMap(group => group.centers.map(center => center.fulfillmentCenter))).size,
    expectedDates,
    shippingByDate: shipping,
    delay: completedAt || (visibleState?.status && visibleState.status !== "active") ? null : daysLate > 0 ? daysLate <= 3 ? `출고 유예 ${daysLate}일째` : `입고예정일 ${daysLate}일 경과 · 계속 작업 가능` : null,
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
  const works = snapshot.waves.map(wave => {
    const state = snapshot.outboundWorkStates?.[wave.id];
    const packing = snapshot.packingProgress?.[wave.id];
    const original = summarizeOutboundWork(wave, itemsByWave.get(wave.id) || [], state, today, packing);
    // A completed/archived work remains an intact historical view of its own shipment.
    if (original.completedAt || original.state?.status === "archived") return original;
    const projection = projectActivePickingWork(snapshot, wave.id);
    if (!projection || !projection.wave || !projection.excludedPurchaseOrderNumbers.length) return original;
    if (projection.fullyCompletedElsewhere) return {
      ...original, fullyCompletedElsewhere: true, excludedPurchaseOrderNumbers: projection.excludedPurchaseOrderNumbers,
      delay: null, remainingShipmentPoCount: 0, remainingOutputPoCount: 0, canComplete: false,
      nextLabel: "다른 출고작업에서 출고완료", nextHref: original.documentHref,
      packingLabel: null, packingHref: null, packingTargets: [],
    };
    return {
      ...summarizeOutboundWork(projection.wave, projection.items, state, today, packing, wave),
      fullyCompletedElsewhere: false, excludedPurchaseOrderNumbers: projection.excludedPurchaseOrderNumbers,
    };
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const draftsById = new Map(deriveVendorOrderDrafts(snapshot.vendorOrderDrafts, snapshot.vendorOrderLines).map(draft => [draft.id, draft]));
  const pending = snapshot.vendorOrderLines.filter(line => !line.orderExclusion && draftsById.has(line.draftId) && draftsById.get(line.draftId)?.status !== "sent" && line.shortageQuantity > 0);
  const sent = snapshot.vendorOrderLines.filter(line => !line.orderExclusion && draftsById.get(line.draftId)?.status === "sent" && (line.receivedQuantity || 0) < line.shortageQuantity);
  return {
    today, works,
    pendingVendorCount: new Set(pending.map(line => line.vendorName)).size,
    pendingVendorSkuCount: new Set(pending.map(line => line.skuId)).size,
    receivingVendorSkuCount: new Set(sent.map(line => line.skuId)).size,
  };
}

export type WorkCenterOverview = ReturnType<typeof buildWorkCenterOverview>;
