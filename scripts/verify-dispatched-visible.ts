import assert from "node:assert/strict";
import { applyInvoiceGroupStoreMutation } from "../lib/wms/invoice-group/server-store";
import { emptyInvoiceGroupStoreSnapshot } from "../lib/wms/invoice-group/shared-store-types";
import { isVisibleDispatchedInvoiceGroup, type InvoiceGroup } from "../lib/wms/invoice-group/types";

/** 2026-10-15: 출고완료 후에도 화면에 남고, "삭제"(hiddenAt)만 바꿀 수 있으며 다른 수정은 계속 막힌다. */
const at = "2026-10-15T07:00:00.000Z";
const done: InvoiceGroup = {
  id: "D-1", purchaseOrderNumbers: ["150000001"], expectedDate: "2026-10-16", fulfillmentCenter: "동탄1", mergedFromMultiplePo: false, stage: "dispatched",
  fulfillmentCenterPhone: "", fulfillmentCenterZip: "", fulfillmentCenterAddress: "", poConfirmations: [], skuCount: 1, totalQuantity: 1,
  shipmentInvoiceNumbers: [], shipmentNumbers: ["50129648"], dispatchedAt: at, createdAt: at, updatedAt: at,
};
let store = { ...emptyInvoiceGroupStoreSnapshot(), groups: [done] };
assert.equal(isVisibleDispatchedInvoiceGroup(done), true, "출고완료 직후에는 화면에 보인다");
assert.equal(isVisibleDispatchedInvoiceGroup({ ...done, dispatchedAt: undefined }), false, "예전 출고완료 기록은 다시 나오지 않는다");
assert.throws(() => applyInvoiceGroupStoreMutation(store, { action: "save", group: { ...done, notes: "x", hiddenAt: at, updatedAt: "2026-10-15T08:00:00.000Z" } }), /수정할 수 없습니다/);
store = applyInvoiceGroupStoreMutation(store, { action: "save", group: { ...done, hiddenAt: "2026-10-15T08:00:00.000Z", updatedAt: "2026-10-15T08:00:00.000Z" } });
const hidden = store.groups.find(group => group.id === "D-1")!;
assert.equal(isVisibleDispatchedInvoiceGroup(hidden), false, "삭제하면 화면에서 빠진다");
assert.equal(hidden.stage, "dispatched", "기록은 출고완료 그대로 남는다");
console.log("verify-dispatched-visible ok");
