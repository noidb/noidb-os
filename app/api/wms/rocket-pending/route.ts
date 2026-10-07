import { NextRequest, NextResponse } from "next/server";
import data from "@/data/rocket-pending.json";

export const runtime = "nodejs";

type RocketPendingRow = {
  skuId: string; modelSku: string; modelName: string; category: string; gender: string;
  productName: string; optionLabel: string; barcode: string; orderableStatus: string;
  exposedProductId: string; modelSource: string;
};

/**
 * 로켓 미등록 상품(제품DB에 없는 상품공급상태 SKU) 목록 — 읽기 전용.
 * data/rocket-pending.json은 scripts/build-rocket-pending.py로 만든다(공급상태·연결표·Wing 상품정보 다운로드).
 * 모델명은 Wing "모델번호"에서 이었다. modelSource에 "확인 필요"가 있으면 비슷한 상품명으로 붙인 것이다.
 */
export async function GET(request: NextRequest) {
  const model = (request.nextUrl.searchParams.get("model") || "").trim().toLowerCase();
  const rows = (data as { items: RocketPendingRow[] }).items;
  const items = rows
    .filter(row => !model || row.modelName === model)
    .map(row => ({
      ...row,
      rocketPending: true,
      imageUrl: "", warehouseNumber: "", boxNumber: "", currentStock: "", currentStatus: "", costVatIncluded: "",
      vendorName: "", countryOfOrigin: "", productLink: "", productCode: "", reregistrationTier: "", photoFolder: "",
      jewelrySize: "", dimension: "", salePrice: "", cumulativeInbound: "",
    }));
  return NextResponse.json({ items, generatedFrom: (data as { generatedFrom?: string[] }).generatedFrom || [] });
}
