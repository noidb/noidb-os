import { NextRequest, NextResponse } from "next/server";
import { getCachedPurchaseOrderIndex } from "@/lib/wms/purchase-order-source/index";
import { normalizeSkuId } from "@/lib/wms/sku-normalize";

/**
 * 발주서 SKU별 총수량 (2026-10-02 신규 — 사용자 요청). 읽기 전용.
 *
 * 쉽먼트 생성 전이라 쉽먼트별 목록(동봉내역서 기준)은 만들 수 없으므로, 송장·쉽먼트 생성이 쓰는
 * 것과 같은 발주서 원본 인덱스(buildShipmentOutputContext와 동일)에서 요청한 발주번호들의 품목을
 * SKU ID 기준으로 합산해 돌려준다. 아무것도 저장/변경하지 않는다.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface SkuSummaryRow {
  skuId: string;
  barcode: string;
  productName: string;
  optionName: string;
  totalQuantity: number;
  purchaseOrderCount: number;
  fulfillmentCenters: string[];
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const requested = [...new Set((Array.isArray(body.purchaseOrderNumbers) ? body.purchaseOrderNumbers : []).map((value: unknown) => normalizeSkuId(String(value || ""))).filter(Boolean))] as string[];
    if (!requested.length) return NextResponse.json({ error: "발주번호가 없습니다." }, { status: 400 });

    const index = await getCachedPurchaseOrderIndex();
    const missing: string[] = [];
    const bySku = new Map<string, SkuSummaryRow & { poSet: Set<string>; centerSet: Set<string> }>();
    for (const po of requested) {
      const document = index.byPurchaseOrderNumber.get(po);
      if (!document) { missing.push(po); continue; }
      for (const record of document.records) {
        const key = record.skuId.trim() || `바코드:${record.barcode}`;
        const entry = bySku.get(key) || {
          skuId: record.skuId.trim(), barcode: record.barcode, productName: record.productName, optionName: record.optionName,
          totalQuantity: 0, purchaseOrderCount: 0, fulfillmentCenters: [], poSet: new Set<string>(), centerSet: new Set<string>(),
        };
        entry.totalQuantity += Number.isFinite(record.orderedQuantity) ? record.orderedQuantity : 0;
        entry.poSet.add(record.purchaseOrderNumber);
        entry.centerSet.add(record.fulfillmentCenterName);
        bySku.set(key, entry);
      }
    }
    const rows: SkuSummaryRow[] = [...bySku.values()]
      .map(({ poSet, centerSet, ...row }) => ({ ...row, purchaseOrderCount: poSet.size, fulfillmentCenters: [...centerSet].sort((a, b) => a.localeCompare(b, "ko")) }))
      .sort((a, b) => a.productName.localeCompare(b.productName, "ko") || a.optionName.localeCompare(b.optionName, "ko") || a.skuId.localeCompare(b.skuId));
    return NextResponse.json({ ok: true, rows, missingPurchaseOrderNumbers: missing });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "발주서 원본을 읽지 못했습니다." }, { status: 500 });
  }
}
