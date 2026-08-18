import { NextResponse } from "next/server";
import { fetchProductCatalog } from "@/lib/wms/product-catalog";

/**
 * NOID WMS 제품DB 읽기 전용 API. "제품DB" 시트에서 상품코드(SKU ID)→모델명/카테고리 매핑만 반환한다.
 * app/api/wms/purchase-orders와 동일한 패턴: GET만 존재한다 (POST/PUT/DELETE 없음 = 쓰기 불가).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { configured, items } = await fetchProductCatalog();
    return NextResponse.json({ configured, items });
  } catch (error) {
    return NextResponse.json(
      {
        configured: true,
        items: [],
        error: error instanceof Error ? error.message : "제품DB 조회 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}
