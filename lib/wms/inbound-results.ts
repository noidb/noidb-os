import { fetchSheetRows, rowsToObjects } from "./google-sheets";
import { fetchProductCatalog, normalizeSkuId, type ProductCatalogItem } from "./product-catalog";

export const INBOUND_HISTORY_SHEET = "_입고요약";
export const PURCHASE_HISTORY_SHEET = "_발주이력";

interface InboundEntry {
  po: string;
  skuId: string;
  productName: string;
  actualDate: string;
  netInbound: number;
}

interface PurchaseEntry {
  po: string;
  skuId: string;
  productName: string;
  confirmedQuantity: number;
  status: string;
}

export interface InboundResultItem {
  skuId: string;
  productName: string;
  productLink: string;
}

export interface InboundNameConflict {
  skuId: string;
  names: string[];
}

export interface InboundDateResult {
  actualDate: string;
  purchaseOrderCount: number;
  receivedSkuCount: number;
  partialSkuCount: number;
  missingSkuCount: number;
  couponItems: InboundResultItem[];
  missingItems: InboundResultItem[];
  nameConflicts: InboundNameConflict[];
}

function numberValue(value: unknown): number {
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedDate(value: unknown): string {
  const text = String(value || "").trim();
  const match = text.match(/(20\d{2})[/.\-](\d{1,2})[/.\-](\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : "";
}

function text(row: Record<string, string>, names: string[]): string {
  for (const name of names) {
    const value = String(row[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function inboundEntries(rows: string[][]): InboundEntry[] {
  return rowsToObjects(rows).map(row => ({
    po: text(row, ["발주번호"]),
    skuId: normalizeSkuId(text(row, ["SKU ID"])),
    productName: text(row, ["상품명"]),
    actualDate: normalizedDate(text(row, ["최근입고일", "실제입고일"])),
    netInbound: numberValue(text(row, ["순입고", "입고수량", "총입고"])) - (row["순입고"] ? 0 : numberValue(row["반출"])),
  })).filter(item => item.po && item.skuId && item.actualDate);
}

function purchaseEntries(rows: string[][]): PurchaseEntry[] {
  return rowsToObjects(rows).map(row => ({
    po: text(row, ["발주번호"]),
    skuId: normalizeSkuId(text(row, ["SKU ID"])),
    productName: text(row, ["상품명"]),
    confirmedQuantity: numberValue(row["확정수량"]) || numberValue(row["발주수량"]),
    status: text(row, ["발주현황"]),
  })).filter(item => item.po && item.skuId && item.confirmedQuantity > 0 && !/취소|반려|무효/.test(item.status));
}

function normalizedName(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("ko-KR");
}

function nameForSku(
  skuId: string,
  purchases: PurchaseEntry[],
  inbounds: InboundEntry[],
  catalog: Map<string, ProductCatalogItem>,
): { name: string; conflict?: InboundNameConflict } {
  const levels = [
    purchases.filter(item => item.skuId === skuId).map(item => item.productName),
    inbounds.filter(item => item.skuId === skuId).map(item => item.productName),
    [catalog.get(skuId)?.productName || ""],
  ];
  for (const candidates of levels) {
    const names = Array.from(new Map(candidates.filter(Boolean).map(name => [normalizedName(name), name.trim()])).values());
    if (!names.length) continue;
    return names.length === 1 ? { name: names[0] } : { name: "", conflict: { skuId, names } };
  }
  return { name: "", conflict: { skuId, names: [] } };
}

export function buildInboundDateResults(
  inboundRows: string[][],
  purchaseRows: string[][],
  catalogItems: ProductCatalogItem[],
): InboundDateResult[] {
  const inbounds = inboundEntries(inboundRows);
  const purchases = purchaseEntries(purchaseRows);
  const catalog = new Map(catalogItems.map(item => [normalizeSkuId(item.skuId), item]));
  const cumulativeByPoSku = new Map<string, number>();
  for (const item of inbounds) {
    const key = `${item.po}|${item.skuId}`;
    cumulativeByPoSku.set(key, (cumulativeByPoSku.get(key) || 0) + item.netInbound);
  }
  const dates = Array.from(new Set(inbounds.filter(item => item.netInbound > 0).map(item => item.actualDate))).sort().reverse();
  return dates.map(actualDate => {
    const dayRows = inbounds.filter(item => item.actualDate === actualDate && item.netInbound > 0);
    const dayPurchaseOrders = new Set(dayRows.map(item => item.po));
    const scopedPurchases = purchases.filter(item => dayPurchaseOrders.has(item.po));
    const scopedInbounds = inbounds.filter(item => dayPurchaseOrders.has(item.po));
    const couponSkuIds = Array.from(new Set(dayRows.map(item => item.skuId)));
    const purchaseTotals = new Map<string, { po: string; skuId: string; quantity: number }>();
    for (const item of scopedPurchases) {
      const key = `${item.po}|${item.skuId}`;
      const current = purchaseTotals.get(key) || { po: item.po, skuId: item.skuId, quantity: 0 };
      current.quantity += item.confirmedQuantity;
      purchaseTotals.set(key, current);
    }
    const missingSkuIds = Array.from(new Set(Array.from(purchaseTotals.values())
      .filter(item => item.quantity - Math.max(0, cumulativeByPoSku.get(`${item.po}|${item.skuId}`) || 0) > 0)
      .map(item => item.skuId)));
    const conflicts = new Map<string, InboundNameConflict>();
    const toItems = (skuIds: string[]) => skuIds.map(skuId => {
      const result = nameForSku(skuId, scopedPurchases, scopedInbounds, catalog);
      if (result.conflict) conflicts.set(skuId, result.conflict);
      return { skuId, productName: result.name, productLink: catalog.get(skuId)?.productLink || "" };
    }).sort((a, b) => a.skuId.localeCompare(b.skuId, "ko-KR", { numeric: true }));
    const couponItems = toItems(couponSkuIds);
    const missingItems = toItems(missingSkuIds);
    const missingSet = new Set(missingSkuIds);
    return {
      actualDate, purchaseOrderCount: dayPurchaseOrders.size, receivedSkuCount: couponItems.length,
      partialSkuCount: couponSkuIds.filter(skuId => missingSet.has(skuId)).length,
      missingSkuCount: missingItems.length, couponItems, missingItems, nameConflicts: Array.from(conflicts.values()),
    };
  });
}

export async function getInboundDateResults(): Promise<InboundDateResult[]> {
  const [inboundRows, purchaseRows, catalog] = await Promise.all([
    fetchSheetRows(INBOUND_HISTORY_SHEET), fetchSheetRows(PURCHASE_HISTORY_SHEET), fetchProductCatalog(),
  ]);
  return buildInboundDateResults(inboundRows, purchaseRows, catalog.items);
}
