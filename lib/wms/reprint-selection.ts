export interface BarcodeSearchResult {
  purchaseOrderNumber: string;
  skuId: string;
  barcode: string;
  productName: string;
  optionName: string;
  fulfillmentCenter: string;
  expectedDate: string;
}

export interface ReprintItem extends BarcodeSearchResult {
  quantity: number;
  checked: boolean;
}

export const REPRINT_LIMIT = 200;
export const REPRINT_SESSION_KEY = "noidb_wms_reprint_list_v2";
export const LEGACY_REPRINT_KEY = "noidb_wms_reprint_selection_v1";

export function reprintKey(item: Pick<BarcodeSearchResult, "skuId" | "barcode">) {
  return `${item.skuId}:${item.barcode}`;
}

export function mergeReprintItems(previous: ReprintItem[], results: BarcodeSearchResult[]): ReprintItem[] {
  const merged = new Map(previous.map(item => [reprintKey(item), item]));
  for (const result of results) {
    const existing = merged.get(reprintKey(result));
    merged.set(reprintKey(result), existing ? { ...existing, checked: true } : { ...result, quantity: 1, checked: true });
  }
  if (merged.size > REPRINT_LIMIT) throw new Error(`목록은 최대 ${REPRINT_LIMIT}종입니다. 기존 목록을 먼저 저장한 뒤 새 목록으로 시작해 주세요. 이번 검색은 추가하지 않았습니다.`);
  return [...merged.values()];
}

export function restoreReprintSession(raw: string | null): { query: string; items: ReprintItem[] } {
  try {
    const data = JSON.parse(raw || "null");
    const candidates = Array.isArray(data) ? data : data?.items;
    const items: ReprintItem[] = [];
    for (const candidate of Array.isArray(candidates) ? candidates : []) {
      if (!["purchaseOrderNumber", "skuId", "barcode", "productName", "optionName", "fulfillmentCenter", "expectedDate"].every(key => typeof candidate?.[key] === "string")) continue;
      if (!candidate.skuId || !candidate.barcode || !candidate.purchaseOrderNumber || items.some(item => reprintKey(item) === reprintKey(candidate))) continue;
      items.push({ ...candidate, quantity: Math.max(1, Math.min(1000, Math.floor(Number(candidate.quantity) || 1))), checked: candidate.checked !== false });
      if (items.length === REPRINT_LIMIT) break;
    }
    return { query: typeof data?.query === "string" ? data.query : "", items };
  } catch {
    return { query: "", items: [] };
  }
}
