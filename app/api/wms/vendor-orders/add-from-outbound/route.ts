import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { fetchProductCatalog, type ProductCatalogItem } from "@/lib/wms/product-catalog";
import { mutatePickingWaveStore } from "@/lib/wms/picking-wave/server-store";
import { normalizeSkuId } from "@/lib/wms/sku-normalize";
import { UNASSIGNED_VENDOR_NAME, type VendorOrderDraftLine } from "@/lib/wms/vendor-order/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/**
 * 쉽먼트별 SKU리스트에서 재고 파악 중 고른 SKU를 거래처발주로 보낸다(2026-10-15 사용자 요청).
 * 입고결과의 거래처발주와 같은 발주대기(consolidateVendorOrders)에 넣어, 제품DB 거래처별 발주서로 묶인다.
 * 같은 SKU가 이미 발주대기에 있으면 수량을 더하지 않고 그대로 둔다(두 번 눌러도 두 번 주문되지 않음).
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({ ok: false, error: "쉽먼트별 SKU리스트 화면에서 다시 진행해 주세요." }, { status: 403, headers });
  try {
    const body = await request.json() as { expectedDate?: unknown; items?: unknown };
    const expectedDate = typeof body.expectedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.expectedDate) ? body.expectedDate : "";
    if (!expectedDate) throw new Error("입고예정일을 확인해 주세요.");
    const raw = Array.isArray(body.items) ? body.items : [];
    const bySku = new Map<string, { quantity: number; purchaseOrderNumbers: Set<string> }>();
    for (const value of raw) {
      const item = value as { skuId?: unknown; quantity?: unknown; purchaseOrderNumber?: unknown };
      const skuId = normalizeSkuId(typeof item.skuId === "string" ? item.skuId : "");
      const quantity = Number(item.quantity);
      if (!skuId || !Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("발주할 SKU와 수량을 확인해 주세요.");
      const entry = bySku.get(skuId) || { quantity: 0, purchaseOrderNumbers: new Set<string>() };
      entry.quantity += quantity;
      if (typeof item.purchaseOrderNumber === "string" && item.purchaseOrderNumber.trim()) entry.purchaseOrderNumbers.add(item.purchaseOrderNumber.trim());
      bySku.set(skuId, entry);
    }
    if (!bySku.size) throw new Error("거래처발주할 SKU를 골라 주세요.");
    const catalog = await fetchProductCatalog().catch(() => ({ configured: false, items: [] as ProductCatalogItem[] }));
    const catalogBySku = new Map(catalog.items.map(item => [normalizeSkuId(item.skuId), item]));
    const now = new Date().toISOString();
    const operationId = `outbound-${expectedDate}-${randomUUID()}`;
    const lines: VendorOrderDraftLine[] = [...bySku.entries()].map(([skuId, entry]) => {
      const row = catalogBySku.get(skuId);
      const vendorName = row?.vendorName.trim() || UNASSIGNED_VENDOR_NAME;
      return {
        id: `${operationId}::${skuId}`, draftId: `${operationId}::${vendorName}`, waveId: operationId, vendorName, skuId,
        modelName: row?.modelSku || row?.modelName || "", category: row?.category || "", optionLabel: row?.optionLabel || "",
        productName: row?.productName || "", imageUrl: row?.imageUrl || "", barcode: row?.barcode || "",
        actualShortageQuantity: entry.quantity, shortageQuantity: entry.quantity, currentStock: row?.currentStock || "",
        // 쿠팡 발주번호를 넣지 않는다: 직접 고른 줄로 다뤄 같은 거래처로 그대로 묶이게 한다(번호는 메모에 남김).
        relatedPurchaseOrderNumbers: [],
        memo: `${expectedDate} 출고분 재고부족`, isManuallyAdded: true, sourceType: "picking-shortage",
        createdAt: now, updatedAt: now,
      };
    });
    const store = await mutatePickingWaveStore({ action: "consolidateVendorOrders", operationId, lines, now });
    const receipt = store.vendorQueueReceipts?.[operationId];
    const queueLines = store.vendorOrderLines.filter(line => line.waveId === receipt?.queueId && !store.deletedVendorLineIds[line.id] && !line.orderExclusion);
    const placed = [...bySku.keys()].filter(skuId => queueLines.some(line => normalizeSkuId(line.skuId) === skuId));
    const skipped = [...bySku.keys()].filter(skuId => !placed.includes(skuId));
    const vendors = [...new Set(queueLines.filter(line => placed.includes(normalizeSkuId(line.skuId))).map(line => line.vendorName))];
    return NextResponse.json({ ok: true, added: receipt?.added ?? 0, alreadyQueued: receipt?.duplicates ?? 0, placed, skipped, vendors,
      unassigned: placed.filter(skuId => !catalogBySku.get(skuId)?.vendorName.trim()) }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "거래처발주로 보내지 못했습니다." }, { status: 400, headers });
  }
}
