import assert from "node:assert/strict";
import { buildShipmentCandidates, previewShipmentSplit } from "../lib/wms/shipment/split";
import { createShipmentsInState, deleteShipmentFromState, renameShipmentInState } from "../lib/wms/shipment/state";
import type { ShipmentPurchaseOrder } from "../lib/wms/shipment/types";
import type { BasketAssignment, PickingWave, PickingWaveItem } from "../lib/wms/picking-wave/types";

function orders(count: number): ShipmentPurchaseOrder[] {
  return Array.from({ length: count }, (_, index) => ({
    purchaseOrderNumber: String(100000000 + index),
    sourceWaveId: "WAVE-COMPLETED",
    basketNumber: String(index + 1),
    fulfillmentCenter: "인천36",
    expectedDate: "2026-09-10",
    skuCount: 2,
    totalQuantity: 3,
    pickingCompletedAt: "2026-09-02T00:00:00.000Z",
  }));
}

function counts(total: number): number[] {
  return previewShipmentSplit(orders(total), 200).map(preview => preview.purchaseOrderCount);
}

assert.deepEqual(counts(50), [50]);
assert.deepEqual(counts(200), [200]);
assert.deepEqual(counts(201), [200, 1]);
assert.deepEqual(counts(450), [200, 200, 50]);

const previews = previewShipmentSplit(orders(201), 200);
const first = createShipmentsInState([], previews, "2026-09-02T01:00:00.000Z");
assert.equal(first.created.length, 2);
assert.equal(first.created[0].id, "SHP-20260902-001");
assert.equal(first.created[1].id, "SHP-20260902-002");
assert.equal(new Set(first.created.flatMap(shipment => shipment.purchaseOrders.map(order => order.purchaseOrderNumber))).size, 201);
assert.throws(() => createShipmentsInState(first.all, [previews[0]], "2026-09-02T02:00:00.000Z"), /이미/);

const renamed = renameShipmentInState(first.all, first.created[0].id, "수정 가능한 이름", "2026-09-02T02:00:00.000Z");
assert.equal(renamed.updated.id, first.created[0].id, "이름 변경 시 Shipment ID는 바뀌면 안 됩니다.");
assert.equal(renamed.updated.name, "수정 가능한 이름");

const afterDelete = deleteShipmentFromState(first.all, first.created[0].id);
assert.equal(afterDelete.length, 1);
const restoredOrders = first.created[0].purchaseOrders;
assert.doesNotThrow(() => createShipmentsInState(afterDelete, previewShipmentSplit(restoredOrders, 200), "2026-09-02T03:00:00.000Z"));

const progressed = first.all.map(shipment => shipment.id === first.created[0].id ? { ...shipment, status: "tracking_verified" as const } : shipment);
assert.throws(() => deleteShipmentFromState(progressed, first.created[0].id), /삭제할 수 없습니다/);

const completedWave: PickingWave = { id: "WAVE-C", status: "completed", sourcePurchaseOrderNumbers: ["123456789"], completedGroupIds: [], productDbConfigured: true, createdAt: "2026-09-01", updatedAt: "2026-09-02", completedAt: "2026-09-02", shippingGroups: [{ key: "인천36-20260910", expectedDate: "2026-09-10", fulfillmentCenter: "인천36", purchaseOrderNumbers: ["123456789"] }] };
const inProgressWave: PickingWave = { ...completedWave, id: "WAVE-P", status: "in_progress", sourcePurchaseOrderNumbers: ["987654321"], completedAt: undefined };
const item = { id: "WAVE-C-SKU", waveId: "WAVE-C", productCode: "SKU", productName: "상품", barcode: "BAR", totalQuantity: 3, sources: [{ purchaseOrderNumber: "123456789", basketNumber: "1", requestedQuantity: 3 }], locationStatus: "unlocated", modelSortKey: "", locationSortKey: "", status: "full", pickedQuantity: 3, shortageQuantity: 0, allocations: [{ purchaseOrderNumber: "123456789", basketNumber: "1", requestedQuantity: 3, fulfilledQuantity: 3, shortageQuantity: 0 }], createdAt: "2026-09-01", updatedAt: "2026-09-02" } satisfies PickingWaveItem;
const basket = { basketNumber: "1", purchaseOrderNumber: "123456789", fulfillmentCenter: "인천36", waveId: "WAVE-C", status: "completed", createdAt: "2026-09-01", updatedAt: "2026-09-02" } satisfies BasketAssignment;
const pickingSnapshot = JSON.stringify({ completedWave, inProgressWave, item, basket });
const candidates = buildShipmentCandidates([completedWave, inProgressWave], new Map([["WAVE-C", [item]], ["WAVE-P", []]]), new Map([["WAVE-C", [basket]], ["WAVE-P", []]]), []);
assert.deepEqual(candidates.map(candidate => candidate.purchaseOrderNumber), ["123456789"], "진행 중 웨이브는 Shipment 대상이 아니어야 합니다.");
assert.equal(candidates[0].totalQuantity, 3);
assert.equal(JSON.stringify({ completedWave, inProgressWave, item, basket }), pickingSnapshot, "Shipment 후보 계산이 피킹 데이터를 변경하면 안 됩니다.");

console.log("Shipment 분할 검증 통과: 50, 200, 201, 450, 완료 웨이브만 대상, 피킹 불변, 중복 차단, ID 유지, 삭제 복귀");
