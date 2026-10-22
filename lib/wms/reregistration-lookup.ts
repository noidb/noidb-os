import { fetchSheetRows } from "./google-sheets";
import { REREGISTRATION_TABS, RETIRED_SKU_TABS } from "./retired-sku-tabs";

/**
 * 옛 SKU 탭(실적저조SKU·그 외 재등록SKU·판매중지SKU, 예전 이름 재등록SKU)과 _SKU교체이력 탭에서
 * - 재등록으로 바뀐 옛 SKU(단종·단종해제 대상에서 빼야 함)
 * - 제품DB에 없는 SKU의 상품명
 * 을 모은다. 탭이 없거나 못 읽으면 빈 값으로 넘긴다(목록 계산은 계속).
 */
export interface ReregistrationLookup { reregisteredSkuIds: Set<string>; names: Record<string, string>; loaded: boolean }

const clean = (value: unknown) => String(value ?? "").trim();
function readTab(rows: string[][], into: ReregistrationLookup, options: { skuHeader: (header: string) => boolean; onlyWhen?: (row: string[], headers: string[]) => boolean }) {
  if (!rows.length) return;
  const headers = rows[0].map(clean);
  const skuColumns = headers.map((header, index) => options.skuHeader(header.replace(/\s+/g, "")) ? index : -1).filter(index => index >= 0);
  const nameColumn = headers.findIndex(header => header.replace(/\s+/g, "").includes("상품명"));
  for (const row of rows.slice(1)) {
    if (options.onlyWhen && !options.onlyWhen(row, headers)) continue;
    for (const column of skuColumns) {
      const skuId = clean(row[column]);
      if (!/^\d{5,20}$/.test(skuId)) continue;
      into.reregisteredSkuIds.add(skuId);
      if (nameColumn >= 0 && clean(row[nameColumn]) && !into.names[skuId]) into.names[skuId] = clean(row[nameColumn]);
    }
  }
}

export async function loadReregistrationLookup(): Promise<ReregistrationLookup> {
  const result: ReregistrationLookup = { reregisteredSkuIds: new Set(), names: {}, loaded: false };
  const [tabRows, history] = await Promise.all([
    Promise.all(RETIRED_SKU_TABS.map(title => fetchSheetRows(title).catch(() => null))),
    fetchSheetRows("_SKU교체이력").catch(() => null),
  ]);
  // 옛 SKU 탭: 새 SKU ID가 아닌 'SKU' 열(기존·이전 SKU)
  const tabs = tabRows.filter((rows): rows is string[][] => Boolean(rows?.length));
  for (const tab of tabs) readTab(tab, result, { skuHeader: header => /SKU/i.test(header) && !/새|모델/.test(header) });
  // 교체이력: 동일모델재등록·재등록중복정리의 이전 SKU ID
  if (history) readTab(history, result, {
    skuHeader: header => header === "이전SKUID",
    onlyWhen: (row, headers) => ["동일모델재등록", "재등록중복정리"].includes(clean(row[headers.indexOf("처리상태")])),
  });
  result.loaded = Boolean(tabs.length || history);
  return result;
}

export { REREGISTRATION_TAB_TIER } from "./reregistration-tab-tier";

/**
 * 재등록 탭(실적저조SKU·그 외 재등록SKU, 예전 이름 재등록SKU)에서 아직 재등록이 끝나지 않은 기존 SKU ID.
 * 진행상태가 '완료'이거나 새 SKU ID가 적힌 줄은 끝난 것으로 보고 뺀다. 탭을 못 읽으면 빈 목록.
 */
export async function loadPendingReregistrationSkuIds(): Promise<Set<string>> {
  const result = new Set<string>();
  for (const rows of await Promise.all(REREGISTRATION_TABS.map(title => fetchSheetRows(title).catch(() => null)))) {
    if (rows?.length) collectPending(rows, result);
  }
  return result;
}

function collectPending(rows: string[][], result: Set<string>) {
  const headers = rows[0].map(header => clean(header).replace(/\s+/g, ""));
  const skuColumn = headers.indexOf("SKUID");
  const stateColumn = headers.indexOf("진행상태");
  const newSkuColumn = headers.indexOf("새SKUID");
  if (skuColumn < 0) return result;
  for (const row of rows.slice(1)) {
    const skuId = clean(row[skuColumn]);
    if (!/^\d{5,20}$/.test(skuId)) continue;
    if (stateColumn >= 0 && clean(row[stateColumn]).includes("완료")) continue;
    if (newSkuColumn >= 0 && clean(row[newSkuColumn])) continue;
    result.add(skuId);
  }
  return result;
}
