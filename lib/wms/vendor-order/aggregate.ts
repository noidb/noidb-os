import type { PickingWaveItem } from "../picking-wave/types";
import { resolveDisplayOption } from "../display-name";
import { UNASSIGNED_VENDOR_NAME, type VendorOrderDraft, type VendorOrderDraftLine } from "./types";

/** 거래처 자동 발주의 SKU별 최소 주문 단위(한 타스). */
export const MIN_AUTO_VENDOR_ORDER_QUANTITY = 12;

export function toVendorOrderQuantity(shortageQuantity: number): number {
  return Math.max(MIN_AUTO_VENDOR_ORDER_QUANTITY, shortageQuantity);
}

/**
 * 완료된 통합 피킹(웨이브)의 부족 수량(shortageQuantity > 0)만 골라 제품DB "거래처" 기준으로
 * 자동 그룹핑한다 — 순수 함수, 저장하지 않는다(호출한 쪽이 VendorOrderRepository에 저장).
 * 같은 거래처·같은 SKU는 웨이브 아이템 단계에서 이미 합산되어 있으므로 여기서는 다시 합산하지 않는다.
 */
export function buildVendorOrderDraftsFromWaveItems(
  waveId: string,
  items: PickingWaveItem[],
  now: string
): { drafts: VendorOrderDraft[]; lines: VendorOrderDraftLine[] } {
  const shortageItems = items.filter(item => item.shortageQuantity > 0);

  const draftByVendor = new Map<string, VendorOrderDraft>();
  const lines: VendorOrderDraftLine[] = [];

  for (const item of shortageItems) {
    const vendorName = item.vendorName || UNASSIGNED_VENDOR_NAME;
    const draftId = `${waveId}::${vendorName}`;

    if (!draftByVendor.has(draftId)) {
      draftByVendor.set(draftId, {
        id: draftId,
        waveId,
        vendorName,
        status: "draft",
        createdAt: now,
        updatedAt: now,
      });
    }

    lines.push({
      id: `${draftId}::${item.productCode}`,
      draftId,
      waveId,
      vendorName,
      skuId: item.productCode,
      modelName: item.modelName || item.productName,
      category: item.category || "",
      optionLabel: resolveDisplayOption(item.productName, item.optionLabel),
      productName: item.productName,
      imageUrl: item.imageUrl || "",
      barcode: item.catalogBarcode || "",
      shortageQuantity: toVendorOrderQuantity(item.shortageQuantity),
      currentStock: item.catalogCurrentStock || "",
      relatedPurchaseOrderNumbers: Array.from(new Set(item.sources.map(source => source.purchaseOrderNumber))),
      memo: "",
      isManuallyAdded: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  return { drafts: Array.from(draftByVendor.values()), lines };
}
