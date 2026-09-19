import assert from "node:assert/strict";
import JSZip from "jszip";
import { moveWorkListItem } from "../lib/wms/work-list-routing";
import { completeLogisticsFollowUp, generateLogisticsFollowUp, logisticsFollowUpResponse, logisticsFollowUpToken } from "../lib/wms/logistics-follow-up";
import type { LogisticsReceiptBoard } from "../lib/wms/logistics-receipts";
import { pendingReorderQueue } from "../lib/wms/weekly-reorder-queue";
import { emptyWeeklyWorkspace } from "../lib/wms/weekly-work-state";
import { vendorReorderMaterial } from "../lib/wms/vendor-order/reorder-material";
import { targetVendorVersion, transferSentVendorLine } from "../lib/wms/vendor-order/sent-vendor-transfer";
import type { VendorOrderDraftLine } from "../lib/wms/vendor-order/types";
import { emptyPickingWaveStoreSnapshot } from "../lib/wms/picking-wave/shared-store-types";
import { applyPickingWaveStoreMutation } from "../lib/wms/picking-wave/server-store";

const at = "2026-09-20T00:00:00.000Z";
let workspace = emptyWeeklyWorkspace();
workspace.logisticsReceipts = { source: "supplier-hub-shipments", schemaVersion: 2, collectedAt: at, requestedShipmentNumbers: [], shipments: [] };
const line = (overrides: Partial<VendorOrderDraftLine> = {}): VendorOrderDraftLine => ({
  id: "aside-line", draftId: "aside-draft", waveId: "aside-wave", vendorName: "검증거래처", skuId: "222", modelName: "", category: "", optionLabel: "", productName: "검증상품", imageUrl: "", barcode: "", actualShortageQuantity: 1, shortageQuantity: 12, currentStock: "", relatedPurchaseOrderNumbers: ["12"], memo: "", isManuallyAdded: true, createdAt: at, updatedAt: at,
  importedVendorSource: { kind: "aside-vendor-pending", batchId: "aside19", fileName: "workbook19.xlsx", sheetName: "거래처발주", rowNumber: 19, recordedAt: at, skuId: "222", details: [{ purchaseOrderNumber: "12", confirmedQuantity: 3, receivedQuantity: 2, shortageQuantity: 1 }] },
  ...overrides,
});
let picking = emptyPickingWaveStoreSnapshot();
picking.vendorOrderDrafts = [{ id: "aside-draft", waveId: "aside-wave", vendorName: "검증거래처", status: "sent", createdAt: at, updatedAt: at }];
picking.vendorOrderLines = [line()];
const deps = {
  readWeeklyWorkspace: async () => structuredClone(workspace),
  mutateWeeklyWorkspace: async (fn: (value: typeof workspace) => unknown) => { const next = structuredClone(workspace); const value = fn(next); next.revision++; workspace = next; return structuredClone(value); },
  listStatusRequests: async () => [], readPickingWaveStore: async () => structuredClone(picking),
  mutatePickingWaveStore: async (operation: any) => { picking = applyPickingWaveStoreMutation(picking, operation); return structuredClone(picking); },
  transferWeeklyVendorQueue: async () => { throw new Error("reorder only"); },
};
const board = (): LogisticsReceiptBoard => ({ collectedAt: at, targets: [], lines: [], warnings: [] });

void (async () => {
  const material = vendorReorderMaterial(workspace, picking.vendorOrderLines[0]);
  assert.equal(material.importedVendorEvidence, true);
  assert.equal(material.item.shortageQuantity, 1, "supplier order quantity must not replace imported original shortage");
  await moveWorkListItem("vendor", "aside-line", "reorder", at, deps as any, true, { token: material.token, purchaseOrderNumbers: ["12"] });
  assert.equal(workspace.runs.length, 1); assert.equal(workspace.runs[0].actualInboundRoute?.decision, "reorder"); assert.equal(workspace.runs[0].actualInboundRoute?.completed, true);
  assert.deepEqual(pendingReorderQueue(workspace).rows.map(row => [row.purchaseOrderNumber, row.skuId, row.shortageQuantity]), [["12", "222", 1]]);
  const response = logisticsFollowUpResponse(workspace, board()); assert.equal(response.queues.reorder.length, 1);
  const generated = await generateLogisticsFollowUp(workspace, board(), { token: logisticsFollowUpToken(workspace, board()), expectedCollectedAt: at, kind: "reorder" });
  const sheet = await (await JSZip.loadAsync(Buffer.from(generated.base64, "base64"))).file("xl/worksheets/sheet1.xml")!.async("string"); assert.match(sheet, /<c r="C3"[^>]*t="n"><v>1<\/v><\/c>/);
  await moveWorkListItem("vendor", "aside-line", "reorder", picking.vendorOrderLines[0].updatedAt, deps as any, true, { token: vendorReorderMaterial(workspace, picking.vendorOrderLines[0]).token, purchaseOrderNumbers: ["12"] });
  assert.equal(workspace.runs.length, 1, "retry must reuse the original imported source run");
  workspace.logisticsFollowUp = { proofs: [generated.proof] };
  completeLogisticsFollowUp(workspace, board(), { token: logisticsFollowUpToken(workspace, board()), expectedCollectedAt: at, kind: "reorder", outputKey: generated.outputKey, confirmRequested: true, validatedSavedProof: generated.proof }, at);
  assert.equal(pendingReorderQueue(workspace).rows.length, 0, "completed proof removes the imported source from the reorder queue");
  assert.throws(() => vendorReorderMaterial(emptyWeeklyWorkspace(), line({ skuId: "999" })), /가져온 거래처 미납/);
  assert.throws(() => vendorReorderMaterial(emptyWeeklyWorkspace(), line({ relatedPurchaseOrderNumbers: ["13"] })), /가져온 거래처 미납/);
  const transferStore = emptyPickingWaveStoreSnapshot(); transferStore.activeVendorQueueId = "aside-wave";
  transferStore.vendorOrderDrafts = [{ id: "aside-draft", waveId: "aside-wave", vendorName: "검증거래처", status: "sent", createdAt: at, updatedAt: at }];
  transferStore.vendorOrderLines = [line({ id: "transfer-line" })];
  const transferred = transferSentVendorLine(transferStore, { lineId: "transfer-line", vendorName: "새거래처", operationId: "aside-transfer", now: at, expectedUpdatedAt: at, expectedQueueId: "aside-wave", expectedTargetVersion: targetVendorVersion(transferStore, "새거래처") });
  const moved = transferred.vendorOrderLines.find(row => row.vendorTransferSourceLineId === "transfer-line")!;
  assert.deepEqual(moved.importedVendorSource, transferStore.vendorOrderLines[0].importedVendorSource, "supplier transfer keeps imported shortage evidence");
  console.log("PASS Aside19 sent-vendor pending evidence -> reorder queue -> XLSX; retry and mismatches are guarded (memory only)");
})().catch(error => { console.error(error); process.exitCode = 1; });
