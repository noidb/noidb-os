import assert from "node:assert/strict";
import { isProductDbToStorageStatus, pickStorageTabTitle, planReregistrationTab, planWarehouseRecheckCleanup } from "../lib/wms/warehouse-recheck-cleanup";
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
assert.equal(pickStorageTabTitle(["제품DB", "_백업_비관리SKU_x", "비관리SKU", "_보관_비관리SKU_20261008"]), "비관리SKU");
assert.equal(pickStorageTabTitle(["제품DB", "_백업_비관리SKU_x"]), null);
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

// 2026-10-22 재등록SKU 탭에 있는 옛 SKU는 현재상태와 상관없이 제품DB에서 지움(이미 탭에 있음), 보관의 재고있음이라도 제품DB로 되돌리지 않음
{
  const pdH = ["현재상태", "SKU ID", "상품명", "발주가능상태"];
  const stH = ["현재상태", "SKU ID", "상품명", "발주가능상태", "보관사유"];
  const pd = [pdH, ["과재고", "111", "옛반지", "일시중단"], ["", "222", "그대로", "정상"]];
  const st = [stH, ["재고있음", "333", "재등록옛", "불가", ""]];
  const plan = planWarehouseRecheckCleanup([], pd, st, new Set(["111", "333"]));
  if (plan.deleteProductDbRows.join() !== "2") throw new Error("재등록SKU 행을 제품DB에서 지우지 않음");
  if (plan.appendStorage.length || plan.appendRereg.length || plan.moves[0]?.target !== "재등록SKU" || plan.moves[0]?.mode !== "delete-only") throw new Error("이미 재등록SKU에 있으면 제품DB에서만 지워야 함");
  if (plan.deleteStorageRows.join() !== "2" || plan.appendProductDb.length) throw new Error("재등록 SKU는 제품DB로 되돌리지 않고 보관에서 지워야 함");
  console.log("reregistered → storage OK");
}

// 2026-10-22 현재상태에 '재등록'이 들어간 제품DB 행 → 재등록SKU 탭에 한 줄, 보관으로는 안 감
{
  const pdH = ["현재상태", "모델명/품번", "모델SKU", "SKU ID", "이미지", "상품명", "제품링크"];
  const stH = ["현재상태", "SKU ID", "상품명", "보관사유"];
  const rrH = ["SKU ID", "모델명/품번", "모델SKU", "기존 현재상태", "기록일", "진행상태", "새 SKU ID", "완료일", "이미지", "상품명", "제품링크"];
  const pd = [pdH, ["재등록/소재수정후", "wr1", "wr1S", "501", "=IMAGE(\"u\",4,80,80)", "반지", "http://x"], ["소재수정후 재등록", "wr2", "wr2S", "502", "", "반지2", ""], ["과재고", "a", "b", "503", "", "그대로", ""]];
  const plan = planWarehouseRecheckCleanup([], pd, [stH], new Set(["502"]), rrH, "2026-10-22");
  if (plan.deleteProductDbRows.join() !== "2,3") throw new Error("재등록 행 제품DB에서 지우기 실패");
  if (plan.appendRereg.length !== 1 || plan.appendRereg[0].join("|") !== "501|wr1|wr1S|재등록/소재수정후|2026-10-22|대기|||=IMAGE(\"u\",4,80,80)|반지|http://x") throw new Error("재등록SKU 줄 실패: " + JSON.stringify(plan.appendRereg));
  if (plan.appendStorage.length) throw new Error("재등록 대상은 보관으로 가면 안 됨");
  if (plan.moves.map(m => m.target).join() !== "재등록SKU,재등록SKU") throw new Error("옮길 곳 실패");
  console.log("재등록 키워드 → 재등록SKU+보관 OK");
}

// 2026-10-22 보관 탭에 있는 재등록SKU 탭 SKU는 보관에서 지움(중복 방지)
{
  const pdH = ["현재상태", "SKU ID", "상품명"];
  const stH = ["현재상태", "SKU ID", "상품명", "보관사유"];
  const plan = planWarehouseRecheckCleanup([], [pdH], [stH, ["과재고", "900", "옛것", "재등록SKU(과재고)"], ["단종", "901", "그대로", "단종"]], new Set(["900"]));
  if (plan.deleteStorageRows.join() !== "2" || plan.moves[0]?.target !== "재등록SKU" || plan.appendProductDb.length) throw new Error("보관 중복 정리 실패");
  console.log("보관 재등록 중복 정리 OK");
}

// 2026-10-22 한 SKU는 한 탭에만: 비관리SKU 안 중복은 아래 줄 지움, 제품DB에도 있으면(제품DB가 단종·비관리·재등록이 아니면) 비관리SKU에서 지움
{
  const pdH = ["현재상태", "SKU ID", "상품명"];
  const stH = ["현재상태", "SKU ID", "상품명", "보관사유"];
  const pd = [pdH, ["과재고", "700", "제품DB에있음"], ["단종", "701", "단종으로적음"]];
  const st = [stH, ["단종", "700", "중복1", ""], ["단종", "701", "중복2", ""], ["단종", "702", "같은거", ""], ["단종", "702", "같은거", ""]];
  const plan = planWarehouseRecheckCleanup([], pd, st, new Set());
  if (plan.deleteStorageRows.join() !== "2,5") throw new Error("비관리 중복 정리 실패: " + plan.deleteStorageRows.join());
  if (plan.deleteProductDbRows.join() !== "3" || plan.appendStorage.length) throw new Error("제품DB 단종 줄은 비관리SKU에 이미 있어 제품DB에서만 지움");
  console.log("한 SKU 한 탭 OK");
}

// 2026-10-22 재등록SKU 탭 형식 맞추기 → 그다음 단종·중복등록 줄은 비관리SKU로
{
  const pdH = ["현재상태", "모델명/품번", "모델SKU", "SKU ID", "이미지", "상품명", "색상", "원가", "발주가능상태"];
  const stH = [...pdH, "보관사유"];
  const pd = [pdH, ["", "we1", "we1RG", "900", "=IMAGE(\"n\")", "귀걸이, 로즈골드", "로즈골드", "100", "정상"], ["", "ws1", "ws1BB10", "910", "", "피어싱, 블랙10mm", "블랙10mm", "50", "정상"]];
  const st = [stH, ["과재고", "we1", "we1RG", "800", "=IMAGE(\"o\")", "귀걸이, 로즈골드", "로즈골드", "90", "일시중단", "재등록SKU(과재고)"]];
  const oldRr = [["SKU ID", "모델명/품번", "모델SKU", "기존 현재상태", "기록일", "진행상태", "새 SKU ID", "완료일", "이미지", "상품명", "제품링크"], ["800", "we1", "we1RG", "과재고", "2026-10-08", "대기"], ["801", "wx", "wxS", "", "2026-10-08", "대기"]];
  const plan = planWarehouseRecheckCleanup([], pd, st, new Set(["800", "801"]), oldRr[0], "2026-10-22", oldRr);
  if (!plan.reregRebuild || plan.moves.some(m => m.mode !== "fill")) throw new Error("먼저 형식 맞추기만 해야 함");
  const h = plan.reregRebuild.headers;
  if (h.slice(0, pdH.length).join() !== pdH.join() || !h.includes("진행상태") || !h.includes("제품링크")) throw new Error("제목줄 실패: " + h.join());
  const r800 = plan.reregRebuild.rows[0];
  if (r800[h.indexOf("원가")] !== "90" || r800[h.indexOf("이미지")] !== "=IMAGE(\"o\")" || r800[h.indexOf("기록일")] !== "2026-10-08") throw new Error("정보 채우기 실패: " + r800.join("|"));
  if (plan.reregRebuild.filled !== 1) throw new Error("채운 줄 수");
  // 2단계: 새 형식. 800은 같은 모델SKU의 정상 SKU 900 → 중복등록, 802는 현재상태 거래처단종 → 비관리, 803은 그대로
  const newRr = [h, ...[["800", "we1RG", "we1", "과재고"], ["802", "zz1", "zz", "거래처단종"], ["803", "qq1", "qq", "과재고"]].map(([sku, msku, model, status]) => h.map(col => col === "SKU ID" ? sku : col === "모델SKU" ? msku : col === "모델명/품번" ? model : col === "현재상태" ? status : col === "진행상태" ? "대기" : ""))];
  const plan2 = planWarehouseRecheckCleanup([], pd, st, new Set(["800", "802", "803"]), h, "2026-10-22", newRr);
  if (plan2.deleteReregRows.join() !== "2,3") throw new Error("재등록SKU에서 뺄 줄 실패: " + plan2.deleteReregRows.join());
  const reasons = plan2.appendStorage.map(row => row[row.length - 1] + "/" + row[0]).join();
  if (reasons !== "재등록완료(새 SKU 900)/비관리(중복등록),거래처단종/거래처단종") throw new Error("비관리로 옮김 실패: " + reasons);
  if (plan2.deleteStorageRows.join() !== "2") throw new Error("예전 비관리 줄(800)은 새 줄로 바꿔야 함");
  console.log("재등록SKU 형식 맞추기·단종/중복 비관리 OK");
}

// 2026-10-22 모델SKU가 같아도 옵션이 다르면(1P ↔ 한쌍) 같은 제품이 아님 → 재등록SKU에 남김
{
  const H = ["현재상태", "모델명/품번", "모델SKU", "SKU ID", "상품명", "색상", "발주가능상태", "기존 현재상태", "기록일", "진행상태", "새 SKU ID", "완료일"];
  const pdH = ["현재상태", "모델명/품번", "모델SKU", "SKU ID", "상품명", "색상", "발주가능상태"];
  const pd = [pdH, ["", "mp1", "mp1RG", "200", "십자가, 로즈골드한쌍", "로즈골드한쌍", "정상"], ["", "we1", "we1RG", "201", "귀걸이, 로즈골드", "로즈골드", "정상"]];
  const rr = [H, ["", "mp1", "mp1RG", "100", "십자가, 로즈골드 1P", "로즈골드 1P", "일시중단", "", "", "대기", "", ""], ["", "we1", "we1RG", "101", "귀걸이, 로즈골드", "로즈골드", "일시중단", "", "", "대기", "", ""]];
  const p = planReregistrationTab(rr, pd, null);
  if ([...p.keepIds].join() !== "100" || p.leaving.map(l => l.skuId).join() !== "101") throw new Error("옵션 다른 짝 실패: " + [...p.keepIds].join() + " / " + p.leaving.map(l => l.skuId).join());
  console.log("옵션 다르면 짝 아님 OK");
}

// 2026-10-22 비관리SKU에서 현재상태 '재등록대상' → 재등록SKU(재등록완료는 그대로)
{
  const stH = ["현재상태", "모델SKU", "SKU ID", "상품명", "보관사유"];
  const rrH = ["현재상태", "모델SKU", "SKU ID", "상품명", "기존 현재상태", "기록일", "진행상태"];
  const plan = planWarehouseRecheckCleanup([], [["현재상태", "SKU ID"]], [stH, ["재등록대상", "mp1RG", "100", "십자가 1P", "x"], ["재등록완료", "y", "101", "옛", ""]], new Set(), rrH, "2026-10-22", [rrH]);
  if (plan.deleteStorageRows.join() !== "2" || plan.appendRereg.length !== 1 || plan.appendRereg[0].join("|") !== "|mp1RG|100|십자가 1P||2026-10-22|대기") throw new Error("비관리→재등록 실패: " + JSON.stringify(plan.appendRereg) + plan.deleteStorageRows.join());
  console.log("비관리 재등록대상 → 재등록SKU OK");
}

// ★2026-10-22 절대 규칙: 판매중지·실적저조·교체된 옛 SKU는 '재고있음'이어도 제품DB로 안 감 → 재등록SKU
{
  const stH = ["현재상태", "SKU ID", "상품명", "발주가능상태", "보관사유"];
  const pdH = ["현재상태", "SKU ID", "상품명", "발주가능상태"];
  const rrH = ["현재상태", "SKU ID", "상품명", "발주가능상태", "보관사유", "기존 현재상태", "기록일", "진행상태"];
  const st = [stH, ["재고있음", "300", "판매중지품", "불가", "판매중지"], ["재고있음", "301", "실적저조품", "불가", "실적저조 강제중단"], ["재고있음", "302", "옛 SKU", "정상", ""], ["재고있음", "303", "보통", "불가", "단종"]];
  const pd = [pdH, ["", "302", "옛 SKU", "정상"]];
  const recheck = [["SKU ID", "상품명", "창고 확인결과", "발주가능상태"], ["304", "링크죽음", "재고있음(판매중지)", "불가"]];
  const plan = planWarehouseRecheckCleanup(recheck, pd, st, new Set(), rrH, "2026-10-22", [rrH], new Set(["302"]));
  const toPd = [...plan.appendProductDb.map(row => row[1]), ...plan.clearStatusRows.map(String)];
  if (toPd.join() !== "303") throw new Error("제품DB로 가면 안 되는 SKU가 감: " + toPd.join());
  const rr = plan.appendRereg.map(row => row[1]).sort().join();
  if (rr !== "300,301,302,304") throw new Error("재등록SKU로 못 감: " + rr);
  if (plan.appendRereg.find(row => row[1] === "300")![0] !== "재고있음") throw new Error("현재상태 재고있음 메모는 그대로 둬야 함");
  if (!plan.deleteProductDbRows.includes(2)) throw new Error("제품DB에 있던 옛 SKU 302는 제품DB에서도 지워야 함");
  if (plan.moves.some(move => move.release && ["300", "301", "302", "304"].includes(move.skuId))) throw new Error("단종해제 대상에 넣으면 안 됨");
  console.log("판매중지·실적저조·옛 SKU 제품DB 차단 OK");
}
