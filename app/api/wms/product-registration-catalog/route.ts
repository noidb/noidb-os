import { NextResponse } from "next/server";
import { fetchProductCatalog } from "@/lib/wms/product-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 제품등록 연결 대장 전용 읽기 API. SKU 발급 전 행도 포함하며 시트에는 쓰지 않는다. */
export async function GET() {
  try {
    const result = await fetchProductCatalog({ includePending: true });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { configured: false, items: [], error: error instanceof Error ? error.message : "상품 연결 대장을 읽지 못했습니다." },
      { status: 500 },
    );
  }
}
