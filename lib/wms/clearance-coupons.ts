import { createHash } from "node:crypto";
import { normalizeInboundMoment, buildInboundEventKey } from "./inbound-import-safety";
import type { SupplierHubInboundEvent } from "./picking-wave/shared-store-types";
import type { ProductCatalogItem } from "./product-catalog";
import { normalizeSkuId } from "./sku-normalize";
import { WEEKLY_RULES_VERSION, type WeeklySnapshot } from "./weekly-work-types";

/** All stored receipts, once per actual event. Returns never turn two receipts into one. */
export function buildClearanceCouponSnapshot(events: SupplierHubInboundEvent[], catalog: ProductCatalogItem[], now = new Date().toISOString()): WeeklySnapshot {
  const unique = new Map<string, { skuId: string; quantity: number; name: string; day: string }>();
  const blockers = new Set<string>();
  let duplicates = 0;
  for (const event of events) {
    if (/반출|반품/.test(event.division)) continue;
    const skuId = normalizeSkuId(event.skuId), po = event.orderNo.trim();
    const moment = normalizeInboundMoment(event.inboundDate);
    const raw = String(event.quantity).trim().replace(/,/g, "");
    const quantity = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!skuId || !po || !moment || !Number.isSafeInteger(quantity) || !["발주", "입고"].includes(event.division.trim())) {
      blockers.add("저장된 입고상세에 날짜·수량·구분을 확인할 수 없는 행이 있습니다."); continue;
    }
    const key = buildInboundEventKey({ actualAt: moment.actualAt, po, sku: skuId, kind: "inbound" });
    const prior = unique.get(key);
    if (prior) {
      if (prior.quantity !== quantity) blockers.add(`발주 ${po} · SKU ${skuId}: 같은 입고 이벤트의 수량이 다릅니다.`);
      else duplicates++;
    } else unique.set(key, { skuId, quantity, name: event.skuName, day: moment.actualDate });
  }
  const totals = new Map<string, number>();
  for (const item of unique.values()) totals.set(item.skuId, (totals.get(item.skuId) || 0) + item.quantity);
  const products = new Map(catalog.map(item => [normalizeSkuId(item.skuId), item]));
  const couponItems = blockers.size ? [] : [...totals].filter(([skuId, total]) => total === 1 && !/단종/.test(products.get(skuId)?.currentStatus || "")).sort(([a], [b]) => a.localeCompare(b)).map(([skuId]) => ({
    skuId, productName: products.get(skuId)?.productName || [...unique.values()].find(item => item.skuId === skuId)?.name || "", productLink: products.get(skuId)?.productLink || "",
  }));
  const couponReceiptKeys = Object.fromEntries(couponItems.map(item => [item.skuId, [...unique].filter(([, row]) => row.skuId === item.skuId && row.quantity > 0).map(([key]) => key).sort()]));
  const dates = [...unique.values()].map(item => item.day).sort();
  if (!dates.length) blockers.add("저장된 실제 입고내역이 없습니다.");
  const period = { startDate: dates[0] || now.slice(0, 10), endDate: dates.at(-1) || now.slice(0, 10) };
  const sourceToken = createHash("sha256").update(JSON.stringify(["clearance-coupons-v1", [...unique].sort(([a], [b]) => a.localeCompare(b)), couponItems, [...blockers]])).digest("hex");
  return { id: `TRANSFER-CLEARANCE-${sourceToken.slice(0, 20)}`, rulesVersion: WEEKLY_RULES_VERSION, sourceToken, createdAt: now, period,
    source: { files: ["supplier-hub-store"], firstActualDate: period.startDate, latestActualDate: period.endDate, eventCount: unique.size, selectedEventCount: unique.size, duplicateCount: duplicates, mode: "browser" },
    couponItems, couponReceiptKeys, vendorItems: [], warnings: ["저장된 전체 입고내역의 SKU별 총 입고수량이 1개인 대상을 기존 쿠폰 완료 이력과 대조합니다."], blockers: [...blockers] };
}
