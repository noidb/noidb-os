/**
 * 쿠팡 원발주서 매입가 → 구글시트 '최근쿠팡공급가' 자동 입력(사용자 요청 2026-10-23)
 *
 * 원발주서(발주서리스트다운 폴더)의 "공급가 > 매입가"(부가세 포함 단가)를 SKU별로 모아, 입고예정일이 가장 늦은
 * 발주의 매입가를 그 SKU 줄의 '최근쿠팡공급가'에 적는다. 값이 바뀌면 원래 값은 '이전쿠팡공급가'로 옮기고
 * '공급가차이'(최근-이전)·'공급가확인'(일치/확인필요/기준없음)을 같이 적는다. 값이 같으면 아무것도 쓰지 않는다.
 * SKU가 있는 탭(제품DB·비관리SKU·실적저조SKU·그 외 재등록SKU·판매중지SKU) 어디든 그 줄에 적는다.
 */
import type { PurchaseOrderIndex } from "./purchase-order-source/types";
import { normalizeSkuId } from "./sku-normalize";

export interface LatestPurchasePrice { price: number; expectedDate: string; purchaseOrderNumber: string }

/** SKU별 가장 늦은 입고예정일 발주의 매입가. 같은 날이면 나중에 읽은(최신 파일) 발주. */
export function latestPurchasePrices(index: Pick<PurchaseOrderIndex, "byPurchaseOrderNumber">): Map<string, LatestPurchasePrice> {
  const result = new Map<string, LatestPurchasePrice>();
  for (const document of index.byPurchaseOrderNumber.values()) {
    for (const record of document.records) {
      const sku = normalizeSkuId(record.skuId);
      const price = Number(record.unitPrice || 0);
      if (!/^\d{1,20}$/.test(sku) || !(price > 0)) continue;
      const expectedDate = String(record.expectedArrivalDate || document.expectedArrivalDate || "");
      const current = result.get(sku);
      if (!current || expectedDate >= current.expectedDate) result.set(sku, { price, expectedDate, purchaseOrderNumber: document.purchaseOrderNumber });
    }
  }
  return result;
}

export interface SupplyPriceCellUpdate { row: number; col: number; value: string | number }
export interface SupplyPricePlan { updates: SupplyPriceCellUpdate[]; changed: string[] }

const header = (value: unknown) => String(value ?? "").replace(/\s+/g, "");
const toNumber = (value: unknown) => {
  const number = Number(String(value ?? "").replace(/[,원\s]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : 0;
};

/** rows: 첫 줄이 제목줄인 탭 값. 바꿀 칸만 돌려준다(행·열 번호는 1부터, 시트에 보이는 번호). */
export function planSupplyPriceSync(rows: readonly (readonly unknown[])[], prices: ReadonlyMap<string, LatestPurchasePrice>): SupplyPricePlan {
  const headers = (rows[0] || []).map(header);
  const col = {
    sku: headers.indexOf("SKUID"),
    previous: headers.indexOf("이전쿠팡공급가"),
    latest: headers.indexOf("최근쿠팡공급가"),
    diff: headers.indexOf("공급가차이"),
    check: headers.indexOf("공급가확인"),
  };
  if (col.sku < 0 || col.latest < 0) return { updates: [], changed: [] };
  const updates: SupplyPriceCellUpdate[] = [];
  const changed: string[] = [];
  rows.forEach((row, index) => {
    if (index === 0) return;
    const sku = normalizeSkuId(String(row[col.sku] ?? ""));
    const next = prices.get(sku);
    if (!next) return;
    const latest = toNumber(row[col.latest]);
    if (latest === next.price) return;
    const sheetRow = index + 1;
    const previous = latest || (col.previous >= 0 ? toNumber(row[col.previous]) : 0);
    updates.push({ row: sheetRow, col: col.latest + 1, value: next.price });
    if (latest && col.previous >= 0) updates.push({ row: sheetRow, col: col.previous + 1, value: latest });
    if (col.diff >= 0) updates.push({ row: sheetRow, col: col.diff + 1, value: previous ? next.price - previous : "" });
    if (col.check >= 0) updates.push({ row: sheetRow, col: col.check + 1, value: previous ? (previous === next.price ? "일치" : "확인필요") : "기준없음" });
    changed.push(sku);
  });
  return { updates, changed };
}
