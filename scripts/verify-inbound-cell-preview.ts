import assert from "node:assert/strict";
import { buildInboundCellPreview } from "../lib/wms/inbound-cell-preview";
import { parseInboundSourceRows } from "../lib/wms/inbound-import-safety";

const products = [["SKU ID", "누적입고", "미입고", "현재고", "원가"], ["100", "8", "99", "57", "700"], ["200", "9", "6", "88", "900"]];
const purchases = [["발주번호", "SKU ID", "확정수량", "발주수량", "발주현황"], ["A", "100", "12", "12", "확정"], ["B", "100", "4", "4", "확정"], ["C", "100", "0", "10", "확정"]];
const history = [["발주번호", "SKU ID", "입고수량", "반출"], ["A", "100", "8", "0"]];
const incoming = parseInboundSourceRows([{ 번호: "A", SKU번호: "100", 구분: "발주", "입고/반출시각": "2026/09/06 12:00:00", 수량: "4" }], "fixture.xlsx");
const before = JSON.stringify({ products, purchases, history, incoming });
const plan = buildInboundCellPreview(products, purchases, history, incoming);
assert.deepEqual(plan.blockers, []);
assert.deepEqual(plan.changes.map(c => [c.sku, c.row, c.column, c.field, c.before, c.after]), [
  ["100", 2, 2, "누적입고", "8", 12], ["100", 2, 3, "미입고", "99", 4],
]);
assert.equal(JSON.stringify({ products, purchases, history, incoming }), before);
assert.deepEqual(buildInboundCellPreview(products, purchases, history, []).changes, []);
for (const [db, po, received] of [
  [[...products, products[1]], purchases, history],
  [[products[0], ["100", "=SUM(A1)", "99"]], purchases, history],
  [products, [...purchases, purchases[1]], history],
  [products, purchases.filter(row => row[0] !== "A"), history],
  [products, purchases, [...history, ["A", "100", "0", "99"]]],
  [products, purchases, [...history, ["", "100", "2", "0"]]],
] as const) {
  const invalid = buildInboundCellPreview(db as string[][], po as string[][], received as string[][], incoming);
  assert.ok(invalid.blockers.length);
  assert.deepEqual(invalid.changes, [], "a conflict blocks the entire plan");
}
const edited = products.map(row => [...row]); edited[1][2] = "98";
assert.notEqual(buildInboundCellPreview(edited, purchases, history, incoming).token, plan.token);
console.log("Inbound cell preview PASS: late 8+4, PO isolation, confirmed zero, targeted cells, no mutation, formula/duplicate/history guards, changed snapshot token");
