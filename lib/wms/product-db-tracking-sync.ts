/**
 * 제품DB 발주·입고 추적 칸 자동 입력(사용자 요청 2026-10-23)
 *
 * - 최근쿠팡공급가(+이전쿠팡공급가·공급가차이·공급가확인): 원발주서 매입가(coupang-supply-price-sync.ts)
 * - 최근발주일: SKU가 들어 있는 원발주서 파일을 처음 받은 날(신규발주서는 발주 당일 받음). 더 늦은 날일 때만 바꾼다.
 * - 최근입고일: 마감된 쉽먼트에서 실제로 입고된(입고수량 > 0) 가장 늦은 입고예정일. 더 늦은 날일 때만 바꾼다.
 * - 누적입고: 기준값 + 9/13 이후 마감 쉽먼트 입고수량 합계. 기준값은 SKU가 입고결과에 처음 나올 때의 시트 값
 *   (그때까지 사이트가 적은 적이 없으므로 9/13 이후 입고는 들어 있지 않다). 다시 돌려도 같은 값이 나온다.
 * - 미입고: 아직 입고결과(마감)가 나오지 않은 발주의 수량 합계. 피킹에서 실제로 보낸 수량이 있으면 그 수량,
 *   아직 작업 전인 발주는 입고예정일이 오늘 이후일 때만 발주수량. 없으면 칸을 비운다.
 * 현재고·재고현황은 쓰지 않는 칸이라 건드리지 않는다.
 */
import type { PurchaseOrderIndex } from "./purchase-order-source/types";
import type { LogisticsReceiptSnapshot } from "./logistics-receipts";
import { latestPurchasePrices, planSupplyPriceSync, type SupplyPriceCellUpdate } from "./coupang-supply-price-sync";
import { normalizeSkuId } from "./sku-normalize";

export const TRACKING_SINCE = "2026-09-13";

export interface TrackingInput {
  index: Pick<PurchaseOrderIndex, "byPurchaseOrderNumber">;
  receipts?: Pick<LogisticsReceiptSnapshot, "shipments" | "shipmentMetadata">;
  /** 피킹에서 발주별로 실제로 보낸 수량 */
  shipped: Array<{ purchaseOrderNumber: string; skuId: string; quantity: number }>;
  today: string; // YYYY-MM-DD (KST)
}

export interface SkuTracking { lastOrderDate?: string; lastInboundDate?: string; receivedSince: number; pending: number }

const kstDate = (iso: string) => {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? new Date(time + 9 * 3600_000).toISOString().slice(0, 10) : "";
};
const pair = (po: string, sku: string) => `${normalizeSkuId(po)}|${normalizeSkuId(sku)}`;

export function computeSkuTracking(input: TrackingInput): Map<string, SkuTracking> {
  const result = new Map<string, SkuTracking>();
  const get = (sku: string) => { let item = result.get(sku); if (!item) { item = { receivedSince: 0, pending: 0 }; result.set(sku, item); } return item; };

  // 입고: 마감 쉽먼트
  const closedPurchaseOrders = new Set<string>();
  for (const shipment of input.receipts?.shipments || []) {
    if (shipment.status !== "마감") continue;
    const expectedDate = String(input.receipts?.shipmentMetadata?.[shipment.shipmentNumber]?.expectedDate || "").slice(0, 10);
    for (const line of shipment.lines) {
      closedPurchaseOrders.add(normalizeSkuId(line.purchaseOrderNumber));
      const sku = normalizeSkuId(line.skuId);
      const item = get(sku);
      item.receivedSince += Math.max(0, Number(line.receivedQuantity) || 0);
      if (line.receivedQuantity > 0 && /^\d{4}-\d{2}-\d{2}$/.test(expectedDate) && (!item.lastInboundDate || expectedDate > item.lastInboundDate)) item.lastInboundDate = expectedDate;
    }
  }

  const shipped = new Map<string, number>();
  for (const line of input.shipped) shipped.set(pair(line.purchaseOrderNumber, line.skuId), Math.max(0, Number(line.quantity) || 0));

  for (const document of input.index.byPurchaseOrderNumber.values()) {
    const po = normalizeSkuId(document.purchaseOrderNumber);
    const orderDate = document.firstReceivedAt ? kstDate(document.firstReceivedAt) : "";
    const expectedDate = String(document.expectedArrivalDate || "").slice(0, 10);
    const open = expectedDate >= TRACKING_SINCE && !closedPurchaseOrders.has(po);
    for (const record of document.records) {
      const sku = normalizeSkuId(record.skuId);
      if (!/^\d{1,20}$/.test(sku) || !(record.orderedQuantity > 0)) continue;
      const item = get(sku);
      if (orderDate && (!item.lastOrderDate || orderDate > item.lastOrderDate)) item.lastOrderDate = orderDate;
      if (!open) continue;
      const key = pair(po, sku);
      item.pending += shipped.has(key) ? shipped.get(key)! : (expectedDate >= input.today ? record.orderedQuantity : 0);
    }
  }
  return result;
}

const header = (value: unknown) => String(value ?? "").replace(/\s+/g, "");
const numberOf = (value: unknown) => {
  const number = Number(String(value ?? "").replace(/[,\s개]/g, ""));
  return Number.isFinite(number) ? number : 0;
};
/** 시트 날짜 칸(글자 "2026/09/04" 또는 날짜 일련번호) → YYYY-MM-DD */
export function sheetDate(value: unknown): string {
  if (typeof value === "number" && value > 20000 && value < 80000) return new Date(Math.round((value - 25569) * 86400_000)).toISOString().slice(0, 10);
  const text = String(value ?? "").trim();
  if (/^\d{5}$/.test(text)) return sheetDate(Number(text));
  const match = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : "";
}
const sheetDateText = (date: string) => date.replace(/-/g, "/");

/** 누적입고 기준값이 아직 없는 SKU → 지금 시트 값(처음 입고결과에 나온 때). */
export function newInboundBaselines(rows: readonly (readonly unknown[])[], tracking: ReadonlyMap<string, SkuTracking>, baseline: Readonly<Record<string, number>>): Record<string, number> {
  const headers = (rows[0] || []).map(header);
  const sku = headers.indexOf("SKUID"), total = headers.indexOf("누적입고");
  const added: Record<string, number> = {};
  if (sku < 0 || total < 0) return added;
  rows.forEach((row, index) => {
    if (!index) return;
    const id = normalizeSkuId(String(row[sku] ?? ""));
    if (!(tracking.get(id)?.receivedSince) || id in baseline || id in added) return;
    added[id] = numberOf(row[total]);
  });
  return added;
}

export function planTrackingSync(rows: readonly (readonly unknown[])[], tracking: ReadonlyMap<string, SkuTracking>, baseline: Readonly<Record<string, number>>): { updates: SupplyPriceCellUpdate[]; rows: number } {
  const headers = (rows[0] || []).map(header);
  const col = { sku: headers.indexOf("SKUID"), total: headers.indexOf("누적입고"), pending: headers.indexOf("미입고"), order: headers.indexOf("최근발주일"), inbound: headers.indexOf("최근입고일") };
  const updates: SupplyPriceCellUpdate[] = [];
  const touched = new Set<number>();
  if (col.sku < 0) return { updates, rows: 0 };
  rows.forEach((row, index) => {
    if (!index) return;
    const id = normalizeSkuId(String(row[col.sku] ?? ""));
    if (!/^\d{1,20}$/.test(id)) return;
    const item = tracking.get(id);
    const sheetRow = index + 1;
    const push = (column: number, value: string | number) => { updates.push({ row: sheetRow, col: column + 1, value }); touched.add(sheetRow); };
    if (col.pending >= 0) {
      const next = item?.pending ? item.pending : "";
      const current = String(row[col.pending] ?? "").trim();
      if (current !== String(next)) push(col.pending, next);
    }
    if (!item) return;
    if (col.total >= 0 && item.receivedSince > 0 && id in baseline) {
      const current = numberOf(row[col.total]);
      const next = Math.max(current, baseline[id] + item.receivedSince);
      if (next !== current || String(row[col.total] ?? "").trim() === "") push(col.total, next);
    }
    if (col.order >= 0 && item.lastOrderDate && item.lastOrderDate > sheetDate(row[col.order])) push(col.order, sheetDateText(item.lastOrderDate));
    if (col.inbound >= 0 && item.lastInboundDate && item.lastInboundDate > sheetDate(row[col.inbound])) push(col.inbound, sheetDateText(item.lastInboundDate));
  });
  return { updates, rows: touched.size };
}

/** 원발주서·입고결과·피킹 기록을 읽어 제품DB 등 SKU 탭의 추적 칸을 맞춘다. */
export async function syncProductDbTracking(): Promise<{ rows: number; prices: number; tabs: string[] }> {
  const [{ buildPurchaseOrderIndex }, sheets, { PRODUCT_DB_SHEET_NAME }, { STORAGE_TAB, pickStorageTabTitle }, retired, store, picking, receiptsLib] = await Promise.all([
    import("./purchase-order-source"), import("./google-sheets"), import("./product-catalog"), import("./warehouse-recheck-cleanup"), import("./retired-sku-tabs"),
    import("./weekly-work-store"), import("./picking-wave/server-store"), import("./logistics-receipts"),
  ]);
  const [index, workspace, pickingStore, tabList] = await Promise.all([
    buildPurchaseOrderIndex(undefined, undefined, false), store.readWeeklyWorkspace(), picking.readPickingWaveStore(), sheets.fetchSpreadsheetTabs(),
  ]);
  const receipts = workspace.logisticsReceiptEpoch === receiptsLib.LOGISTICS_RECEIPT_EPOCH ? workspace.logisticsReceipts : undefined;
  const shipped = pickingStore.items.flatMap(item => (item.allocations || []).map(allocation => ({ purchaseOrderNumber: allocation.purchaseOrderNumber, skuId: item.productCode, quantity: allocation.fulfilledQuantity })));
  const tracking = computeSkuTracking({ index, receipts, shipped, today: new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10) });
  const prices = latestPurchasePrices(index);

  const titles = tabList.map(tab => tab.title);
  const targets = [...new Set([PRODUCT_DB_SHEET_NAME, pickStorageTabTitle(titles) || STORAGE_TAB, ...retired.RETIRED_SKU_TABS])].filter(title => titles.includes(title));
  const tabs = await Promise.all(targets.map(async title => ({ title, rows: await sheets.fetchSheetRows(title, { valueRenderOption: "UNFORMATTED_VALUE" }) })));

  // 누적입고 기준값: 새로 나온 SKU만 지금 시트 값으로 저장(쓰기 전에 먼저 저장).
  let baseline: Record<string, number> = { ...(workspace.productDbInboundBaseline || {}) };
  const added: Record<string, number> = {};
  for (const tab of tabs) Object.assign(added, newInboundBaselines(tab.rows, tracking, { ...baseline, ...added }));
  if (Object.keys(added).length) {
    baseline = await store.mutateWeeklyWorkspace(next => {
      next.productDbInboundBaseline = { ...added, ...(next.productDbInboundBaseline || {}) };
      return next.productDbInboundBaseline;
    });
  }

  let rows = 0, priceRows = 0;
  const touched: string[] = [];
  for (const tab of tabs) {
    const plan = planTrackingSync(tab.rows, tracking, baseline);
    const price = planSupplyPriceSync(tab.rows, prices);
    const updates = [...plan.updates, ...price.updates];
    if (!updates.length) continue;
    await sheets.updateSheetCells(tab.title, updates);
    rows += plan.rows; priceRows += price.changed.length;
    touched.push(tab.title);
  }
  return { rows, prices: priceRows, tabs: touched };
}

let lastRun = 0;
let running: Promise<string> | null = null;
/** 화면을 열 때 뒤에서 돌린다. 2분 안에 다시 부르면 건너뛰고, 실패해도 다른 작업은 막지 않는다. */
export async function syncProductDbTrackingSafely(force = false): Promise<string> {
  if (running) return running;
  if (!force && Date.now() - lastRun < 120_000) return "skipped";
  running = (async () => {
    try {
      const result = await syncProductDbTracking();
      return `ok:${result.rows}:${result.prices}`;
    } catch (error) {
      console.error("[제품DB 발주·입고 칸 자동입력 실패]", error);
      return `error:${error instanceof Error ? error.message : "실패"}`;
    } finally {
      lastRun = Date.now();
      running = null;
    }
  })();
  return running;
}
