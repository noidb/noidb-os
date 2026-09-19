import assert from "node:assert/strict";
import {
  buildLogisticsReceiptBoard,
  logisticsReceiptLineKey,
  logisticsReceiptSourceFingerprint,
  mergeLogisticsReceiptTargets,
  mergeLogisticsReceiptSnapshot,
  parseLogisticsReceiptImport,
  type LogisticsAsideBaseline,
  type LogisticsReceiptTarget,
} from "../lib/wms/logistics-receipts";

const targets: LogisticsReceiptTarget[] = [
  { shipmentNumber: "50129650", expectedDate: "2026-09-17", centerName: "동탄1", purchaseOrderNumbers: ["142638543"], source: "dispatch" },
  { shipmentNumber: "50129651", expectedDate: "2026-09-17", centerName: "동탄1", purchaseOrderNumbers: [], source: "aside" },
];
const baseline: LogisticsAsideBaseline = {
  closedShipmentNumbers: [], pendingTargets: [], completedMarketingSkuIds: ["801"], excludedMarketingSkuIds: ["900"],
  handledLines: [{ shipmentNumber: "50129650", purchaseOrderNumber: "142638543", skuId: "100", quantity: 3, classification: "reorder", note: "already handled" }], source: {},
};
const input = {
  source: "supplier-hub-shipments" as const, schemaVersion: 3 as const, collectedAt: "2026-09-19T01:00:00.000Z",
  requestedShipmentNumbers: ["50129650", "50129651"],
  shipments: [
    { shipmentNumber: "50129650", status: "마감", totalDelivered: 8, totalReceived: 3, lines: [
      { boxId: "A", purchaseOrderNumber: "142638543", skuId: "100", productName: "short", barcode: "b", deliveredQuantity: 4, receivedQuantity: 1 },
      { boxId: "B", purchaseOrderNumber: "142638543", skuId: "100", productName: "short", barcode: "b", deliveredQuantity: 3, receivedQuantity: 1 },
      { boxId: "C", purchaseOrderNumber: "142638543", skuId: "200", productName: "first", barcode: "c", deliveredQuantity: 0, receivedQuantity: 0 },
      { boxId: "D", purchaseOrderNumber: "142638543", skuId: "300", productName: "first", barcode: "d", deliveredQuantity: 1, receivedQuantity: 1 },
    ] },
    { shipmentNumber: "50129651", status: "발송 완료", totalDelivered: null, totalReceived: null, lines: [] },
  ],
  skuStatuses: ["100", "200", "300"].map(skuId => ({ skuId, orderStatus: "정상" as const })),
};

assert.throws(() => parseLogisticsReceiptImport({ ...input, requestedShipmentNumbers: ["50129650"] }, targets));
assert.throws(() => parseLogisticsReceiptImport({ ...input, shipments: [{ ...input.shipments[0], status: "CLOSED" }, input.shipments[1]] }, targets));
assert.throws(() => parseLogisticsReceiptImport({ ...input, skuStatuses: [{ skuId: "100", orderStatus: "정상" as const }, { skuId: "100", orderStatus: "불가" as const }, { skuId: "300", orderStatus: "정상" as const }] }, targets));
const snapshot = parseLogisticsReceiptImport(input, targets);
const board = buildLogisticsReceiptBoard({ targets, snapshot, baseline, routes: {
  [logisticsReceiptLineKey("50129650", "A", "142638543", "100")]: { decision: "reorder", runId: "run", at: input.collectedAt, completed: true, quantity: 1, sourceFingerprint: "x" },
} });
const shortage = board.lines.filter(line => line.kind === "shortage" && line.shipmentNumber === "50129650");
assert.equal(shortage.length, 2);
assert.equal(shortage[0].handledQuantity, 3);
assert.equal(shortage[0].remainingQuantity, 0);
assert.equal(shortage[0].state, "review");
assert.equal(shortage[1].remainingQuantity, 2);
assert.equal(board.lines.find(line => line.shipmentNumber === "50129651")?.state, "pending");
assert.equal(board.lines.find(line => line.kind === "marketing")?.skuId, "300");
const routedLine = board.lines.find(line => line.lineKey === logisticsReceiptLineKey("50129650", "A", "142638543", "100"))!;
assert.equal(routedLine.route?.completed, true);
assert.notEqual(logisticsReceiptSourceFingerprint(routedLine), routedLine.route?.sourceFingerprint);
assert.equal(routedLine.state, "review");

const legacyBoard = buildLogisticsReceiptBoard({ targets, snapshot: { ...input, schemaVersion: 2 as const }, baseline });
assert.equal(legacyBoard.lines.find(line => line.kind === "shortage" && line.skuId === "100")?.state, "review");
assert.match(legacyBoard.warnings.join(" "), /다시 수집/);
const unavailableBoard = buildLogisticsReceiptBoard({ targets, snapshot: { ...input, skuStatuses: [{ skuId: "100", orderStatus: "불가" as const }, { skuId: "200", orderStatus: "정상" as const }, { skuId: "300", orderStatus: "정상" as const }] }, baseline });
assert.equal(unavailableBoard.lines.find(line => line.kind === "shortage" && line.skuId === "100")?.state, "review");
assert.match(unavailableBoard.warnings.join(" "), /불가·일시중단/);

const dispatchTarget: LogisticsReceiptTarget = { shipmentNumber: "50129653", expectedDate: "2026-09-17", centerName: "동탄1", purchaseOrderNumbers: ["142638543"], source: "dispatch" };
const asideDuplicate: LogisticsReceiptTarget = { ...dispatchTarget, purchaseOrderNumbers: [], source: "aside" };
assert.deepEqual(mergeLogisticsReceiptTargets([dispatchTarget], [asideDuplicate]), [dispatchTarget]);
assert.throws(() => parseLogisticsReceiptImport({ ...input, shipments: [{ ...input.shipments[0], lines: input.shipments[0].lines.filter(line => line.purchaseOrderNumber !== "142638543") }, input.shipments[1]] }, targets));

const expandedTargets = [...targets, { shipmentNumber: "50129652", expectedDate: "2026-09-18", centerName: "서울", purchaseOrderNumbers: ["142638543"], source: "dispatch" as const }];
const expandedBoard = buildLogisticsReceiptBoard({ targets: expandedTargets, snapshot, baseline });
assert.equal(expandedBoard.lines.find(line => line.shipmentNumber === "50129652")?.state, "unknown");
assert.throws(() => mergeLogisticsReceiptSnapshot(snapshot, { ...input, collectedAt: "2026-09-18T01:00:00.000Z" }, targets));
console.log("logistics receipt v2 verification passed");
