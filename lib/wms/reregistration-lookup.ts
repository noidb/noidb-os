import { fetchSheetRows } from "./google-sheets";

/**
 * 재등록SKU 탭과 _SKU교체이력 탭에서
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
  const [tab, history] = await Promise.all([
    fetchSheetRows("재등록SKU").catch(() => null),
    fetchSheetRows("_SKU교체이력").catch(() => null),
  ]);
  // 재등록SKU 탭: 새 SKU ID가 아닌 'SKU' 열(기존·이전 SKU)
  if (tab) readTab(tab, result, { skuHeader: header => /SKU/i.test(header) && !/새|모델/.test(header) });
  // 교체이력: 동일모델재등록·재등록중복정리의 이전 SKU ID
  if (history) readTab(history, result, {
    skuHeader: header => header === "이전SKUID",
    onlyWhen: (row, headers) => ["동일모델재등록", "재등록중복정리"].includes(clean(row[headers.indexOf("처리상태")])),
  });
  result.loaded = Boolean(tab || history);
  return result;
}
