import assert from "node:assert/strict";
import { computeSkuTracking, newInboundBaselines, planTrackingSync, sheetDate } from "../lib/wms/product-db-tracking-sync";

const doc = (po: string, date: string, firstReceivedAt: string, records: Array<[string, number]>) => ({ purchaseOrderNumber: po, expectedArrivalDate: date, firstReceivedAt,
  records: records.map(([skuId, orderedQuantity]) => ({ skuId, orderedQuantity, expectedArrivalDate: date })) }) as any;
const index = { byPurchaseOrderNumber: new Map([
  ["900", doc("900", "2026-09-01", "2026-08-28T03:00:00Z", [["111", 5]])],          // 9/13 이전: 미입고 아님
  ["901", doc("901", "2026-10-15", "2026-10-12T01:00:00Z", [["111", 3], ["222", 2]])], // 마감됨
  ["902", doc("902", "2026-10-22", "2026-10-20T16:00:00Z", [["111", 4]])],          // 보냈는데 아직 마감 전(피킹 2개)
  ["903", doc("903", "2026-10-28", "2026-10-23T01:00:00Z", [["222", 6]])],          // 작업 전, 입고예정 오늘 이후
  ["904", doc("904", "2026-10-21", "2026-10-19T01:00:00Z", [["333", 7]])],          // 작업 전인데 예정일 지남 → 0
]) };
const receipts = { shipments: [{ shipmentNumber: "S1", status: "마감", totalDelivered: 5, totalReceived: 4, lines: [
  { boxId: "b", purchaseOrderNumber: "901", skuId: "111", productName: "", barcode: "", deliveredQuantity: 3, receivedQuantity: 3 },
  { boxId: "b", purchaseOrderNumber: "901", skuId: "222", productName: "", barcode: "", deliveredQuantity: 2, receivedQuantity: 1 },
] }], shipmentMetadata: { S1: { expectedDate: "2026-10-15", centerName: "안산3" } } } as any;
const tracking = computeSkuTracking({ index, receipts, shipped: [{ purchaseOrderNumber: "902", skuId: "111", quantity: 2 }], today: "2026-10-23" });
assert.deepEqual(tracking.get("111"), { receivedSince: 3, pending: 2, lastInboundDate: "2026-10-15", lastOrderDate: "2026-10-21" }, "발주일은 받은 시각의 한국 날짜");
assert.deepEqual(tracking.get("222"), { receivedSince: 1, pending: 6, lastInboundDate: "2026-10-15", lastOrderDate: "2026-10-23" });
assert.equal(tracking.get("333")!.pending, 0);

assert.equal(sheetDate("2026/09/04"), "2026-09-04");
assert.equal(sheetDate(46123), "2026-04-11");

const rows: unknown[][] = [
  ["SKU ID", "누적입고", "미입고", "최근발주일", "최근입고일"],
  ["111", 10, 1, "2026/09/04", "2026/08/19"],
  ["222", "", "", "", "2026/10/20"],
  ["333", 4, 1, "2026/10/22", ""],
  ["444", 2, "", "", ""],
];
const added = newInboundBaselines(rows, tracking, {});
assert.deepEqual(added, { "111": 10, "222": 0 }, "입고결과에 처음 나온 SKU만 지금 값으로");
const plan = planTrackingSync(rows, tracking, added);
const cell = (row: number, col: number) => plan.updates.find(u => u.row === row && u.col === col)?.value;
assert.equal(cell(2, 2), 13); assert.equal(cell(2, 3), 2); assert.equal(cell(2, 4), "2026/10/21"); assert.equal(cell(2, 5), "2026/10/15");
assert.equal(cell(3, 2), 1); assert.equal(cell(3, 3), 6); assert.equal(cell(3, 5), undefined, "더 늦은 입고일은 그대로");
assert.equal(cell(4, 3), "", "남은 발주 없으면 미입고 비움"); assert.equal(cell(4, 4), undefined, "더 늦은 발주일은 그대로");
assert.equal(plan.updates.some(u => u.row === 5), false, "관련 없는 줄은 안 건드림");
// 다시 돌려도 같은 값
const after = rows.map(r => [...r]);
for (const u of plan.updates) after[u.row - 1][u.col - 1] = u.value;
assert.equal(planTrackingSync(after, tracking, added).updates.length, 0);
// 8/22~9/20 입고상세: 입고결과에 있는 발주(901)는 빼고, 없는 발주(800)만 더한다
{
  const withGap = computeSkuTracking({ index, receipts, shipped: [], today: "2026-10-23", gapRows: [["800", "444", 3, "2026-09-05"], ["901", "111", 3, "2026-09-16"], ["800", "111", 2, "2026-09-02"]] });
  assert.equal(withGap.get("444")!.receivedGap, 3); assert.equal(withGap.get("444")!.lastInboundDate, "2026-09-05");
  assert.equal(withGap.get("111")!.receivedGap, 2); assert.equal(withGap.get("111")!.lastInboundDate, "2026-10-15");
  const base = newInboundBaselines(rows, withGap, {});
  assert.equal(base["444"], 2);
  const p2 = planTrackingSync(rows, withGap, base);
  assert.equal(p2.updates.find(u => u.row === 5 && u.col === 2)?.value, 5);
  assert.equal(p2.updates.find(u => u.row === 2 && u.col === 2)?.value, 15);
}
console.log("PASS 제품DB 누적입고·미입고·최근발주일·최근입고일 자동입력(다시 돌려도 그대로)");
