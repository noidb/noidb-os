import assert from "node:assert/strict";
import { applyInvoiceGroupStoreMutation } from "../lib/wms/invoice-group/server-store";
import { emptyInvoiceGroupStoreSnapshot } from "../lib/wms/invoice-group/shared-store-types";
import type { InvoiceGroup } from "../lib/wms/invoice-group/types";

const at = "2026-09-20T00:00:00.000Z";
function group(id = "G-1", purchaseOrderNumbers = ["140000001"], stage: InvoiceGroup["stage"] = "new", complete = false): InvoiceGroup {
  return {
    id, purchaseOrderNumbers, expectedDate: "2026-09-22", fulfillmentCenter: "동탄1", mergedFromMultiplePo: purchaseOrderNumbers.length > 1, stage,
    fulfillmentCenterPhone: "01000000000", fulfillmentCenterZip: "00000", fulfillmentCenterAddress: "경기도", poConfirmations: complete ? purchaseOrderNumbers.map(purchaseOrderNumber => ({ purchaseOrderNumber, confirmedFileName: "confirmed.xlsx", confirmedFilePath: "fixture", confirmedAt: at })) : [],
    skuCount: 1, totalQuantity: 1,
    invoiceGeneratedAt: complete ? at : undefined, invoiceFileName: complete ? "invoice.xlsx" : undefined, invoiceFilePath: complete ? "fixture" : undefined,
    shipmentInvoiceNumbers: complete ? purchaseOrderNumbers.map(purchaseOrderNumber => ({ purchaseOrderNumber, invoiceNumber: "463000000001" })) : [],
    shipmentRegisteredAt: complete ? at : undefined, shipmentFileName: complete ? "shipment.xlsx" : undefined, shipmentFilePath: complete ? "fixture" : undefined, shipmentNumbers: complete ? ["50129648"] : [],
    barcodeGeneratedAt: complete ? at : undefined, barcodeFileName: complete ? "barcode.xlsx" : undefined, barcodeFilePath: complete ? "fixture" : undefined, outputSetGeneratedAt: complete ? at : undefined,
    createdAt: at, updatedAt: at,
  };
}
const save = (snapshot: ReturnType<typeof emptyInvoiceGroupStoreSnapshot>, value: InvoiceGroup) => applyInvoiceGroupStoreMutation(snapshot, { action: "save", group: value });

let store = emptyInvoiceGroupStoreSnapshot();
store = save(store, group());
assert.throws(() => save(store, group("G-2", ["140000001"])), /이미 다른 발주묶음/);
assert.throws(() => save(store, { ...group(), stage: "dispatched", updatedAt: "2026-09-20T00:01:00.000Z" }), /한 단계씩/);
assert.throws(() => save(store, { ...group(), stage: "shipment_completed", updatedAt: "2026-09-20T00:01:00.000Z" }), /필요한 기록/);
const missingRegistration = { ...group("MISSING", ["140000002"], "new", true), shipmentRegisteredAt: undefined, updatedAt: "2026-09-20T00:01:00.000Z" };
store = save(store, { ...missingRegistration, stage: "new" });
assert.throws(() => save(store, { ...missingRegistration, stage: "shipment_completed" }), /Supplier Hub 쉽먼트 등록 기록/);
const missingOutput = { ...group("MISSING-OUTPUT", ["140000006"], "new", true), outputSetGeneratedAt: undefined, updatedAt: "2026-09-20T00:01:00.000Z" };
store = save(store, { ...missingOutput, stage: "new" });
assert.throws(() => save(store, { ...missingOutput, stage: "shipment_completed" }), /출력세트 생성/);

const complete = group("G-3", ["140000003", "140000004"], "new", true);
store = save(store, complete);
const shipmentCompleted = { ...complete, stage: "shipment_completed" as const, updatedAt: "2026-09-20T00:02:00.000Z" };
store = save(store, shipmentCompleted);
assert.equal(store.groups.find(value => value.id === "G-3")?.stage, "shipment_completed", "출력세트가 갖춰진 준비 저장은 최종 출고완료가 아니다.");
const dispatched = { ...shipmentCompleted, stage: "dispatched" as const, updatedAt: "2026-09-20T00:03:00.000Z" };
store = save(store, dispatched);
assert.equal(store.groups.find(value => value.id === "G-3")?.stage, "dispatched");
assert.throws(() => save(store, { ...dispatched, notes: "stale edit", updatedAt: "2026-09-20T00:04:00.000Z" }), /수정할 수 없습니다/);
assert.throws(() => save(store, { ...shipmentCompleted, stage: "new", updatedAt: at }), /이전 저장 요청/);

const evidence = group("G-4", ["140000005"], "new", true);
store = save(store, evidence);
const evidencePrepared = { ...evidence, stage: "shipment_completed" as const, updatedAt: "2026-09-20T00:02:00.000Z" };
store = save(store, evidencePrepared);
assert.throws(() => save(store, { ...evidencePrepared, shipmentNumbers: ["50129649"], updatedAt: "2026-09-20T00:03:00.000Z" }), /기존 출력세트 기록을 유지할 수 없습니다/);
const regenerated = { ...evidencePrepared, shipmentNumbers: ["50129649"], outputSetGeneratedAt: "2026-09-20T00:04:00.000Z", updatedAt: "2026-09-20T00:04:00.000Z" };
store = save(store, regenerated);
assert.equal(store.groups.find(value => value.id === "G-4")?.outputSetGeneratedAt, regenerated.outputSetGeneratedAt);

const oldFinished = group("OLD", ["140000099"], "shipment_closed", true);
const legacy = { ...emptyInvoiceGroupStoreSnapshot(), groups: [oldFinished] };
assert.throws(() => save(legacy, { ...oldFinished, notes: "change", updatedAt: "2026-09-21T00:00:00.000Z" }), /수정할 수 없습니다/);
const tombstoned = applyInvoiceGroupStoreMutation(emptyInvoiceGroupStoreSnapshot(), { action: "delete", id: "DELETED", deletedAt: at });
assert.throws(() => save(tombstoned, group("DELETED")), /삭제된 발주묶음 ID/);

console.log(JSON.stringify({ duplicatePoBlocked: true, skipStageBlocked: true, missingPrerequisiteBlocked: true, shipmentRegistrationRequired: true, outputSetRequired: true, preparationSaveIsNotDispatch: true, readyNewGroupSequentiallySaved: true, staleOutputSetBlocked: true, regeneratedOutputSetAllowed: true, validFullCycle: true, closedAndDispatchedFrozen: true, staleDowngradeBlocked: true, tombstoneResurrectionBlocked: true }, null, 2));
