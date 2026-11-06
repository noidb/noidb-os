import assert from "node:assert/strict";
import { buildLogisticsReceiptBoard, logisticsTargetsFromSnapshot, mergeHubClosedSnapshot } from "../lib/wms/logistics-receipts";
import { mergeSettlementInbound, settlementKey } from "../lib/wms/settlement-inbound";

const ship = (id: string, lines: Array<[string, string, string, number, number]>) => ({ shipmentNumber: id, status: "마감", lines: lines.map(([box, po, sku, d, r]) => ({ boxId: box, purchaseOrderNumber: po, skuId: sku, productName: "상품", barcode: "", deliveredQuantity: d, receivedQuantity: r })),
  totalDelivered: lines.reduce((n, l) => n + l[3], 0), totalReceived: lines.reduce((n, l) => n + l[4], 0) });
const at = new Date(Date.now() - 60_000).toISOString();
const snapshot = mergeHubClosedSnapshot(undefined, { source: "supplier-hub-shipments", schemaVersion: 3, mode: "hub-closed", since: "2026-09-13", collectedAt: at,
  requestedShipmentNumbers: ["50000001", "50000002"], shipments: [ship("50000001", [["A", "111", "1", 5, 0], ["A", "111", "2", 4, 0]]), ship("50000002", [["A", "222", "3", 6, 0]])],
  skuStatuses: [{ skuId: "1", orderStatus: "정상" }, { skuId: "2", orderStatus: "정상" }, { skuId: "3", orderStatus: "정상" }],
  shipmentMetadata: { "50000001": { expectedDate: "2026-09-13", centerName: "동탄1" }, "50000002": { expectedDate: "2026-10-01", centerName: "대구3" } } });
const targets = logisticsTargetsFromSnapshot(snapshot);
const baseline = { closedShipmentNumbers: [], pendingTargets: [], completedMarketingSkuIds: [], excludedMarketingSkuIds: [], handledLines: [], source: {} };
const shortage = (settled?: Record<string, number>) => buildLogisticsReceiptBoard({ targets, snapshot, baseline, settledByPoSku: settled });

assert.deepEqual(shortage().lines.filter(l => l.kind === "shortage").map(l => l.skuId), ["1", "2", "3"], "no upload → all review");
const full = shortage({ [settlementKey("111", "1")]: 5, [settlementKey("111", "2")]: 3 });
assert.deepEqual(full.lines.filter(l => l.kind === "shortage").map(l => l.skuId), ["2", "3"], "fully settled line removed; partial (3<4) kept");
assert.deepEqual(full.settlementCleared?.map(c => [c.skuId, c.settledQuantity]), [["1", 5]]);
assert.equal(shortage({ [settlementKey("222", "3")]: 9 }).settlementCleared?.[0]?.skuId, "3", "settled above delivered also clears");
assert.equal(shortage({ [settlementKey("999", "1")]: 9 }).settlementCleared, undefined, "other PO does not clear");

const f = (id: string, rows: Array<[string, string, number, string]>) => ({ id, name: id + ".xlsx", signature: id + "1", rows: rows.map(([po, sku, quantity, date]) => ({ purchaseOrderNumber: po, skuId: sku, quantity, date })) });
const first = mergeSettlementInbound(undefined, [f("a", [["111", "1", 3, "2026-10-01"], ["111", "1", 2, "2026-10-02"]])], "t1");
assert.equal(first.totals["111|1"], 5);
const second = mergeSettlementInbound(first, [f("b", [["111", "1", 5, "2026-10-02"], ["111", "2", 4, "2026-10-03"], ["111", "2", -1, "2026-10-03"]])], "t2");
assert.equal(second.totals["111|1"], 5, "overlapping files do not double count");
assert.equal(second.totals["111|2"], 3, "반출 subtracted within file");
assert.deepEqual(Object.keys(second.files || {}).sort(), ["a", "b"]);
assert.equal(second.firstDate, "2026-10-01"); assert.equal(second.lastDate, "2026-10-03");
console.log("settlement-inbound OK");
