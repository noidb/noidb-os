import assert from "node:assert/strict";
import { planWarehouseRecheckCleanup } from "../lib/wms/warehouse-recheck-cleanup";
const recheck = [["SKU ID", "상품명", "현재상태", "발주가능상태", "창고 확인결과", "이미지"],
  ["1", "가", "창고재확인", "정상", "", "=IMAGE(\"a\")"],
  ["2", "나", "창고재확인", "불가", "거래처 단종", "=IMAGE(\"b\")"],
  ["3", "다", "창고재확인", "불가", "제품DB로 이동(재고있음)", "x"],
  ["4", "라", "창고재확인", "", "제품DB로 이동 (재고있음)", "y"],
  ["5", "마", "창고재확인", "정상", "기타메모", ""]];
const productDb = [["SKU ID", "상품명", "현재상태", "발주가능상태", "이미지"], ["4", "라", "창고재확인", "정상", "y"]];
const storage = [["SKU ID", "상품명", "현재상태", "이미지"]];
const plan = planWarehouseRecheckCleanup(recheck, productDb, storage);
assert.deepEqual(plan.problems, []);
assert.equal(plan.pending, 1);
assert.deepEqual(plan.appendStorage, [["2", "나", "거래처단종", "=IMAGE(\"b\")"]]);
assert.deepEqual(plan.appendProductDb, [["3", "다", "", "불가", "x"]]);
assert.deepEqual(plan.clearStatusRows, [2]);
assert.deepEqual(plan.deleteRows, [3, 4, 5]);
assert.deepEqual(plan.moves.filter(m => m.release).map(m => m.skuId), ["3"]);
assert.deepEqual(plan.unknown.map(u => u.skuId), ["5"]);
console.log("PASS 창고재확인 정리: 확인중 유지, 거래처단종→보관, 제품DB 이동(현재상태 비움·기존행 갱신), 불가→단종해제, 기타 유지");
