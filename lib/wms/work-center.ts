import type { PickingWaveStoreSnapshot } from "./picking-wave/shared-store-types";
import type { PickingWave, PickingWaveItem, OutboundWorkState } from "./picking-wave/types";
import { summarizeShippingByDate } from "./picking-wave/wave-card-summary";
import { isSupersededOutputGeneration } from "./output-generation-progress";
import { deriveVendorOrderDrafts } from "./vendor-order/derive-drafts";

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
  documentHref: string;
  pickingHref: string;
  vendorHref: string;
  canComplete: boolean;
}

/** Display projection only. It never changes picking, PO confirmation, or shipment state. */
export function summarizeOutboundWork(wave: PickingWave, items: PickingWaveItem[], state: OutboundWorkState | undefined, today: string): OutboundWorkSummary {
  const base = `/wms/picking/waves/${encodeURIComponent(wave.id)}`;
  const generations = wave.outputGenerations || [];
  const purchaseOrders = new Set(wave.sourcePurchaseOrderNumbers);
  const shipmentPos = new Set(generations.filter(g => g.status === "shipment_generated").flatMap(g => g.purchaseOrderNumbers).filter(po => purchaseOrders.has(po)));
  const outputPos = new Set(generations.filter(g => g.status === "shipment_generated" && g.outputSetGeneratedAt && g.outputSetFileName).flatMap(g => g.purchaseOrderNumbers).filter(po => purchaseOrders.has(po)));
  const remainingShipmentPoCount = purchaseOrders.size - shipmentPos.size;
  const remainingOutputPoCount = purchaseOrders.size - outputPos.size;
  const pendingGeneration = generations.find(g => !isSupersededOutputGeneration(g, generations) && g.status !== "shipment_generated"
    && g.purchaseOrderNumbers.length > 0 && g.purchaseOrderNumbers.every(po => purchaseOrders.has(po) && !shipmentPos.has(po)));
  const pendingOutput = generations.find(g => g.status === "shipment_generated" && g.purchaseOrderNumbers.some(po => purchaseOrders.has(po) && !outputPos.has(po)));
  const shipping = summarizeShippingByDate(wave, items);
  const expectedDates = shipping.map(group => group.expectedDate).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  const earliest = expectedDates[0];
  const daysLate = earliest && earliest < today ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${earliest}T00:00:00Z`)) / 86_400_000) : 0;
  const pickedSkuCount = items.filter(item => item.status !== "pending").length;
  let nextLabel = "1단계 · 발주확정 통합파일";
  let nextHref = `${base}/complete#po-confirm`;
  if (pendingGeneration) {
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
    nextLabel = "출고 마무리 확인·재출력";
    nextHref = `${base}/complete`;
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
    nextLabel, nextHref,
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
  const works = snapshot.waves.map(wave => summarizeOutboundWork(wave, itemsByWave.get(wave.id) || [], snapshot.outboundWorkStates?.[wave.id], today))
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
