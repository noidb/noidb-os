import { NextResponse } from "next/server";
import { fetchProductCatalog } from "@/lib/wms/product-catalog";
import { REREGISTRATION_TAB_TIER, loadPendingReregistrationSkuIds } from "@/lib/wms/reregistration-lookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 제품등록 연결 대장 전용 읽기 API. SKU 발급 전 행도 포함하며 시트에는 쓰지 않는다.
 * 제품DB에 '재등록구분' 열이 없어져서, 재등록SKU 탭에서 아직 끝나지 않은 SKU는
 * 재등록구분을 '재등록SKU탭'으로 채워 사진선택 '재등록 필요' 목록에 나오게 한다(구분 값이 이미 있으면 그대로).
 */
export async function GET() {
  try {
    const [result, pending] = await Promise.all([
      fetchProductCatalog({ includePending: true }),
      loadPendingReregistrationSkuIds(),
    ]);
    const items = result.items.map(item => !String(item.reregistrationTier || "").trim() && pending.has(String(item.skuId || "").trim())
      ? { ...item, reregistrationTier: REREGISTRATION_TAB_TIER }
      : item);
    return NextResponse.json({ ...result, items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { configured: false, items: [], error: error instanceof Error ? error.message : "상품 연결 대장을 읽지 못했습니다." },
      { status: 500 },
    );
  }
}
