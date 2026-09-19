import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { generateLogisticsFollowUp, completeLogisticsFollowUp, logisticsFollowUpToken } from "../lib/wms/logistics-follow-up";
import { collectFollowUpDiscontinue, completeFollowUpDiscontinue } from "../lib/wms/logistics-discontinue-adapter";
import { reserveLogisticsReceiptRoute } from "../lib/wms/logistics-receipt-routing";
import { buildLogisticsReceiptBoard, type LogisticsAsideBaseline, type LogisticsReceiptTarget } from "../lib/wms/logistics-receipts";
import { emptyWeeklyWorkspace } from "../lib/wms/weekly-work-state";
import type { StatusRequestRecord } from "../lib/wms/vendor-order-actions";

const at = new Date().toISOString();
const baseline: LogisticsAsideBaseline = { closedShipmentNumbers: [], pendingTargets: [], completedMarketingSkuIds: [], excludedMarketingSkuIds: [], handledLines: [], source: "test" };
const target = (n: string): LogisticsReceiptTarget => ({ shipmentNumber: n, expectedDate: "2026-09-20", centerName: "T", purchaseOrderNumbers: ["111"], source: "dispatch" });
const status = (id: string, skuId: string): StatusRequestRecord => ({ id, skuId, modelSku: "M", productName: skuId, optionLabel: "", currentStatus: "단종", requestType: "단종", requestedAt: at, supplyHubStatus: "처리대기", completedAt: "", requester: "T", processor: "", previousStatus: "정상", productLink: "", purchaseOrderNumber: "111", sheetRow: 2 });
const deps = { buildWeeklyOutput: async (run: any) => ({ fileName: "dc.zip", base64: Buffer.from(JSON.stringify(run.snapshot.vendorItems.map((item: any) => item.skuId))).toString("base64"), generated: { at, reviewToken: "mock", couponCount: 0, vendors: [], discontinueCount: run.snapshot.vendorItems.length, advertisingCount: 0, advertisingFiles: [] } }) };
const digest = (result: any) => createHash("sha256").update(JSON.stringify([result.fileName, result.base64, result.saved.output.generated, result.proof])).digest("hex");
function setup(receipt = true) {
  const workspace = emptyWeeklyWorkspace(), targets = receipt ? [target("99990001")]: [target("99990002")];
  workspace.logisticsReceipts = { source: "supplier-hub-shipments", schemaVersion: 2, collectedAt: at, requestedShipmentNumbers: targets.map(item => item.shipmentNumber), shipments: targets.map(item => ({ shipmentNumber: item.shipmentNumber, status: "마감", totalDelivered: receipt ? 2 : 1, totalReceived: 1, lines: [{ boxId: "B", purchaseOrderNumber: "111", skuId: receipt ? "222" : "999", productName: "R", barcode: "B", deliveredQuantity: receipt ? 2 : 1, receivedQuantity: 1 }] })) };
  let board = buildLogisticsReceiptBoard({ targets, snapshot: workspace.logisticsReceipts, baseline, routes: workspace.logisticsReceiptRoutes });
  if (receipt) { const line = board.lines.find(row => row.kind === "shortage")!; reserveLogisticsReceiptRoute(workspace, targets, { lineKey: line.lineKey, decision: "discontinue", expectedCollectedAt: at }, baseline, at); board = buildLogisticsReceiptBoard({ targets, snapshot: workspace.logisticsReceipts, baseline, routes: workspace.logisticsReceiptRoutes }); }
  return { workspace, targets, board };
}
async function generate(workspace: any, board: any) { return generateLogisticsFollowUp(workspace, board, { token: logisticsFollowUpToken(workspace, board), expectedCollectedAt: at, kind: "discontinue" }, deps); }
void (async () => {
  const receiptOnly = setup(true); const direct = await generate(receiptOnly.workspace, receiptOnly.board);
  assert.equal(direct.proof.discontinueCount, 1); assert.deepEqual(direct.proof.requestIds, undefined, "receipt-only DC needs no status request");
  const statusOnly = setup(false), records = [status("s1", "333"), status("s2", "444")];
  collectFollowUpDiscontinue(statusOnly.workspace, { requests: records, catalogItems: [] }, at);
  const statusFile = await generate(statusOnly.workspace, statusOnly.board);
  assert.deepEqual(statusFile.proof.requestIds, ["s1", "s2"]); assert.deepEqual(statusFile.proof.requestSkuIds, ["333", "444"]); assert.equal(statusFile.proof.discontinueCount, 2); assert.equal(statusFile.saved.digest, digest(statusFile), "saved digest covers the final status proof");
  const mixed = setup(true), mixedRecords = [status("s3", "222"), status("s4", "555")];
  collectFollowUpDiscontinue(mixed.workspace, { requests: mixedRecords, catalogItems: [] }, at);
  const mixedFile = await generate(mixed.workspace, mixed.board);
  const payload = Buffer.from(mixedFile.base64, "base64").toString(); assert.equal((payload.match(/222/g) || []).length, 1, "receipt and status same SKU dedupe in the DC file"); assert.equal(mixedFile.proof.discontinueCount, 2);
  statusOnly.workspace.logisticsFollowUp = { proofs: [statusFile.proof] };
  completeLogisticsFollowUp(statusOnly.workspace, statusOnly.board, { token: logisticsFollowUpToken(statusOnly.workspace, statusOnly.board), expectedCollectedAt: at, kind: "discontinue", outputKey: statusFile.outputKey, confirmSubmitted: true, validatedSavedProof: statusFile.proof }, at);
  records.push(status("later", "666"));
  await completeFollowUpDiscontinue(statusOnly.workspace, { requestIds: statusFile.proof.requestIds!, skuIds: statusFile.proof.requestSkuIds!, reviewToken: statusFile.proof.discontinueReviewToken! }, { completeStatusRequests: async ids => { records.forEach(row => { if (ids.includes(row.id)) row.supplyHubStatus = "처리완료"; }); return ids.length; }, listStatusRequests: async () => structuredClone(records) }, at);
  assert.equal(records.find(row => row.id === "later")!.supplyHubStatus, "처리대기", "later status request is not completed by old proof");
  console.log("PASS logistics follow-up status integration: receipt, status, mixed dedupe, digest, and immutable completion IDs");
})().catch(error => { throw error; });
