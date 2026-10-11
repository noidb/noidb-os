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
  /** 2026-10-11: 원발주서 공급가(매입가, 부가세 포함 단가). 발주서마다 다르면 최저~최고. 없으면 0. */
  minUnitPrice: number;
  maxUnitPrice: number;
  /** 2026-10-11: "발주 N건"을 누르면 이 SKU가 들어 있는 발주서를 보여주기 위한 발주서별 수량. */
  purchaseOrders: { purchaseOrderNumber: string; fulfillmentCenter: string; quantity: number }[];
}

/** 2026-10-11: 발주서 한 장의 전체 품목(화면에서 "발주서 보기"로 연다). */
export interface SkuSummaryPurchaseOrder {
  purchaseOrderNumber: string;
  fulfillmentCenter: string;
  lines: { skuId: string; barcode: string; productName: string; optionName: string; orderedQuantity: number; unitPrice: number }[];
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const requested = [...new Set((Array.isArray(body.purchaseOrderNumbers) ? body.purchaseOrderNumbers : []).map((value: unknown) => normalizeSkuId(String(value || ""))).filter(Boolean))] as string[];
    if (!requested.length) return NextResponse.json({ error: "발주번호가 없습니다." }, { status: 400 });

    const index = await getCachedPurchaseOrderIndex();
    const missing: string[] = [];
    const bySku = new Map<string, Omit<SkuSummaryRow, "purchaseOrders"> & { poSet: Set<string>; centerSet: Set<string>; poQuantity: Map<string, { fulfillmentCenter: string; quantity: number }> }>();
    const documents: SkuSummaryPurchaseOrder[] = [];
    for (const po of requested) {
      const document = index.byPurchaseOrderNumber.get(po);
      if (!document) { missing.push(po); continue; }
      documents.push({
        purchaseOrderNumber: document.purchaseOrderNumber,
        fulfillmentCenter: document.fulfillmentCenterName,
        lines: document.records.map(record => ({ skuId: record.skuId.trim(), barcode: record.barcode, productName: record.productName, optionName: record.optionName, orderedQuantity: Number.isFinite(record.orderedQuantity) ? record.orderedQuantity : 0, unitPrice: record.unitPrice || 0 })),
      });
      for (const record of document.records) {
        const key = record.skuId.trim() || `바코드:${record.barcode}`;
        const entry = bySku.get(key) || {
          skuId: record.skuId.trim(), barcode: record.barcode, productName: record.productName, optionName: record.optionName,
          totalQuantity: 0, purchaseOrderCount: 0, fulfillmentCenters: [], minUnitPrice: 0, maxUnitPrice: 0, poSet: new Set<string>(), centerSet: new Set<string>(), poQuantity: new Map(),
        };
        const quantity = Number.isFinite(record.orderedQuantity) ? record.orderedQuantity : 0;
        entry.totalQuantity += quantity;
        if (record.unitPrice) {
          entry.minUnitPrice = entry.minUnitPrice ? Math.min(entry.minUnitPrice, record.unitPrice) : record.unitPrice;
          entry.maxUnitPrice = Math.max(entry.maxUnitPrice, record.unitPrice);
        }
        const perPo = entry.poQuantity.get(record.purchaseOrderNumber) || { fulfillmentCenter: record.fulfillmentCenterName, quantity: 0 };
        perPo.quantity += quantity;
        entry.poQuantity.set(record.purchaseOrderNumber, perPo);
        entry.poSet.add(record.purchaseOrderNumber);
        entry.centerSet.add(record.fulfillmentCenterName);
        bySku.set(key, entry);
      }
    }
    const rows: SkuSummaryRow[] = [...bySku.values()]
      .map(({ poSet, centerSet, poQuantity, ...row }) => ({
        ...row, purchaseOrderCount: poSet.size, fulfillmentCenters: [...centerSet].sort((a, b) => a.localeCompare(b, "ko")),
        purchaseOrders: [...poQuantity.entries()].map(([purchaseOrderNumber, value]) => ({ purchaseOrderNumber, ...value })).sort((a, b) => a.purchaseOrderNumber.localeCompare(b.purchaseOrderNumber)),
      }))
      .sort((a, b) => a.productName.localeCompare(b.productName, "ko") || a.optionName.localeCompare(b.optionName, "ko") || a.skuId.localeCompare(b.skuId));
    return NextResponse.json({ ok: true, rows, documents, missingPurchaseOrderNumbers: missing });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "발주서 원본을 읽지 못했습니다." }, { status: 500 });
  }
}
