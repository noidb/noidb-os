import assert from "node:assert/strict";
import { applyPickingWaveStoreMutation } from "../lib/wms/picking-wave/server-store";
import { emptyPickingWaveStoreSnapshot } from "../lib/wms/picking-wave/shared-store-types";
import type { VendorOrderDraftLine } from "../lib/wms/vendor-order/types";

/** 쉽먼트별 SKU리스트 → 거래처발주(2026-10-15): 거래처별로 묶이고, 다시 눌러도 수량이 늘지 않는다. */
const now = "2026-10-15T09:00:00.000Z";
const line = (op: string, skuId: string, vendorName: string, quantity: number): VendorOrderDraftLine => ({
  id: `${op}::${skuId}`, draftId: `${op}::${vendorName}`, waveId: op, vendorName, skuId, modelName: "", category: "", optionLabel: "", productName: `상품 ${skuId}`,
  imageUrl: "", barcode: "", actualShortageQuantity: quantity, shortageQuantity: quantity, currentStock: "", relatedPurchaseOrderNumbers: [],
  memo: "2026-10-16 출고분 재고부족", isManuallyAdded: true, sourceType: "picking-shortage", createdAt: now, updatedAt: now,
});
let store = emptyPickingWaveStoreSnapshot();
store = applyPickingWaveStoreMutation(store, { action: "consolidateVendorOrders", operationId: "op1", lines: [line("op1", "111", "창성", 3), line("op1", "222", "모건쥬얼리", 2), line("op1", "333", "창성", 1)], now });
const queueId = store.activeVendorQueueId!;
const active = () => store.vendorOrderLines.filter(item => item.waveId === queueId);
assert.equal(active().length, 3);
const drafts = new Set(active().map(item => item.draftId));
assert.equal(drafts.size, 2, "거래처 2곳 → 발주서 2장");
store = applyPickingWaveStoreMutation(store, { action: "consolidateVendorOrders", operationId: "op2", lines: [line("op2", "111", "창성", 3)], now: "2026-10-15T09:05:00.000Z" });
assert.equal(active().length, 3, "같은 SKU를 다시 보내도 줄이 늘지 않는다");
assert.equal(active().find(item => item.skuId === "111")!.shortageQuantity, 3, "수량도 그대로");
console.log("verify-outbound-vendor-order ok");
