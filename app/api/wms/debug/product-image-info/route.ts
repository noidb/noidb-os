import { NextRequest, NextResponse } from "next/server";
import { fetchSheetRows } from "@/lib/wms/google-sheets";
import { PRODUCT_DB_SHEET_NAME, normalizeSkuId } from "@/lib/wms/product-catalog";

/**
 * 개발 환경 전용 진단 API — 특정 SKU ID의 제품DB "이미지" 열 원본 셀 값을 그대로 보여준다
 * (2026-08-20 신규, WAVE-20260819-1 이미지 미표시 실제 원인 추적용). 프로덕션에서는 404로 막는다.
 * OAuth 토큰/서비스 계정 키 등은 다루지 않는다 — 제품DB 셀 값(공개적으로 시트에서 이미 보이는
 * 정보)만 반환한다.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const skuId = request.nextUrl.searchParams.get("skuId") || "";
  if (!skuId) return NextResponse.json({ error: "skuId required" }, { status: 400 });

  const rows = await fetchSheetRows(PRODUCT_DB_SHEET_NAME, { valueRenderOption: "FORMULA" });
  const headers = rows[0].map(h => String(h ?? "").trim());
  const idx = {
    skuId: headers.indexOf("SKU ID"),
    modelSku: headers.indexOf("모델SKU"),
    status: headers.indexOf("현재상태"),
    image: headers.indexOf("이미지"),
    productName: headers.indexOf("상품명"),
  };

  const target = normalizeSkuId(skuId);
  const matchRow = rows.slice(1).find(row => normalizeSkuId(row[idx.skuId]) === target);

  if (!matchRow) {
    return NextResponse.json({ found: false });
  }

  const rawImageCell = String(matchRow[idx.image] ?? "");
  return NextResponse.json({
    found: true,
    skuId: matchRow[idx.skuId],
    modelSku: matchRow[idx.modelSku],
    status: matchRow[idx.status],
    productName: matchRow[idx.productName],
    rawImageCell,
    rawImageCellLength: rawImageCell.length,
  });
}
