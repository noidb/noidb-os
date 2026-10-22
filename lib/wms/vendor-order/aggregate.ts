import type { PickingWaveItem } from "../picking-wave/types";
import { resolveDisplayOption } from "../display-name";
import { UNASSIGNED_VENDOR_NAME, type VendorOrderDraft, type VendorOrderDraftLine } from "./types";
import { sortWarehouseProducts } from "../category-order";

/** 거래처 자동 발주의 SKU별 최소 주문 단위(한 타스). */
export const MIN_AUTO_VENDOR_ORDER_QUANTITY = 12;

/** 부족수량 10개 이하일 때 거래처별 기본 발주 수량(2026-10-22 사용자 확정).
 *  부족수량이 이 값보다 많으면(10개 이하 안에서) 부족수량 그대로, 10개를 넘으면 12개 단위 올림. */
const SMALL_ORDER_LIMIT = 10;
const VENDOR_SMALL_ORDER_DEFAULT: Record<string, number> = { "모건쥬얼리": 10, "창성": 5 };

export function vendorSmallOrderDefault(vendorName = ""): number | undefined {
  return VENDOR_SMALL_ORDER_DEFAULT[vendorName.replace(/\s/g, "")];
}

export function toVendorOrderQuantity(shortageQuantity: number, _productContext = "", vendorName = ""): number {
  const safeShortage = Math.max(0, Math.ceil(shortageQuantity));
  if (safeShortage === 0) return 0;
  const smallDefault = vendorSmallOrderDefault(vendorName);
  if (smallDefault !== undefined && safeShortage <= SMALL_ORDER_LIMIT) return Math.max(smallDefault, safeShortage);
  // 그 외 거래처: 10개 미만 12개, 10개 이상 24개, 그 위로는 12개 단위 올림(2026-10-22 사용자 확정).
  if (safeShortage < 10) return MIN_AUTO_VENDOR_ORDER_QUANTITY;
  return Math.max(MIN_AUTO_VENDOR_ORDER_QUANTITY * 2, Math.ceil(safeShortage / MIN_AUTO_VENDOR_ORDER_QUANTITY) * MIN_AUTO_VENDOR_ORDER_QUANTITY);
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
  const shortageItems = sortWarehouseProducts(items.filter(item => item.shortageQuantity > 0));

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
      actualShortageQuantity: item.shortageQuantity,
      shortageQuantity: toVendorOrderQuantity(item.shortageQuantity, "", vendorName),
      currentStock: item.catalogCurrentStock || "",
      relatedPurchaseOrderNumbers: Array.from(new Set(item.sources.map(source => source.purchaseOrderNumber))),
      memo: "",
      isManuallyAdded: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  return { drafts: Array.from(draftByVendor.values()), lines: sortWarehouseProducts(lines) };
}
