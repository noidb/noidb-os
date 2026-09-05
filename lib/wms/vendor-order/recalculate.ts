import type { PickingWaveItem } from "../picking-wave/types";
import { resolveDisplayOption } from "../display-name";
import { UNASSIGNED_VENDOR_NAME, type VendorOrderDraftLine } from "./types";
import { toVendorOrderQuantity } from "./aggregate";
import { sortWarehouseProducts } from "../category-order";

/**
 * 웨이브의 최신 부족수량을 기준으로 "자동 생성" 라인만 다시 계산한다 (2026-08-19 신규).
 * 사용자가 직접 추가한 라인(isManuallyAdded:true)은 절대 건드리지 않는다 — 자동 재계산만으로
 * 삭제·수정되지 않는다. 자동 라인은:
 *  - 부족수량이 남아있으면 수량만 최신화(거래처 등 사용자가 고친 값은 유지)
 *  - 새로 부족이 발생한 SKU는 새 라인으로 추가
 *  - 부족수량이 0이 된 SKU는 목록에서 제거 대상으로 표시(호출한 쪽이 repository에서 지운다)
 */
export interface RecalculateResult {
  /** 저장해야 할 전체 라인(수동 라인 + 최신화된 자동 라인) */
  lines: VendorOrderDraftLine[];
  /** repository에서 삭제해야 할 자동 라인 id (부족수량이 0이 됨) */
  removedLineIds: string[];
  addedProductCodes: string[];
  updatedProductCodes: string[];
}

export function recalculateAutoVendorOrderLines(
  waveId: string,
  waveItems: PickingWaveItem[],
  existingLines: VendorOrderDraftLine[],
  now: string
): RecalculateResult {
  const shortageItems = sortWarehouseProducts(waveItems.filter(item => item.shortageQuantity > 0));
  const manualLines = existingLines.filter(line => line.isManuallyAdded);
  const manualSkuIds = new Set(manualLines.map(line => line.skuId));
  const autoLinesByCode = new Map(existingLines.filter(line => !line.isManuallyAdded).map(line => [line.skuId, line]));

  const nextAutoLines: VendorOrderDraftLine[] = [];
  const addedProductCodes: string[] = [];
  const updatedProductCodes: string[] = [];

  for (const item of shortageItems) {
    // A SKU explicitly transferred from picking already has a persisted line. Do not create
    // another auto line beside it (or overwrite its memo/vendor/edited quantity by the same ID).
    if (manualSkuIds.has(item.productCode)) continue;
    const orderQuantity = toVendorOrderQuantity(item.shortageQuantity);
    const existing = autoLinesByCode.get(item.productCode);
    if (existing) {
      const previousAutoQuantity = toVendorOrderQuantity(existing.actualShortageQuantity ?? item.shortageQuantity);
      const userEditedQuantity = existing.shortageQuantity !== previousAutoQuantity;
      const nextQuantity = userEditedQuantity ? existing.shortageQuantity : orderQuantity;
      const changed = existing.shortageQuantity !== nextQuantity || existing.actualShortageQuantity !== item.shortageQuantity;
      if (changed) updatedProductCodes.push(item.productCode);
      nextAutoLines.push(changed ? { ...existing, actualShortageQuantity: item.shortageQuantity, shortageQuantity: nextQuantity, updatedAt: now } : existing);
      autoLinesByCode.delete(item.productCode);
    } else {
      const vendorName = item.vendorName || UNASSIGNED_VENDOR_NAME;
      const draftId = `${waveId}::${vendorName}`;
      addedProductCodes.push(item.productCode);
      nextAutoLines.push({
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
        shortageQuantity: orderQuantity,
        currentStock: item.catalogCurrentStock || "",
        relatedPurchaseOrderNumbers: Array.from(new Set(item.sources.map(source => source.purchaseOrderNumber))),
        memo: "",
        isManuallyAdded: false,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // 남은 것들(shortageItems에 더 이상 없음) = 부족수량이 0이 된 자동 라인 → 삭제 대상
  // Preserve ambiguous legacy duplicates for review rather than deleting operating data.
  const legacyManualConflicts = Array.from(autoLinesByCode.values()).filter(line => manualSkuIds.has(line.skuId));
  const removedLineIds = Array.from(autoLinesByCode.values()).filter(line => !manualSkuIds.has(line.skuId)).map(line => line.id);

  return { lines: sortWarehouseProducts([...manualLines, ...nextAutoLines, ...legacyManualConflicts]), removedLineIds, addedProductCodes, updatedProductCodes };
}
