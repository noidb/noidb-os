import { NextRequest, NextResponse } from "next/server";
import data from "@/data/rocket-pending.json";
import { changeRocketPendingOverrides, readRocketPendingOverrides } from "@/lib/wms/rocket-pending-overrides";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RocketPendingRow = {
  skuId: string; modelSku: string; modelName: string; category: string; gender: string;
  productName: string; optionLabel: string; barcode: string; orderableStatus: string;
  exposedProductId: string; modelSource: string;
};
const rows = (data as { items: RocketPendingRow[] }).items;
const knownSkus = new Set(rows.map(row => row.skuId));
const MODEL_PATTERN = /^[a-z]{1,4}\d{3,7}[a-z]{0,3}$/;

/**
 * 로켓 미등록 상품(쿠팡 Wing에만 있고 로켓 Supplier Hub에는 없는 상품) 목록. skuId는 "wing:옵션ID".
 * data/rocket-pending.json(scripts/build-rocket-pending.py) 위에
 * 사용자가 화면에서 직접 넣거나 고친 모델명·카테고리·성별(SKU ID 기준)을 덮어쓴다.
 */
export async function GET(request: NextRequest) {
  const model = (request.nextUrl.searchParams.get("model") || "").trim().toLowerCase();
  // 삭제한 상품은 기본 목록에서 빼고, ?deleted=1이면 삭제한 상품만 돌려준다(되살리기용).
  const showDeleted = request.nextUrl.searchParams.get("deleted") === "1";
  const overrides = await readRocketPendingOverrides().catch(() => null);
  if (!overrides) return NextResponse.json({ error: "Wing 등록검토 정리 상태를 읽지 못했습니다. 다시 시도해 주세요." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const items = rows
    .map(row => {
      const edit = overrides[row.skuId];
      return edit && edit.modelName !== undefined ? {
        ...row,
        modelName: edit.modelName,
        category: edit.category ?? row.category,
        gender: edit.gender ?? row.gender,
        modelSource: edit.modelName ? "직접 입력" : "모델번호 없음",
        originalModelName: row.modelName,
      } : row;
    })
    .filter(row => Boolean(overrides[row.skuId]?.deleted) === showDeleted)
    .filter(row => !model || row.modelName === model)
    .map(row => ({
      ...row,
      rocketPending: true,
      imageUrl: "", warehouseNumber: "", boxNumber: "", currentStock: "", currentStatus: "", costVatIncluded: "",
      vendorName: "", countryOfOrigin: "", productLink: "", productCode: "", reregistrationTier: "", photoFolder: "",
      jewelrySize: "", dimension: "", salePrice: "", cumulativeInbound: "",
    }));
  return NextResponse.json({ items, generatedFrom: (data as { generatedFrom?: string[] }).generatedFrom || [] }, { headers: { "Cache-Control": "no-store" } });
}

/** { skuIds, modelName, category?, gender? } 저장 · { skuIds, reset: true } 원래 값으로 되돌리기. 제품DB(구글시트)는 건드리지 않는다. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { skuIds?: unknown; modelName?: unknown; category?: unknown; gender?: unknown; reset?: unknown; deleted?: unknown };
    const skuIds = Array.isArray(body.skuIds) ? body.skuIds.map(String).filter(sku => knownSkus.has(sku)) : [];
    const maxSkus = typeof body.deleted === "boolean" ? knownSkus.size : 500;
    if (!skuIds.length || skuIds.length > maxSkus) return NextResponse.json({ error: "SKU를 찾지 못했습니다." }, { status: 400 });
    // 삭제 = 이 목록에서만 뺀다(쿠팡·Wing 상품은 그대로). deleted:false로 되살린다.
    if (typeof body.deleted === "boolean") {
      await changeRocketPendingOverrides(skuIds, { deleted: body.deleted });
      return NextResponse.json({ ok: true });
    }
    if (body.reset === true) {
      await changeRocketPendingOverrides(skuIds, null);
      return NextResponse.json({ ok: true });
    }
    const modelName = typeof body.modelName === "string" ? body.modelName.trim().toLowerCase() : "";
    if (modelName && !MODEL_PATTERN.test(modelName)) {
      return NextResponse.json({ error: "모델명은 영문 1~4자 + 숫자 형식이어야 합니다. (예: we00130)" }, { status: 400 });
    }
    const text = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 20) : undefined;
    await changeRocketPendingOverrides(skuIds, { modelName, category: text(body.category), gender: text(body.gender) });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Wing 등록검토 정리 상태 저장 실패", error instanceof Error ? { name: error.name, message: error.message } : error);
    return NextResponse.json({ error: "Wing 등록검토 정리 상태를 저장하지 못했습니다." }, { status: 500 });
  }
}
