import assert from "node:assert/strict";
import { latestPurchasePrices, planSupplyPriceSync } from "../lib/wms/coupang-supply-price-sync";

const doc = (po: string, date: string, records: { skuId: string; unitPrice?: number }[]) => ({ purchaseOrderNumber: po, expectedArrivalDate: date,
  records: records.map(r => ({ ...r, expectedArrivalDate: date })) }) as any;
const index = { byPurchaseOrderNumber: new Map([
  ["1", doc("1", "2026-10-20", [{ skuId: "111", unitPrice: 2090 }, { skuId: "222", unitPrice: 5000 }])],
  ["2", doc("2", "2026-10-25", [{ skuId: "111", unitPrice: 2750 }, { skuId: "333" }])],
  ["3", doc("3", "2026-10-10", [{ skuId: "222", unitPrice: 4000 }])],
]) };
const prices = latestPurchasePrices(index);
assert.equal(prices.get("111")!.price, 2750, "입고예정일이 가장 늦은 발주");
assert.equal(prices.get("222")!.price, 5000, "파일 순서가 아니라 입고예정일 기준");
assert.equal(prices.has("333"), false, "매입가 없는 줄은 건너뜀");

const rows = [
  ["SKU ID", "이전쿠팡공급가", "최근쿠팡공급가", "공급가차이", "공급가확인"],
  ["111", "", 2090, "", "기준없음"],   // 바뀜 → 이전으로 옮김
  ["222", 4000, 5000, 1000, "확인필요"], // 같음 → 그대로
  ["444", "", "", "", ""],             // 발주 없음 → 그대로
  ["'111", "", "", "", ""],            // 비어 있음 → 최근만, 기준없음
];
const plan = planSupplyPriceSync(rows, prices);
assert.deepEqual(plan.changed, ["111", "111"]);
assert.deepEqual(plan.updates.filter(u => u.row === 2), [
  { row: 2, col: 3, value: 2750 }, { row: 2, col: 2, value: 2090 }, { row: 2, col: 4, value: 660 }, { row: 2, col: 5, value: "확인필요" },
]);
assert.deepEqual(plan.updates.filter(u => u.row === 5), [{ row: 5, col: 3, value: 2750 }, { row: 5, col: 4, value: "" }, { row: 5, col: 5, value: "기준없음" }]);
// 다시 돌려도 바뀌는 게 없음
const after = rows.map(r => [...r]);
for (const u of plan.updates) after[u.row - 1][u.col - 1] = u.value as any;
assert.equal(planSupplyPriceSync(after, prices).updates.length, 0);
console.log("PASS 원발주서 매입가 → 최근쿠팡공급가(바뀐 값만, 이전값 옮기기, 다시 돌려도 그대로)");
