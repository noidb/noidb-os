import { NextResponse } from "next/server";
import { fetchCatalogItemsFromTab, fetchProductCatalog, type CatalogItemWithTab } from "@/lib/wms/product-catalog";
import { REREGISTRATION_TAB_TIER, loadPendingReregistrationSkuIds } from "@/lib/wms/reregistration-lookup";
import { fetchSpreadsheetTabs } from "@/lib/wms/google-sheets";
import { OTHER_REREGISTRATION_TAB, STOPPED_TAB, pickLowPerformanceTab } from "@/lib/wms/retired-sku-tabs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 제품등록 연결 대장(사진선택) 전용 읽기 API. SKU 발급 전 행도 포함하며 시트에는 쓰지 않는다.
 * 2026-10-22: 옛 SKU는 제품DB가 아니라 실적저조SKU·그 외 재등록SKU·판매중지SKU 탭에 있으므로
 * 그 탭의 줄도 함께 보낸다(sourceTab = 탭 이름). 같은 모델의 제품DB 줄과 한 묶음으로 보여 재등록할 수 있다.
 * 제품DB 줄 중 실적저조SKU 탭에서 아직 끝나지 않은 SKU는 재등록구분을 '재등록SKU탭'으로 채운다(예전 방식 유지).
 */
export async function GET() {
  try {
    const [result, pending, tabs] = await Promise.all([
      fetchProductCatalog({ includePending: true }),
      loadPendingReregistrationSkuIds(),
      fetchSpreadsheetTabs(),
    ]);
    const titles = tabs.map(tab => tab.title);
    const lowTab = pickLowPerformanceTab(titles);
    const tabTitles = [lowTab, OTHER_REREGISTRATION_TAB, STOPPED_TAB].filter((title): title is string => Boolean(title) && titles.includes(title!));
    const tabItems = (await Promise.all(tabTitles.map(title => fetchCatalogItemsFromTab(title)))).flat()
      .map(item => item.sourceTab === lowTab && !String(item.reregistrationTier || "").trim() ? { ...item, reregistrationTier: REREGISTRATION_TAB_TIER } : item);
    const dbItems: CatalogItemWithTab[] = result.items.map(item => !String(item.reregistrationTier || "").trim() && pending.has(String(item.skuId || "").trim())
      ? { ...item, reregistrationTier: REREGISTRATION_TAB_TIER }
      : item);
    // 한 SKU는 한 탭에만 있어야 하지만, 혹시 겹치면 제품DB 줄을 남긴다.
    const dbSkus = new Set(dbItems.map(item => String(item.skuId || "").trim()).filter(Boolean));
    const items = [...dbItems, ...tabItems.filter(item => !item.skuId || !dbSkus.has(String(item.skuId).trim()))];
    return NextResponse.json({ ...result, items, tabs: { lowPerformance: lowTab, other: OTHER_REREGISTRATION_TAB, stopped: STOPPED_TAB } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { configured: false, items: [], error: error instanceof Error ? error.message : "상품 연결 대장을 읽지 못했습니다." },
      { status: 500 },
    );
  }
}
