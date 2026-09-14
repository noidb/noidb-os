import assert from "node:assert/strict";
import {
  mergeStoredSupplierHubPurchaseOrders,
  projectActiveSupplierHubPurchaseOrders,
  summarizeSupplierHubInboundByMonth,
} from "../lib/wms/supplier-hub-active-orders";
import type { SupplierHubInboundEvent } from "../lib/wms/picking-wave/shared-store-types";
import type { SupplierHubPurchaseOrder } from "../lib/wms/supplier-hub-orders";
import { emptyWeeklyWorkspace } from "../lib/wms/weekly-work-state";
import { emptyPickingWaveStoreSnapshot } from "../lib/wms/picking-wave/shared-store-types";
import { applyPickingWaveStoreMutation } from "../lib/wms/picking-wave/server-store";

const order = (purchaseOrderNumber: string, capturedAt: string, items: Array<[string, number, number]>): SupplierHubPurchaseOrder => ({
  purchaseOrderNumber, orderType: "리오더", fulfillmentCenter: "센터", fulfillmentAddress: "주소", fulfillmentContactPhone: "전화",
  expectedDate: "2026-09-15", accountName: "NOID-B", sourceFileName: `${purchaseOrderNumber}-${capturedAt}.xlsx`, capturedAt,
  items: items.map(([productCode, vendorConfirmedQuantity, receivedQuantity], index) => ({
    lineNo: index + 1, productCode, productName: productCode, barcode: "", purchaseType: "직매입", taxType: "과세",
    orderedQuantity: vendorConfirmedQuantity, vendorConfirmedQuantity, receivedQuantity,
  })),
});
const event = (orderNo: string, skuId: string, inboundDate: string, quantity: number, id: string): SupplierHubInboundEvent => ({
  id, eventKey: id, source: "supplier-hub-extension", collectedAt: "2026-09-15T00:00:00.000Z", orderNo, skuId, inboundDate,
  quantity: String(quantity), division: "입고", warehouse: "센터", skuName: skuId,
});

const old = order("100", "2026-09-14T00:00:00.000Z", [["A", 1, 0]]);
assert.deepEqual(mergeStoredSupplierHubPurchaseOrders([old], []).orders, [old], "원본 파일이 없어도 저장 발주를 유지해야 한다");
const added = order("200", "2026-09-15T00:00:00.000Z", [["B", 2, 0]]);
assert.deepEqual(mergeStoredSupplierHubPurchaseOrders([old], [added]).orders.map(row => row.purchaseOrderNumber), ["100", "200"]);
const updated = order("100", "2026-09-16T00:00:00.000Z", [["A", 3, 0]]);
assert.equal(mergeStoredSupplierHubPurchaseOrders([old], [updated]).orders.find(row => row.purchaseOrderNumber === "100")?.items[0].vendorConfirmedQuantity, 3);
const conflict = order("100", old.capturedAt, [["A", 9, 0]]);
const conflictResult = mergeStoredSupplierHubPurchaseOrders([old], [conflict]);
assert.equal(conflictResult.conflicts.length, 1);
assert.equal(conflictResult.orders[0].items[0].vendorConfirmedQuantity, 1, "동일 시각 충돌은 저장 원본을 보존해야 한다");
const storedSnapshot = applyPickingWaveStoreMutation(emptyPickingWaveStoreSnapshot(), { action: "upsertSupplierHubPurchaseOrders", orders: [old, added] });
const refreshedSnapshot = applyPickingWaveStoreMutation(storedSnapshot, { action: "upsertSupplierHubPurchaseOrders", orders: [updated] });
assert.deepEqual(refreshedSnapshot.supplierHubPurchaseOrders?.map(row => row.purchaseOrderNumber), ["100", "200"]);
assert.equal(refreshedSnapshot.supplierHubPurchaseOrders?.find(row => row.purchaseOrderNumber === "100")?.items[0].vendorConfirmedQuantity, 3);

const orders = [
  order("301", "2026-09-15T00:00:00.000Z", [["SKU-A", 10, 0], ["SKU-B", 5, 0]]),
  order("302", "2026-09-15T00:00:00.000Z", [["SKU-C", 10, 0]]),
  order("303", "2026-09-15T00:00:00.000Z", [["SKU-D", 4, 0]]),
  order("304", "2026-09-15T00:00:00.000Z", [["SKU-E", 3, 0]]),
];
const events = [
  event("301", "SKU-A", "2026-09-10 10:00:00", 10, "e1"),
  event("301", "SKU-B", "2026-09-11 10:00:00", 2, "e2"),
  event("301", "SKU-B", "2026-09-11 10:00:00", 2, "duplicate-id"),
  event("302", "SKU-C", "2026-09-12 10:00:00", 5, "e3"),
  event("999", "SKU-A", "2026-09-13 10:00:00", 5, "e4"),
];
const workspace = emptyWeeklyWorkspace();
workspace.runs.push({
  id: "run", snapshot: { id: "snapshot", sourceToken: "source", createdAt: "2026-09-15T00:00:00.000Z", period: { startDate: "2026-09-01", endDate: "2026-09-15" }, source: { files: [], latestActualDate: "", firstActualDate: "", eventCount: 0, duplicateCount: 0, selectedEventCount: 0, mode: "drive" }, couponItems: [], vendorItems: [], warnings: [], blockers: [] },
  reviews: {}, revision: 1, updatedAt: "2026-09-15T00:00:00.000Z", sentVendors: {}, reorderQueuePartialRequestedAt: "2026-09-15T00:00:00.000Z",
  reorderRequestedLines: [{ purchaseOrderNumber: "301", skuId: "SKU-B", shortageQuantity: 3 }],
});
workspace.statusListSnapshot = { requests: [
  { id: "done", skuId: "SKU-D", modelSku: "", productName: "", optionLabel: "", currentStatus: "", requestType: "단종", requestedAt: "", supplyHubStatus: "처리완료", completedAt: "2026-09-15T00:00:00.000Z", requester: "", processor: "", previousStatus: "", productLink: "", purchaseOrderNumber: "303", sheetRow: 1 },
  { id: "pending", skuId: "SKU-E", modelSku: "", productName: "", optionLabel: "", currentStatus: "", requestType: "단종", requestedAt: "", supplyHubStatus: "처리대기", completedAt: "", requester: "", processor: "", previousStatus: "", productLink: "", purchaseOrderNumber: "304", sheetRow: 2 },
], generations: [], at: "2026-09-15T00:00:00.000Z" };

const projected = projectActiveSupplierHubPurchaseOrders({ orders, events, workspace });
assert.deepEqual(projected.completedPurchaseOrderNumbers.sort(), ["301", "303"]);
assert.deepEqual(projected.activeOrders.map(row => row.purchaseOrderNumber).sort(), ["302", "304"], "부분입고와 단종 대기는 활성 상태여야 한다");
const monthly = summarizeSupplierHubInboundByMonth(events);
assert.equal(monthly.find(row => row.skuId === "SKU-A")?.actualReceivedQuantity, 15, "같은 SKU의 여러 발주 입고를 월별 합산해야 한다");
assert.equal(monthly.find(row => row.skuId === "SKU-B")?.actualReceivedQuantity, 2, "5필드 중복 이벤트를 한 번만 계산해야 한다");
assert.equal(monthly.find(row => row.skuId === "SKU-A")?.details.length, 2, "월별 합계에서 발주별 원본 이력을 추적할 수 있어야 한다");

console.log("supplier hub active-order persistence and monthly inbound verification passed");
