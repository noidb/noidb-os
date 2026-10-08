import { fetchSheetRows } from "./google-sheets";
import type { ProductCatalogItem } from "./product-catalog";

type StatusSourceItem = Pick<ProductCatalogItem, "skuId" | "currentStatus" | "orderableStatus" | "productName" | "optionLabel" | "reregistrationTier">;
const squash = (value: unknown) => String(value ?? "").replace(/\s+/g, "");

/**
 * 단종·단종해제 목록에 쓸 행: 제품DB 탭 + 보관 탭(2026-10-08 — 보관 탭의 거래처단종이 빠졌던 문제).
 * 같은 SKU가 두 탭에 있으면 제품DB 값을 쓴다. 보관 탭을 못 읽으면 제품DB만 쓴다.
 */
export async function loadStatusSourceItems(catalogItems: readonly ProductCatalogItem[]): Promise<{ items: StatusSourceItem[]; storageLoaded: boolean }> {
  const rows = await fetchSheetRows("보관").catch(() => null);
  if (!rows || !rows.length) return { items: [...catalogItems], storageLoaded: false };
  const headers = rows[0];
  const col = (...names: string[]) => headers.findIndex(header => names.some(name => squash(header) === squash(name)));
  const idx = { sku: col("SKU ID", "SKUID"), status: col("현재상태"), orderable: col("발주가능상태"), name: col("상품명"), option: col("옵션", "색상옵션명"), tier: col("재등록구분") };
  if (idx.sku < 0 || idx.status < 0) return { items: [...catalogItems], storageLoaded: false };
  const known = new Set(catalogItems.map(item => item.skuId));
  const storage: StatusSourceItem[] = [];
  for (const row of rows.slice(1)) {
    const skuId = String(row[idx.sku] ?? "").trim();
    if (!/^\d{1,20}$/.test(skuId) || known.has(skuId)) continue;
    known.add(skuId);
    const get = (index: number) => index >= 0 ? String(row[index] ?? "").trim() : "";
    storage.push({ skuId, currentStatus: get(idx.status), orderableStatus: get(idx.orderable), productName: get(idx.name), optionLabel: get(idx.option), reregistrationTier: get(idx.tier) });
  }
  return { items: [...catalogItems, ...storage], storageLoaded: true };
}
