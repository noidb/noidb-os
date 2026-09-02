import { NextRequest, NextResponse } from "next/server";
import { updateProductCatalogFields, type ProductCatalogUpdatePatch, type ProductCatalogWritableField } from "@/lib/wms/product-catalog-write";

/**
 * 제품DB 구글시트를 SKU ID 기준으로 직접 수정하는 API.
 * 사용자가 상품 상세 화면에서 저장을 눌렀을 때만 호출된다 — 자동 실행 없음.
 * dryRun:true로 보내면 실제로 쓰지 않고 대상 행만 확인한다(검증용).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WRITABLE_FIELDS: ProductCatalogWritableField[] = [
  "modelSku",
  "modelName",
  "productName",
  "optionLabel",
  "category",
  "vendorName",
  "warehouseNumber",
  "boxNumber",
  "currentStock",
  "currentStatus",
  "costVatIncluded",
  "barcode",
  "countryOfOrigin",
  "productLink",
  "imageUrl",
];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const skuId: string = body.skuId || "";
    const dryRun: boolean = Boolean(body.dryRun);

    const patch: ProductCatalogUpdatePatch = {};
    for (const field of WRITABLE_FIELDS) {
      if (typeof body[field] === "string") patch[field] = body[field];
    }

    const result = await updateProductCatalogFields(skuId, patch, { dryRun });
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { success: false, updatedFields: [], skippedFields: [], error: error instanceof Error ? error.message : "제품DB 수정 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
