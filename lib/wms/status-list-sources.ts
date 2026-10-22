import { fetchSheetRows, fetchSpreadsheetTabs } from "./google-sheets";
import { pickStorageTabTitle } from "./warehouse-recheck-cleanup";
import type { ProductCatalogItem } from "./product-catalog";
import { STOPPED_TAB } from "./retired-sku-tabs";

type StatusSourceItem = Pick<ProductCatalogItem, "skuId" | "currentStatus" | "orderableStatus" | "productName" | "optionLabel" | "reregistrationTier"> & { /** 비관리SKU 탭에서 온 줄 */ storageTab?: boolean; /** 판매중지SKU 탭처럼 제품DB 밖 탭에서 온 줄(목록의 사유 칸에 탭 이름) */ sourceTab?: string; /** 비관리SKU '원본 위치'의 탭 이름(예: 제품DB) — 어디서 옮겨 왔는지 */ origin?: string };
const squash = (value: unknown) => String(value ?? "").replace(/\s+/g, "");

/**
 * 단종·단종해제 목록에 쓸 행: 제품DB 탭 + 보관 탭(2026-10-08 — 보관 탭의 거래처단종이 빠졌던 문제).
 * 같은 SKU가 두 탭에 있으면 제품DB 값을 쓴다. 보관 탭을 못 읽으면 제품DB만 쓴다.
 */
export async function loadStatusSourceItems(catalogItems: readonly ProductCatalogItem[]): Promise<{ items: StatusSourceItem[]; storageLoaded: boolean }> {
  // 보관 탭 = '비관리SKU'(예전 '_보관_비관리SKU_20261008', 2026-10-19): 제품DB에서 옮긴 거래처단종·단종도 단종 대상에 계속 잡히게 한다.
  const titles = await fetchSpreadsheetTabs().then(tabs => tabs.map(tab => tab.title)).catch(() => [] as string[]);
  const title = titles.length ? pickStorageTabTitle(titles) : "보관";
  // 2026-10-22: 판매중지 SKU는 제품DB가 아니라 판매중지SKU 탭에 있다. 쿠팡이 아직 '정상'이면 계속 단종 대상에 잡히게 함께 읽는다.
  const [rows, stoppedRows] = await Promise.all([
    title ? fetchSheetRows(title).catch(() => null) : Promise.resolve(null),
    titles.includes(STOPPED_TAB) ? fetchSheetRows(STOPPED_TAB).catch(() => null) : Promise.resolve(null),
  ]);
  const known = new Set(catalogItems.map(item => item.skuId));
  const stopped = (stoppedRows?.length ? readRows(stoppedRows, known, { sourceTab: STOPPED_TAB }) : null) || [];
  if (!rows || !rows.length) return { items: [...catalogItems, ...stopped], storageLoaded: false };
  const storage = readRows(rows, known, { storageTab: true });
  if (!storage) return { items: [...catalogItems, ...stopped], storageLoaded: false };
  return { items: [...catalogItems, ...stopped, ...storage], storageLoaded: true };
}

function readRows(rows: string[][], known: Set<string>, mark: Pick<StatusSourceItem, "storageTab" | "sourceTab">): StatusSourceItem[] | null {
  const headers = rows[0];
  const col = (...names: string[]) => headers.findIndex(header => names.some(name => squash(header) === squash(name)));
  const loose = (test: (header: string) => boolean) => headers.findIndex(header => test(squash(header)));
  // 칸 이름이 조금 달라도 찾는다(예: SKU / SKU ID / 쿠팡 SKU ID, 상품명 / 제품명).
  const idx = {
    sku: col("SKU ID", "SKUID") >= 0 ? col("SKU ID", "SKUID") : loose(header => /SKU/i.test(header) && !/모델|새|이전/.test(header)),
    status: col("현재상태") >= 0 ? col("현재상태") : loose(header => header.includes("상태") && !header.includes("발주")),
    orderable: col("발주가능상태") >= 0 ? col("발주가능상태") : loose(header => header.includes("발주가능")),
    name: col("상품명") >= 0 ? col("상품명") : loose(header => header.includes("상품명") || header.includes("제품명")),
    option: col("옵션", "색상옵션명"), tier: col("재등록구분"), origin: col("원본 위치"),
  };
  if (idx.sku < 0) return null;
  const out: StatusSourceItem[] = [];
  for (const row of rows.slice(1)) {
    const skuId = String(row[idx.sku] ?? "").trim();
    if (!/^\d{1,20}$/.test(skuId) || known.has(skuId)) continue;
    known.add(skuId);
    const get = (index: number) => index >= 0 ? String(row[index] ?? "").trim() : "";
    out.push({ skuId, currentStatus: get(idx.status), orderableStatus: get(idx.orderable), productName: get(idx.name), optionLabel: get(idx.option), reregistrationTier: get(idx.tier), origin: get(idx.origin).split("!")[0].trim() || undefined, ...mark });
  }
  return out;
}
