import assert from "node:assert/strict";
import JSZip from "jszip";
import { buildLogisticsReceiptBoard, logisticsReceiptLineKey, type LogisticsAsideBaseline, type LogisticsReceiptTarget } from "../lib/wms/logistics-receipts";
import { completeLogisticsFollowUp, generateLogisticsFollowUp, logisticsFollowUpToken } from "../lib/wms/logistics-follow-up";
import { reserveLogisticsReceiptRoute } from "../lib/wms/logistics-receipt-routing";
import { pendingReorderQueue } from "../lib/wms/weekly-reorder-queue";
import { emptyWeeklyWorkspace } from "../lib/wms/weekly-work-state";

const at = new Date(Date.now() - 60_000).toISOString();
const baseline: LogisticsAsideBaseline = { closedShipmentNumbers: [], pendingTargets: [], completedMarketingSkuIds: [], excludedMarketingSkuIds: [], handledLines: [], source: "test" };
const target = (shipmentNumber: string): LogisticsReceiptTarget => ({ shipmentNumber, expectedDate: "2026-09-20", centerName: "검증", purchaseOrderNumbers: ["111"], source: "dispatch" });
const targets = [target("99990001"), target("99990002")];
const workspace = emptyWeeklyWorkspace();
workspace.logisticsReceipts = { source: "supplier-hub-shipments", schemaVersion: 2, collectedAt: at, requestedShipmentNumbers: targets.map(row => row.shipmentNumber), shipments: [
  { shipmentNumber: "99990001", status: "마감", totalDelivered: 5, totalReceived: 3, lines: [{ boxId: "A", purchaseOrderNumber: "111", skuId: "222", productName: "검증상품", barcode: "R", deliveredQuantity: 5, receivedQuantity: 3 }] },
  { shipmentNumber: "99990002", status: "마감", totalDelivered: 7, totalReceived: 4, lines: [{ boxId: "B", purchaseOrderNumber: "111", skuId: "222", productName: "검증상품", barcode: "R", deliveredQuantity: 7, receivedQuantity: 4 }] },
] };
const board = () => buildLogisticsReceiptBoard({ targets, snapshot: workspace.logisticsReceipts, baseline, routes: workspace.logisticsReceiptRoutes });
for (const shipmentNumber of ["99990001", "99990002"]) reserveLogisticsReceiptRoute(workspace, targets, { lineKey: logisticsReceiptLineKey(shipmentNumber, shipmentNumber === "99990001" ? "A" : "B", "111", "222"), decision: "reorder", expectedCollectedAt: at }, baseline, at);

void (async () => {
  const before = board();
  const generated = await generateLogisticsFollowUp(workspace, before, { token: logisticsFollowUpToken(workspace, before), expectedCollectedAt: at, kind: "reorder" });
  assert.equal(generated.proof.reorderRows?.length, 2, "proof retains both exact shipment sources");
  const zip = await JSZip.loadAsync(Buffer.from(generated.base64, "base64"));
  const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  assert.match(xml, /<c r="C3"[^>]*t="n"><v>5<\/v><\/c>/, "actual XLSX combines 2 + 3 only into request quantity 5");

  const third = target("99990003"); targets.push(third);
  workspace.logisticsReceipts!.requestedShipmentNumbers.push(third.shipmentNumber);
  workspace.logisticsReceipts!.shipments.push({ shipmentNumber: third.shipmentNumber, status: "마감", totalDelivered: 9, totalReceived: 5, lines: [{ boxId: "C", purchaseOrderNumber: "111", skuId: "222", productName: "검증상품", barcode: "R", deliveredQuantity: 9, receivedQuantity: 5 }] });
  reserveLogisticsReceiptRoute(workspace, targets, { lineKey: logisticsReceiptLineKey("99990003", "C", "111", "222"), decision: "reorder", expectedCollectedAt: at }, baseline, at);
  workspace.logisticsFollowUp = { proofs: [generated.proof] };
  const afterArrival = board();
  completeLogisticsFollowUp(workspace, afterArrival, { token: logisticsFollowUpToken(workspace, afterArrival), expectedCollectedAt: at, kind: "reorder", outputKey: generated.outputKey, confirmRequested: true, validatedSavedProof: generated.proof }, at);
  assert.deepEqual(pendingReorderQueue(workspace).rows.map(row => row.shortageQuantity), [4], "later shipment quantity 4 remains pending after prior 2 + 3 proof completes");

  const changed = structuredClone(workspace);
  changed.logisticsFollowUp!.proofs![0].completedAt = undefined;
  const old = changed.runs.find(run => run.logisticsReceiptLine?.shipmentNumber === "99990001")!;
  old.reorderRequestedAt = undefined; old.reorderQueuePartialRequestedAt = undefined;
  changed.logisticsReceipts!.shipments.find(row => row.shipmentNumber === "99990001")!.lines[0].receivedQuantity = 2;
  changed.logisticsReceipts!.shipments.find(row => row.shipmentNumber === "99990001")!.totalReceived = 2;
  const changedBoard = buildLogisticsReceiptBoard({ targets, snapshot: changed.logisticsReceipts, baseline, routes: changed.logisticsReceiptRoutes });
  assert.throws(() => completeLogisticsFollowUp(changed, changedBoard, { token: logisticsFollowUpToken(changed, changedBoard), expectedCollectedAt: at, kind: "reorder", outputKey: generated.outputKey, confirmRequested: true, validatedSavedProof: changed.logisticsFollowUp!.proofs![0] }, at), /출처가 변경/);
  console.log("PASS follow-up reorder actual XLSX, 2+3 source proof completion, later 4 retained, and changed quantity rejection (memory only)");
})().catch(error => { throw error; });
