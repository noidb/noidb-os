import assert from "node:assert/strict";
import { isProductDbToStorageStatus, pickStorageTabTitle, planWarehouseRecheckCleanup } from "../lib/wms/warehouse-recheck-cleanup";
const recheck = [["SKU ID", "상품명", "현재상태", "발주가능상태", "창고 확인결과", "이미지"],
  ["1", "가", "창고재확인", "정상", "", "=IMAGE(\"a\")"],
  ["2", "나", "창고재확인", "불가", "거래처 단종", "=IMAGE(\"b\")"],
  ["3", "다", "창고재확인", "불가", "제품DB로 이동(재고있음)", "x"],
  ["4", "라", "창고재확인", "", "제품DB로 이동 (재고있음)", "y"],
  ["5", "마", "창고재확인", "정상", "기타메모", ""]];
const productDb = [["SKU ID", "상품명", "현재상태", "발주가능상태", "이미지"], ["4", "라", "창고재확인", "정상", "y"]];
const storage = [["SKU ID", "상품명", "현재상태", "이미지", "발주가능상태"], ["7", "사", "제품DB로 이동(재고있음)", "z", "불가"], ["8", "아", "거래처단종", "w", "정상"], ["4", "라", "제품DB로 이동 (재고있음)", "y", ""]];
const plan = planWarehouseRecheckCleanup(recheck, productDb, storage);
assert.deepEqual(plan.problems, []);
assert.equal(plan.pending, 1);
assert.deepEqual(plan.appendStorage, [["2", "나", "거래처단종", "=IMAGE(\"b\")", "불가"]]);
assert.deepEqual(plan.appendProductDb, [["3", "다", "", "불가", "x"], ["7", "사", "", "불가", "z"]]);
assert.deepEqual(plan.clearStatusRows, [2]);
assert.deepEqual(plan.deleteStorageRows, [2, 4], "보관 탭의 제품DB 이동 행만 지움, 거래처단종은 남김");
assert.deepEqual(plan.deleteRows, [3, 4, 5]);
assert.deepEqual(plan.moves.filter(m => m.release).map(m => m.skuId), ["3", "7"]);
assert.deepEqual(plan.unknown.map(u => u.skuId), ["5"]);
assert.deepEqual(plan.deleteProductDbRows, [], "제품DB 이동 행(현재상태만 비움)은 보관으로 보내지 않음");

// 제품DB → 보관(2026-10-19): 비관리(중복등록)·거래처단종·단종만, 판매중지·가품중단은 그대로
const pd2 = [["SKU ID", "상품명", "현재상태", "발주가능상태"], ["10", "가", "비관리(중복등록)", "정상"], ["11", "나", "판매중지", "정상"], ["12", "다", "거래처 단종", "불가"], ["13", "라", "단종", "정상"], ["14", "마", "가품중단", "정상"], ["15", "바", "", "정상"], ["8", "아", "단종", "정상"]];
const st2 = [["SKU ID", "상품명", "현재상태", "발주가능상태"], ["8", "아", "거래처단종", "정상"]];
const plan2 = planWarehouseRecheckCleanup([], pd2, st2);
assert.deepEqual(plan2.problems, []);
assert.deepEqual(plan2.deleteProductDbRows, [2, 4, 5, 8]);
assert.deepEqual(plan2.appendStorage, [["10", "가", "비관리(중복등록)", "정상"], ["12", "다", "거래처 단종", "불가"], ["13", "라", "단종", "정상"]], "보관에 이미 있는 SKU 8은 다시 붙이지 않음");
assert.equal(plan2.moves.find(m => m.skuId === "8")?.mode, "delete-only");
assert.ok(isProductDbToStorageStatus("비관리 (중복등록)") && !isProductDbToStorageStatus("판매중지") && !isProductDbToStorageStatus("가품중단"));
assert.equal(pickStorageTabTitle(["제품DB", "보관", "_백업__보관_비관리SKU_20261008_x", "_보관_비관리SKU_20261008"]), "_보관_비관리SKU_20261008");
assert.equal(pickStorageTabTitle(["제품DB", "_백업__보관_비관리SKU_20261008_x"]), null);
console.log("PASS 제품DB 비관리·거래처단종·단종 → 보관(_보관_비관리SKU_20261008)");
console.log("PASS 창고재확인 정리: 확인중 유지, 거래처단종→보관, 제품DB 이동(현재상태 비움·기존행 갱신), 불가→단종해제, 기타 유지");
