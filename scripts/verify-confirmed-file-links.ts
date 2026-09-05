import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inspectConfirmedFileLinks, repairConfirmedFileLinks } from "../lib/wms/po-confirm-file-link";
import { emptyPickingWaveStoreSnapshot } from "../lib/wms/picking-wave/shared-store-types";
import { applyPickingWaveStoreMutation } from "../lib/wms/picking-wave/server-store";
import { mergePoConfirmationRecords, type PoConfirmationRecord } from "../lib/wms/po-confirm-state";
import type { PurchaseOrderIndex, PurchaseOrderSourceDocument } from "../lib/wms/purchase-order-source/types";
import type { ConfirmedQuantitySourceFile } from "../lib/wms/hanjin-shipment-auto";

const snapshot = emptyPickingWaveStoreSnapshot();
snapshot.waves = [{ id: "WAVE", sourcePurchaseOrderNumbers: ["100", "200"] }] as typeof snapshot.waves;
snapshot.poConfirmationRecords = ["100", "200"].map(poNumber => ({ poNumber, waveId: "WAVE", stage: "confirmed", sourceFileName: "input.xlsx", sourceFileHash: "original-hash", sourcePurchaseOrderCount: 2, sourceRowCount: 2, selectedRowCount: 1, generatedFileName: "missing.xlsx", updatedAt: "2026-09-04T00:00:00Z" }));
const documents = ["100", "200"].map(po => ({ purchaseOrderNumber: po, fulfillmentCenterName: "동탄1", expectedArrivalDate: "2026-09-04", records: [{ purchaseOrderNumber: po, skuId: `SKU${po}`, barcode: `R${po}`, productName: "원본", optionName: "실버, 20호", orderedQuantity: 12, fulfillmentCenterName: "동탄1", expectedArrivalDate: "2026-09-04" }] })) as PurchaseOrderSourceDocument[];
const index = { byPurchaseOrderNumber: new Map(documents.map(document => [document.purchaseOrderNumber, document])), conflicts: [] } as unknown as PurchaseOrderIndex;
const file: ConfirmedQuantitySourceFile = { name: "actual.xlsx", contentHash: "a".repeat(64), rows: documents.flatMap(document => document.records.map(row => ({ purchaseOrderNumber: row.purchaseOrderNumber, skuId: row.skuId, barcode: row.barcode, productName: "ignored", orderedQuantity: "12", confirmedQuantity: row.purchaseOrderNumber === "100" ? "0" : "4", shippedQuantity: "", trackingNumber: "", transportType: "", fulfillmentCenter: row.fulfillmentCenterName, expectedDate: row.expectedArrivalDate }))) };
const before = structuredClone(snapshot);
const groups = inspectConfirmedFileLinks(snapshot, "WAVE", index, [file]);
assert.equal(groups.length, 1);
assert.equal(groups[0].candidates.length, 1);
assert.equal(groups[0].candidates[0].totalConfirmedQuantity, 4);
assert.equal(groups[0].candidates[0].quantityChanges.length, 2);
assert.deepEqual(snapshot, before, "Preview must not mutate data");
assert.equal(inspectConfirmedFileLinks(snapshot, "WAVE", index, [{...file, rows:file.rows!.slice(0,1)}])[0].candidates.length, 0, "Partial batch blocked");
assert.equal(inspectConfirmedFileLinks(snapshot, "WAVE", index, [file,{...file}])[0].candidates.length, 0, "Duplicate file names blocked");
assert.equal(inspectConfirmedFileLinks(snapshot, "WAVE", index, [{...file,name:"missing.xlsx"}]).length, 0, "Do not replace a present recorded file");
assert.notEqual(inspectConfirmedFileLinks(snapshot, "WAVE", index, [{...file, contentHash:"b".repeat(64)}])[0].candidates[0].token, groups[0].candidates[0].token, "Edited bytes invalidate consent");
assert.equal(inspectConfirmedFileLinks(snapshot, "WAVE", index, [{...file, rows:[...file.rows!,file.rows![0]]}])[0].candidates.length, 0, "Duplicate SKU blocked");
assert.equal(inspectConfirmedFileLinks(snapshot, "WAVE", index, [{...file, rows:file.rows!.map(row=>({...row,barcode:'wrong'}))}])[0].candidates.length, 0, "Wrong barcode blocked");
const next = applyPickingWaveStoreMutation(snapshot, { action:"repairConfirmedFileLinks", before:snapshot.poConfirmationRecords, fileName:file.name, contentHash:file.contentHash!, now:"2026-09-05T00:00:00Z" });
for (const field of Object.keys(snapshot) as Array<keyof typeof snapshot>) {
  if (!["poConfirmationRecords","revision","updatedAt"].includes(field)) assert.deepEqual(next[field],snapshot[field],`${field} preserved`);
}
for (let i=0;i<2;i++) {
  assert.equal(next.poConfirmationRecords[i].stage,"confirmed");
  assert.equal(next.poConfirmationRecords[i].generatedFileName,file.name);
  assert.deepEqual(next.poConfirmationRecords[i].fileLinkBackups![0].record,snapshot.poConfirmationRecords[i]);
}
assert.throws(()=>repairConfirmedFileLinks(next.poConfirmationRecords,snapshot.poConfirmationRecords,file.name,file.contentHash!,"later"), /다른 기기/);
assert.equal(JSON.stringify(mergePoConfirmationRecords(next.poConfirmationRecords,snapshot.poConfirmationRecords)),JSON.stringify(next.poConfirmationRecords),"Old clients cannot overwrite recovered link");
const later = {...next.poConfirmationRecords[0],fileLinkBackups:undefined,updatedAt:"2026-09-06T00:00:00Z"} as PoConfirmationRecord;
assert.deepEqual(mergePoConfirmationRecords(next.poConfirmationRecords,[later])[0].fileLinkBackups,next.poConfirmationRecords[0].fileLinkBackups);
assert.equal(mergePoConfirmationRecords(next.poConfirmationRecords,[{...snapshot.poConfirmationRecords[0],updatedAt:"2026-09-06T00:00:00Z"}])[0].generatedFileName,file.name,"An old tab's later status-only save must preserve recovered file");
const genericRoute = readFileSync("app/api/wms/picking-waves/route.ts","utf8");
assert.match(genericRoute,/mutation.action === "repairConfirmedFileLinks"/);
console.log("확정파일 연결 복구 PASS: 전체 batch PO/SKU/수량, 파일변경 차단, 이전 기록 백업, 상태·나머지 데이터 보존");
