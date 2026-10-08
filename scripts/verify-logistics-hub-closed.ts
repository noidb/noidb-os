import assert from "node:assert/strict";
import { buildLogisticsReceiptBoard, fillSkuStatusesFromProductDb, needsProductDbStatusFill, LOGISTICS_RECEIPT_EPOCH, logisticsTargetsFromSnapshot, mergeHubClosedSnapshot } from "../lib/wms/logistics-receipts";
import { resetLogisticsReceiptHistory } from "../lib/wms/logistics-receipt-reset";
import type { WeeklyWorkspace } from "../lib/wms/weekly-work-types";

const ship = (id: string, lines: Array<[string, string, string, number, number]>) => ({ shipmentNumber: id, status: "마감", lines: lines.map(([box, po, sku, d, r]) => ({ boxId: box, purchaseOrderNumber: po, skuId: sku, productName: "상품", barcode: "B", deliveredQuantity: d, receivedQuantity: r })),
  totalDelivered: lines.reduce((n, l) => n + l[3], 0), totalReceived: lines.reduce((n, l) => n + l[4], 0) });
const payload = (at: string, extra: Record<string, unknown> = {}) => ({ source: "supplier-hub-shipments", schemaVersion: 3, mode: "hub-closed", since: "2026-09-13", collectedAt: at,
  requestedShipmentNumbers: ["50000001", "50000002"], shipments: [ship("50000001", [["A", "111", "1", 3, 1]]), ship("50000002", [["A", "222", "2", 2, 2], ["B", "223", "3", 1, 1]])],
  skuStatuses: [{ skuId: "1", orderStatus: "정상" }, { skuId: "2", orderStatus: "정상" }, { skuId: "3", orderStatus: "정상" }],
  shipmentMetadata: { "50000001": { expectedDate: "2026-09-13", centerName: "동탄1" }, "50000002": { expectedDate: "2026-10-01", centerName: "대구3" } }, ...extra });

const workspace = { schemaVersion: 1, revision: 3, runs: [{ id: "OLD" }], productOverrides: { "9": { vendorName: "x", imageUrl: "", discontinued: false } }, logisticsReceiptRoutes: { old: {} }, logisticsFollowUp: {} } as unknown as WeeklyWorkspace;
assert.equal(resetLogisticsReceiptHistory(workspace), true);
assert.deepEqual(workspace.runs, []); assert.equal(workspace.logisticsReceiptRoutes, undefined); assert.equal(workspace.logisticsReceiptEpoch, LOGISTICS_RECEIPT_EPOCH);
assert.ok(workspace.productOverrides["9"], "product facts survive");
workspace.runs.push({ id: "NEW" } as never);
assert.equal(resetLogisticsReceiptHistory(workspace), false, "reset happens only once"); assert.equal(workspace.runs.length, 1);

const now = new Date(Date.now() - 60_000).toISOString();
const snapshot = mergeHubClosedSnapshot(undefined, payload(now));
const targets = logisticsTargetsFromSnapshot(snapshot);
assert.deepEqual(targets.map(t => [t.shipmentNumber, t.expectedDate, t.centerName, t.purchaseOrderNumbers]), [["50000001", "2026-09-13", "동탄1", ["111"]], ["50000002", "2026-10-01", "대구3", ["222", "223"]]]);
const board = buildLogisticsReceiptBoard({ targets, snapshot, baseline: { closedShipmentNumbers: [], pendingTargets: [], completedMarketingSkuIds: [], excludedMarketingSkuIds: [], handledLines: [], source: {} } });
const shortage = board.lines.filter(l => l.kind === "shortage");
assert.deepEqual(shortage.map(l => [l.skuId, l.remainingQuantity, l.state]), [["1", 2, "ready"]]);
assert.deepEqual(board.lines.filter(l => l.kind === "marketing").map(l => l.skuId), ["1", "3"], "1개 입고 SKU는 쿠폰·광고 후보");

assert.throws(() => mergeHubClosedSnapshot(undefined, payload(now, { shipmentMetadata: { "50000001": { expectedDate: "2026-09-12", centerName: "동탄1" }, "50000002": { expectedDate: "2026-10-01", centerName: "대구3" } } })), /대상·상태·수량/);
assert.throws(() => mergeHubClosedSnapshot(undefined, { ...payload(now), mode: undefined }), /0\.9\.8/);
assert.throws(() => mergeHubClosedSnapshot(snapshot, payload(new Date(Date.now() - 120_000).toISOString())), /더 최신/);
// 쿠팡에서 조회되지 않은 SKU도 저장되고, 검토(review)로 분류된다.
const odd = payload(new Date(Date.now() - 30_000).toISOString()) as ReturnType<typeof payload> & { skuStatuses: Array<{ skuId: string; orderStatus: string }> };
odd.skuStatuses[0].orderStatus = "조회안됨";
const oddSnapshot = mergeHubClosedSnapshot(undefined, odd);
const oddBoard = buildLogisticsReceiptBoard({ targets: logisticsTargetsFromSnapshot(oddSnapshot), snapshot: oddSnapshot, baseline: { closedShipmentNumbers: [], pendingTargets: [], completedMarketingSkuIds: [], excludedMarketingSkuIds: [], handledLines: [], source: {} } });
const oddLine = oddBoard.lines.find(l => l.kind === "shortage" && l.skuId === "1")!;
assert.equal(oddLine.state, "review"); assert.match(oddLine.reviewReason || "", /조회안됨/);
// 조회안됨 SKU는 제품DB 발주가능상태로 한 번 채우고, 쿠팡이 준 값은 그대로 둔다.
const fillSnap = mergeHubClosedSnapshot(undefined, odd);
fillSnap.skuStatuses![1].orderStatus = "불가";
assert.equal(needsProductDbStatusFill(fillSnap), true);
assert.equal(fillSkuStatusesFromProductDb(fillSnap, new Map([["1", "정상"], ["2", "정상"]]), "2026-10-08T03:00:00.000Z"), 1);
assert.deepEqual(fillSnap.skuStatuses!.map(s => s.orderStatus), ["정상", "불가", "정상"]);
assert.deepEqual(fillSnap.skuStatusesFromProductDb, ["1"]); assert.equal(needsProductDbStatusFill(fillSnap), false);
const filledBoard = buildLogisticsReceiptBoard({ targets: logisticsTargetsFromSnapshot(fillSnap), snapshot: fillSnap, baseline: { closedShipmentNumbers: [], pendingTargets: [], completedMarketingSkuIds: [], excludedMarketingSkuIds: [], handledLines: [], source: {} } });
assert.equal(filledBoard.lines.find(l => l.kind === "shortage" && l.skuId === "1")!.state, "ready");
// 다음 수집에서 예전 마감건이 쿠팡 목록에서 빠져도 남고, 새 마감건이 더해진다. 처리기록(routes)은 같은 줄 키로 유지된다.
const later = payload(new Date(Date.now() - 10_000).toISOString(), {
  requestedShipmentNumbers: ["50000002", "50000003"], shipments: [ship("50000002", [["A", "222", "2", 2, 2], ["B", "223", "3", 1, 1]]), ship("50000003", [["A", "333", "4", 2, 1]])],
  skuStatuses: [{ skuId: "2", orderStatus: "정상" }, { skuId: "3", orderStatus: "정상" }, { skuId: "4", orderStatus: "정상" }],
  shipmentMetadata: { "50000002": { expectedDate: "2026-10-01", centerName: "대구3" }, "50000003": { expectedDate: "2026-10-09", centerName: "고양1" } } });
const kept = mergeHubClosedSnapshot(snapshot, later);
assert.deepEqual(kept.shipments.map(x => x.shipmentNumber).sort(), ["50000001", "50000002", "50000003"]);
const keptBoard = buildLogisticsReceiptBoard({ targets: logisticsTargetsFromSnapshot(kept), snapshot: kept, baseline: { closedShipmentNumbers: [], pendingTargets: [], completedMarketingSkuIds: [], excludedMarketingSkuIds: [], handledLines: [], source: {} } });
assert.deepEqual(keptBoard.lines.filter(l => l.kind === "shortage").map(l => l.skuId).sort(), ["1", "4"]);
assert.equal(keptBoard.lines.filter(l => l.kind === "shortage" && l.skuId === "1").length, 1, "no duplicate line for the same shipment");
console.log("PASS hub-closed collection: one-time reset, 9/13 cutoff, targets from Supplier Hub list, shortage + first-arrival board, stale/old-extension guards");
