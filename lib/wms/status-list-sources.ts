import { fetchSheetRows, fetchSpreadsheetTabs } from "./google-sheets";
import { pickStorageTabTitle } from "./warehouse-recheck-cleanup";
import type { ProductCatalogItem } from "./product-catalog";
import { OTHER_REREGISTRATION_TAB, STOPPED_TAB, pickLowPerformanceTab } from "./retired-sku-tabs";

type StatusSourceItem = Pick<ProductCatalogItem, "skuId" | "currentStatus" | "orderableStatus" | "productName" | "optionLabel" | "reregistrationTier"> & { productLink?: string } & { /** 비관리SKU 탭에서 온 줄 */ storageTab?: boolean; /** 판매중지SKU 탭처럼 제품DB 밖 탭에서 온 줄(목록의 사유 칸에 탭 이름) */ sourceTab?: string; /** 비관리SKU '원본 위치'의 탭 이름(예: 제품DB) — 어디서 옮겨 왔는지 */ origin?: string; /** 비관리SKU '보관사유'(옮긴 이유) */ moveReason?: string };
const squash = (value: unknown) => String(value ?? "").replace(/\s+/g, "");

/**
 * 단종·단종해제 목록에 쓸 행: 제품DB 탭 + 보관 탭(2026-10-08 — 보관 탭의 거래처단종이 빠졌던 문제).
 * 같은 SKU가 두 탭에 있으면 제품DB 값을 쓴다. 보관 탭을 못 읽으면 제품DB만 쓴다.
 */
export async function loadStatusSourceItems(catalogItems: readonly ProductCatalogItem[]): Promise<{ items: StatusSourceItem[]; storageLoaded: boolean; tabsBySku: Record<string, string[]> }> {
  // 보관 탭 = '비관리SKU'(예전 '_보관_비관리SKU_20261008', 2026-10-19): 제품DB에서 옮긴 거래처단종·단종도 단종 대상에 계속 잡히게 한다.
  const titles = await fetchSpreadsheetTabs().then(tabs => tabs.map(tab => tab.title)).catch(() => [] as string[]);
  const title = titles.length ? pickStorageTabTitle(titles) : "보관";
  // 2026-10-22: 판매중지 SKU는 제품DB가 아니라 판매중지SKU 탭에 있다. 쿠팡이 아직 '정상'이면 계속 단종 대상에 잡히게 함께 읽는다.
  // 2026-10-23: 실적저조SKU·그 외 재등록SKU도 읽는다 — 옛 SKU 탭에 있는데 쿠팡이 아직 '정상'이면 단종 대상.
  const lowTab = pickLowPerformanceTab(titles);
  const retiredTabs = [STOPPED_TAB, lowTab, OTHER_REREGISTRATION_TAB].filter((tab): tab is string => Boolean(tab) && titles.includes(tab!));
  // 한 번 실패하면(일시적인 시트 읽기 오류) 한 번 더 읽는다 — 탭을 못 읽으면 그 탭의 SKU가 엉뚱한 사유로 보였다(2026-10-23).
  const read = (tab: string) => fetchSheetRows(tab).catch(() => fetchSheetRows(tab)).catch(() => null);
  const [rows, ...retiredRows] = await Promise.all([
    title ? read(title) : Promise.resolve(null),
    ...retiredTabs.map(tab => read(tab)),
  ]);
  // 2026-10-23 사용자 요청: 목록에 'SKU가 지금 어느 탭에 있는지'를 보여 준다(그 탭에서 바로 검색할 수 있게).
  const tabsBySku: Record<string, string[]> = {};
  const note = (skuId: string, tab: string) => { if (skuId && !(tabsBySku[skuId] ||= []).includes(tab)) tabsBySku[skuId].push(tab); };
  for (const item of catalogItems) note(item.skuId, "제품DB");
  retiredTabs.forEach((tab, index) => skuIdsOf(retiredRows[index]).forEach(skuId => note(skuId, tab === lowTab ? "실적저조SKU" : tab)));
  skuIdsOf(rows).forEach(skuId => note(skuId, "비관리SKU"));
  const known = new Set(catalogItems.map(item => item.skuId));
  const stopped = retiredTabs.flatMap((tab, index) => (retiredRows[index]?.length ? readRows(retiredRows[index]!, known, { sourceTab: tab === lowTab ? "실적저조SKU" : tab }) : null) || []);
  if (!rows || !rows.length) return { items: [...catalogItems, ...stopped], storageLoaded: false, tabsBySku };
  const storage = readRows(rows, known, { storageTab: true });
  if (!storage) return { items: [...catalogItems, ...stopped], storageLoaded: false, tabsBySku };
  return { items: [...catalogItems, ...stopped, ...storage], storageLoaded: true, tabsBySku };
}

/**
 * 비관리SKU 줄이 원래 있던 탭(2026-10-23 사용자 확인: 비관리SKU는 원래 제품DB에서 온 것).
 * '원본 위치'가 지금 쓰는 탭(제품DB·실적저조SKU 등)이면 그대로, 실적저조(재등록SKU) 탭에서 중복으로 옮긴 줄(보관사유 '재등록완료(새 SKU …)')은 실적저조SKU,
 * 비었거나 예전 임시 탭(_중복옛SKU 등)이면 제품DB.
 */
export function storageOrigin(raw: string, moveReason: string): string {
  const tab = raw.split("!")[0].trim();
  if (tab === "재등록SKU" || tab === "실적저조SKU") return "실적저조SKU";
  if (["제품DB", "판매중지SKU", "그 외 재등록SKU", "창고재확인"].includes(tab)) return tab;
  if (/^재등록완료\(새 SKU/.test(moveReason)) return "실적저조SKU";
  return "제품DB";
}

function skuIdsOf(rows: string[][] | null | undefined): string[] {
  if (!rows?.length) return [];
  const col = rows[0].findIndex(header => squash(header) === "SKUID");
  return col < 0 ? [] : rows.slice(1).map(row => String(row[col] ?? "").trim()).filter(id => /^\d{1,20}$/.test(id));
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
    option: col("옵션", "색상옵션명"), tier: col("재등록구분"), origin: col("원본 위치"), link: col("제품링크"), moveReason: col("보관사유"),
  };
  if (idx.sku < 0) return null;
  const out: StatusSourceItem[] = [];
  for (const row of rows.slice(1)) {
    const skuId = String(row[idx.sku] ?? "").trim();
    if (!/^\d{1,20}$/.test(skuId) || known.has(skuId)) continue;
    known.add(skuId);
    const get = (index: number) => index >= 0 ? String(row[index] ?? "").trim() : "";
    out.push({ skuId, currentStatus: get(idx.status), orderableStatus: get(idx.orderable), productName: get(idx.name), optionLabel: get(idx.option), reregistrationTier: get(idx.tier), origin: mark.storageTab ? storageOrigin(get(idx.origin), get(idx.moveReason)) : undefined, productLink: get(idx.link), moveReason: get(idx.moveReason) || undefined, ...mark });
  }
  return out;
}
