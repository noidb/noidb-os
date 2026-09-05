import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { preparePickingVendorTransfer, suggestVendorTransferQuantity } from "../lib/wms/picking-wave/vendor-transfer";
import { parsePickingListViewState } from "../lib/wms/picking-wave/list-view-state";
import { resolveLiveFields } from "../lib/wms/picking-wave/live-catalog";
import { recalculateAutoVendorOrderLines } from "../lib/wms/vendor-order/recalculate";
import type { PickingWaveItem } from "../lib/wms/picking-wave/types";
import type { ProductCatalogItem } from "../lib/wms/product-catalog";
import type { VendorOrderDraftLine } from "../lib/wms/vendor-order/types";

const now = "2026-09-05T01:00:00.000Z";
const item: PickingWaveItem = {
  id: "WAVE-1-100", waveId: "WAVE-1", productCode: "100", productName: "여성 반지, 실버, 20호", barcode: "R123456789012",
  modelName: "MODEL1", optionLabel: "실버, 20호", imageUrl: "https://example.com/old.jpg", totalQuantity: 5,
  sources: [{ purchaseOrderNumber: "PO1", basketNumber: "1", requestedQuantity: 2 }, { purchaseOrderNumber: "PO2", basketNumber: "2", requestedQuantity: 3 }],
  locationStatus: "unlocated", modelSortKey: "MODEL1", locationSortKey: "", status: "pending", pickedQuantity: 0, shortageQuantity: 0, allocations: [], createdAt: now, updatedAt: now,
};
const before = structuredClone(item);
assert.equal(suggestVendorTransferQuantity(item), 5);
assert.deepEqual(item, before, "Opening a shortage preview must not change picking data.");
const excluded = { ...item, id: "WAVE-1-200", productCode: "200" };
const prepared = preparePickingVendorTransfer([item, excluded], [{ productCode: "100", shortageQuantity: "3" }], now);
assert.equal(prepared.changedItems.length, 1);
assert.equal(prepared.changedItems[0].pickedQuantity, 2);
assert.equal(prepared.changedItems[0].shortageQuantity, 3);
assert.equal(prepared.changedItems[0].status, "partial");
assert.equal(prepared.changedItems[0].allocations.reduce((sum, row) => sum + row.shortageQuantity, 0), 3);
assert.deepEqual(prepared.changedItems[0].sources, item.sources);
assert.equal(prepared.changedItems[0].barcode, item.barcode);
assert.deepEqual(item, before, "The preview helper must be immutable.");
assert.deepEqual(preparePickingVendorTransfer([item], [{ productCode: "100", shortageQuantity: "0" }], now), { transferItems: [], changedItems: [] }, "Zero must not silently become found.");
for (const quantity of ["", "-1", "1.5", "6", "NaN"]) assert.throws(() => preparePickingVendorTransfer([item], [{ productCode: "100", shortageQuantity: quantity }], now));
assert.throws(() => preparePickingVendorTransfer([item], [{ productCode: "missing", shortageQuantity: "1" }], now));
assert.throws(() => preparePickingVendorTransfer([item], [{ productCode: "100", shortageQuantity: "1" }, { productCode: "100", shortageQuantity: "1" }], now));
assert.throws(() => preparePickingVendorTransfer([{ ...item, totalQuantity: 10 }], [{ productCode: "100", shortageQuantity: "1" }], now));
const repeated = preparePickingVendorTransfer(prepared.transferItems, [{ productCode: "100", shortageQuantity: "3" }], now);
assert.equal(repeated.changedItems.length, 0, "Retrying the same shortage must not reapply picking quantities.");

const restored = parsePickingListViewState(JSON.stringify({ scrollY: 1150, anchorProductCode: "100", anchorOffset: 143, checkedProductCodes: ["100", "100", "200", "gone"] }), ["100", "200"]);
assert.deepEqual(restored, { scrollY: 1150, anchorProductCode: "100", anchorOffset: 143, checkedProductCodes: ["100", "200"] });
assert.equal(parsePickingListViewState("broken", ["100"]), null);
assert.equal(parsePickingListViewState("null", ["100"]), null);
assert.deepEqual(parsePickingListViewState(JSON.stringify({ scrollY: -1, checkedProductCodes: [7, "100"] }), ["100"])?.checkedProductCodes, ["100"]);

const blankImageCatalog = { skuId: "100", imageUrl: "", productName: item.productName, optionLabel: item.optionLabel } as ProductCatalogItem;
const resolved = resolveLiveFields(item, new Map([["100", blankImageCatalog]]));
assert.equal(resolved.imageUrl, "", "An explicitly unlinked productDB image must never fall back to the old wave image.");
assert.equal(resolved.optionLabel, "실버, 20호", "The entire option and ring size must remain visible.");
assert.equal(resolveLiveFields(item, new Map()).imageUrl, item.imageUrl, "A missing catalog row still preserves the existing wave image.");

const manualLine: VendorOrderDraftLine = {
  id: "WAVE-1::거래처A::100", draftId: "WAVE-1::거래처A", waveId: "WAVE-1", vendorName: "거래처A", skuId: "100", modelName: "MODEL1", category: "반지", optionLabel: "실버, 20호", productName: item.productName,
  imageUrl: "", barcode: item.barcode, actualShortageQuantity: 3, shortageQuantity: 17, currentStock: "", relatedPurchaseOrderNumbers: ["PO1", "PO2"], memo: "목걸이만 보내주세요", isManuallyAdded: true, createdAt: now, updatedAt: now,
};
const recalculated = recalculateAutoVendorOrderLines(item.waveId, prepared.transferItems, [manualLine], now);
assert.deepEqual(recalculated.lines, [manualLine], "Transferred SKU must not create another auto line or overwrite edited memo/quantity.");
assert.deepEqual(recalculated.addedProductCodes, []);
assert.deepEqual(recalculated.removedLineIds, []);
const autoLine = { ...manualLine, isManuallyAdded: false };
assert.equal(recalculateAutoVendorOrderLines(item.waveId, [{ ...prepared.transferItems[0], shortageQuantity: 4 }], [autoLine], now).lines[0].shortageQuantity, 17, "An explicitly edited auto-draft order quantity must survive recalculation.");
const normalAuto = { ...autoLine, shortageQuantity: 12 };
assert.equal(recalculateAutoVendorOrderLines(item.waveId, [{ ...prepared.transferItems[0], shortageQuantity: 25 }], [normalAuto], now).lines[0].shortageQuantity, 36);
const legacyDuplicate = { ...autoLine, id: "old-auto-100" };
assert.deepEqual(recalculateAutoVendorOrderLines(item.waveId, prepared.transferItems, [manualLine, legacyDuplicate], now).removedLineIds, [], "Legacy ambiguous rows must not be silently deleted.");

const vendorPage = readFileSync("app/wms/picking/waves/[waveId]/vendor-orders/page.tsx", "utf8");
const loadEffect = vendorPage.slice(vendorPage.indexOf("  useEffect(() => {"), vendorPage.indexOf("  const groups = useMemo"));
assert.doesNotMatch(loadEffect, /vendorOrderRepository\.(?:saveLine|saveDraft|deleteLine|deleteDraft)\(/, "Opening the vendor page must not mutate or delete drafts.");
assert.doesNotMatch(loadEffect, /setIsPreview\(true\)/, "Ongoing picking must not block vendor ordering.");
console.log("피킹·거래처 회귀검증 통과: 부족수량 사전확인/선택 SKU만 변경/재시도 멱등성/체크·위치 복원/이미지 해제/20호 옵션/초안 중복·수동값 보존/화면진입 쓰기 없음");
