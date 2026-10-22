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
assert.ok(isProductDbToStorageStatus("단종(중복등록)") && isProductDbToStorageStatus("거래처 단종") && !isProductDbToStorageStatus("단종해제") && isProductDbToStorageStatus("비관리 (중복등록)") && !isProductDbToStorageStatus("판매중지") && !isProductDbToStorageStatus("가품중단"));
assert.equal(pickStorageTabTitle(["제품DB", "보관", "_백업__보관_비관리SKU_20261008_x", "_보관_비관리SKU_20261008"]), "_보관_비관리SKU_20261008");
assert.equal(pickStorageTabTitle(["제품DB", "_백업__보관_비관리SKU_20261008_x"]), null);
console.log("PASS 제품DB 비관리·거래처단종·단종 → 보관(_보관_비관리SKU_20261008)");
console.log("PASS 창고재확인 정리: 확인중 유지, 거래처단종→보관, 제품DB 이동(현재상태 비움·기존행 갱신), 불가→단종해제, 기타 유지");

// 중간 실패 뒤 다시 실행(2026-10-20): 보관 탭에 이미 들어간 거래처단종은 다시 붙이지 않고 창고재확인에서만 지움
const recheck3 = [["SKU ID", "상품명", "창고 확인결과"], ["20", "가", "거래처단종"], ["21", "나", "거래처단종"]];
const st3 = [["SKU ID", "상품명", "현재상태"], ["20", "가", "거래처단종"]];
const plan3 = planWarehouseRecheckCleanup(recheck3, [["SKU ID", "현재상태"]], st3);
assert.deepEqual(plan3.appendStorage, [["21", "나", "거래처단종"]]);
assert.deepEqual(plan3.deleteRows, [2, 3]);
assert.equal(plan3.moves.find(m => m.skuId === "20")?.mode, "delete-only");
console.log("rerun ok");

// 2026-10-21: 보관 탭 현재상태 '재고있음'만 적어도 제품DB로
{
  const pd = [["현재상태", "SKU ID", "상품명", "발주가능상태"]];
  const st = [["현재상태", "SKU ID", "상품명", "발주가능상태"], ["재고있음", "9001", "a", "불가"], ["거래처단종", "9002", "b", "불가"]];
  const plan = planWarehouseRecheckCleanup([], pd, st);
  assert.deepEqual(plan.moves.map(m => [m.skuId, m.target, m.result]), [["9001", "제품DB", "재고있음"]]);
  console.log("PASS 보관 '재고있음' → 제품DB");
}

// 2026-10-22 재등록SKU 탭에 있는 옛 SKU는 현재상태와 상관없이 제품DB → 보관, 보관의 재고있음이라도 제품DB로 되돌리지 않음
{
  const pdH = ["현재상태", "SKU ID", "상품명", "발주가능상태"];
  const stH = ["현재상태", "SKU ID", "상품명", "발주가능상태", "보관사유"];
  const pd = [pdH, ["과재고", "111", "옛반지", "일시중단"], ["", "222", "그대로", "정상"]];
  const st = [stH, ["재고있음", "333", "재등록옛", "불가", ""]];
  const plan = planWarehouseRecheckCleanup([], pd, st, new Set(["111", "333"]));
  if (plan.deleteProductDbRows.join() !== "2") throw new Error("재등록SKU 행을 보관으로 옮기지 않음");
  if (plan.appendStorage[0]?.[4] !== "재등록SKU(과재고)") throw new Error("보관사유 실패");
  if (plan.deleteStorageRows.length || plan.appendProductDb.length) throw new Error("재등록 SKU가 제품DB로 되돌아감");
  console.log("reregistered → storage OK");
}

// 2026-10-22 현재상태에 '재등록'이 들어간 제품DB 행 → 재등록SKU 탭에 한 줄 + 보관으로
{
  const pdH = ["현재상태", "모델명/품번", "모델SKU", "SKU ID", "이미지", "상품명", "제품링크"];
  const stH = ["현재상태", "SKU ID", "상품명", "보관사유"];
  const rrH = ["SKU ID", "모델명/품번", "모델SKU", "기존 현재상태", "기록일", "진행상태", "새 SKU ID", "완료일", "이미지", "상품명", "제품링크"];
  const pd = [pdH, ["재등록/소재수정후", "wr1", "wr1S", "501", "=IMAGE(\"u\",4,80,80)", "반지", "http://x"], ["소재수정후 재등록", "wr2", "wr2S", "502", "", "반지2", ""], ["과재고", "a", "b", "503", "", "그대로", ""]];
  const plan = planWarehouseRecheckCleanup([], pd, [stH], new Set(["502"]), rrH, "2026-10-22");
  if (plan.deleteProductDbRows.join() !== "2,3") throw new Error("재등록 행 제품DB에서 지우기 실패");
  if (plan.appendRereg.length !== 1 || plan.appendRereg[0].join("|") !== "501|wr1|wr1S|재등록/소재수정후|2026-10-22|대기|||=IMAGE(\"u\",4,80,80)|반지|http://x") throw new Error("재등록SKU 줄 실패: " + JSON.stringify(plan.appendRereg));
  if (plan.appendStorage.map(r => r[3]).join() !== "재등록SKU(재등록/소재수정후),재등록SKU(소재수정후 재등록)") throw new Error("보관사유 실패");
  console.log("재등록 키워드 → 재등록SKU+보관 OK");
}
