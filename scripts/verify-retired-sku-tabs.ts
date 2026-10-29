import assert from "node:assert/strict";
import { planWarehouseRecheckCleanup } from "../lib/wms/warehouse-recheck-cleanup";
import { LOW_PERFORMANCE_SKU_IDS, pickLowPerformanceTab } from "../lib/wms/retired-sku-tabs";
import { buildStatusLists } from "../lib/wms/discontinue-lists";
import { applySameModelFill, planSameModelFill } from "../lib/wms/same-model-fill";

// 2026-10-22 탭 나눔: 실적저조SKU(예전 재등록SKU) · 그 외 재등록SKU · 판매중지SKU
assert.equal(pickLowPerformanceTab(["제품DB", "재등록SKU"]), "재등록SKU");
assert.equal(pickLowPerformanceTab(["제품DB", "실적저조SKU", "재등록SKU"]), "실적저조SKU");
assert.equal(LOW_PERFORMANCE_SKU_IDS.size, 62);
assert.ok(!LOW_PERFORMANCE_SKU_IDS.has("43095733"), "쿠팡이 풀어 준 SKU는 목록에서 뺀다");
assert.ok(LOW_PERFORMANCE_SKU_IDS.has("41093260"));
const low = "41093260"; // 실적저조 목록에 있는 SKU

const H = ["현재상태", "모델명/품번", "SKU ID", "상품명", "발주가능상태"];
const RR = [...H, "기존 현재상태", "기록일", "진행상태", "새 SKU ID", "완료일"];
const productDb = [H,
  ["판매중지", "m1", "100", "판매중지 상품", "불가"],     // → 판매중지SKU
  ["", "m2", "101", "판매중지 탭에 이미 있음", "불가"],    // 탭에 있음 → 제품DB에서만 지움
  ["재등록/소재수정후", "m3", "102", "그 외 재등록", "일시중단"], // 실적저조 아님 → 그 외 재등록SKU
  ["", "m4", low, "실적저조 목록", "일시중단"],             // 실적저조 목록 → 실적저조SKU
  ["과재고", "m5", "104", "그대로", "정상"]];
const storage = [["현재상태", "SKU ID", "상품명", "발주가능상태"],
  ["재고있음", "200", "판매중지 탭에 있는데 재고있음", "불가"],
  ["재등록대상", "201", "실적저조 아닌 재등록대상", "일시중단"],
  ["재고있음", "202", "정상 이동", "불가"]];
const rereg = [RR];
const other = [RR];
const stopped = [H, ["판매중지", "m2", "101", "판매중지 탭에 이미 있음", "불가"], ["판매중지", "m6", "200", "판매중지 탭에 있는데 재고있음", "불가"]];
const plan = planWarehouseRecheckCleanup([], productDb, storage, new Set(), RR, "2026-10-22", rereg, new Set(), { other, stopped });
assert.deepEqual(plan.problems, []);
const move = (sku: string, source?: string) => plan.moves.find(m => m.skuId === sku && (!source || m.source === source));
assert.equal(move("100")?.target, "판매중지SKU"); assert.equal(move("100")?.mode, "append");
assert.equal(move("101")?.target, "판매중지SKU"); assert.equal(move("101")?.mode, "delete-only");
assert.equal(move("102")?.target, "그 외 재등록SKU");
assert.equal(move(low)?.target, "재등록SKU", "실적저조 목록 SKU는 실적저조SKU(코드 이름 재등록SKU)로");
assert.equal(move("104"), undefined);
assert.deepEqual(plan.deleteProductDbRows, [2, 3, 4, 5]);
assert.equal(plan.appendStopped.length, 1);
assert.equal(plan.appendOtherRereg.length, 2, "제품DB 102 + 비관리 201");
assert.equal(plan.appendRereg.length, 1);
// 비관리: 판매중지 탭에 있는 SKU는 재고있음이어도 제품DB로 가지 않고 비관리에서만 지움
assert.equal(move("200", "보관")?.target, "판매중지SKU"); assert.equal(move("200", "보관")?.mode, "delete-only");
assert.equal(move("201", "보관")?.target, "그 외 재등록SKU");
assert.equal(move("202", "보관")?.target, "제품DB");
assert.ok(!plan.appendProductDb.some(row => row.includes("200")));
console.log("PASS 옛 SKU 탭 나눔: 판매중지→판매중지SKU, 실적저조 목록→실적저조SKU, 그 외 재등록→그 외 재등록SKU, 탭에 있으면 제품DB로 안 감");

// 실적저조 목록 SKU는 비관리에서 '재고있음'이어도 제품DB로 가지 않는다
const plan2 = planWarehouseRecheckCleanup([], [H], [["현재상태", "SKU ID", "상품명"], ["재고있음", low, "실적저조"]], new Set(), RR, "2026-10-22", [RR], new Set(), { other, stopped });
assert.equal(plan2.moves[0]?.target, "재등록SKU");
assert.equal(plan2.appendProductDb.length, 0);
console.log("PASS 실적저조 목록 SKU 재고있음 → 실적저조SKU");

// 판매중지SKU 탭이 아직 없으면 판매중지 줄은 제품DB에 그대로(예전 방식)
const plan3 = planWarehouseRecheckCleanup([], [H, ["판매중지", "m1", "100", "판매중지", "불가"]], null, new Set(), RR, "2026-10-22", [RR]);
assert.deepEqual(plan3.problems, []); assert.equal(plan3.moves.length, 0);
console.log("PASS 판매중지SKU 탭 없으면 제품DB에 둠");

// 단종 대상: 판매중지SKU 탭의 '정상' SKU도 계속 단종 대상
const lists = buildStatusLists([{ skuId: "300", currentStatus: "판매중지", orderableStatus: "정상", productName: "a", optionLabel: "", reregistrationTier: "", sourceTab: "판매중지SKU" }], { memoReleaseSkuIds: [], memoDiscontinueSkuIds: [], reregisteredSkuIds: new Set(["300"]) });
assert.deepEqual(lists.discontinue.map(item => [item.skuId, item.reason]), [["300", "판매중지SKU"]]);
console.log("PASS 판매중지SKU 탭 정상 SKU → 단종 대상");

// 2026-10-23: 한 옵션이라도 판매중지면 같은 링크(노출상품ID) 옵션 전부 판매중지 → 제품DB·실적저조SKU에서 판매중지SKU로
{
  const L = (id: string) => `https://www.coupang.com/vp/products/${id}?itemId=1`;
  const HH = ["현재상태", "모델명/품번", "SKU ID", "상품명", "발주가능상태", "제품링크"];
  const RRH = [...HH, "기존 현재상태", "기록일", "진행상태", "새 SKU ID", "완료일"];
  const pdx = [HH, ["과재고", "m1", "500", "같은 링크 과재고", "정상", L("777")], ["", "m1", "501", "다른 링크", "정상", L("888")], ["재등록파일생성", "m1", "", "새 줄", "", ""]];
  const stoppedx = [HH, ["판매중지", "m1", "502", "죽은 링크", "불가", L("777")]];
  const rrx = [RRH, ["재고있음", "m2", "503", "실적저조 같은 링크", "일시중단", L("777"), "", "", "대기", "", ""], ["판매중지", "m3", "504", "실적저조 판매중지", "", "", "", "", "대기", "", ""], ["과재고", "m4", "505", "실적저조 그대로", "일시중단", L("999"), "", "", "대기", "", ""]];
  const p = planWarehouseRecheckCleanup([], pdx, null, new Set(), RRH, "2026-10-23", rrx, new Set(), { other: [RRH], stopped: stoppedx });
  assert.deepEqual(p.problems, []);
  const m = (sku: string) => p.moves.find(x => x.skuId === sku);
  assert.equal(m("500")?.target, "판매중지SKU");
  assert.deepEqual(p.appendStopped.find(row => row[2] === "500")?.[0], "판매중지(과재고)");
  assert.equal(m("501"), undefined, "다른 링크는 제품DB에 둠");
  assert.equal(m("503")?.target, "판매중지SKU");
  assert.equal(m("504")?.target, "판매중지SKU");
  assert.equal(m("505"), undefined);
  assert.deepEqual(p.deleteReregRows.sort(), [2, 3]);
  assert.deepEqual(p.deleteProductDbRows, [2], "재등록파일생성 새 줄은 그대로");
  console.log("PASS 같은 링크 옵션 → 판매중지SKU (제품DB·실적저조SKU)");
}

// 2026-10-29: 실적저조SKU 탭 현재상태 '정상복귀' → 제품DB로(옛 정보 그대로, 현재상태 '정상'), 탭에서 지움
{
  const rrx = [RR, ["정상복귀", "m1", "43095733", "쿠팡이 푼 상품", "정상", "", "", "대기", "", ""], ["과재고", "m2", "700", "그대로 실적저조", "일시중단", "", "", "대기", "", ""]];
  const p = planWarehouseRecheckCleanup([], [H, ["", "m9", "800", "다른 상품", "정상"]], null, new Set(), RR, "2026-10-29", rrx, new Set(), { other: [RR], stopped });
  assert.deepEqual(p.problems, []);
  const m = p.moves.find(x => x.skuId === "43095733");
  assert.equal(m?.target, "제품DB"); assert.equal(m?.mode, "append"); assert.equal(m?.release, false);
  assert.deepEqual(p.deleteReregRows, [2]);
  assert.equal(p.appendProductDb.length, 1);
  assert.deepEqual([p.appendProductDb[0][0], p.appendProductDb[0][2], p.appendProductDb[0][4]], ["정상", "43095733", "정상"]);
  assert.equal(p.moves.find(x => x.skuId === "700"), undefined, "정상복귀가 아닌 줄은 그대로");
  // 한 번 옮긴 뒤 다시 돌려도 실적저조SKU로 끌려가지 않는다
  const again = planWarehouseRecheckCleanup([], [H, ["정상", "m1", "43095733", "쿠팡이 푼 상품", "정상"]], null, new Set(), RR, "2026-10-29", [RR], new Set(), { other: [RR], stopped });
  assert.equal(again.moves.length, 0);
  console.log("PASS 정상복귀 → 제품DB(재등록 목록에서 지움, 다시 끌려가지 않음)");
}

// 2026-10-23: 단종해제 대상에는 판매중지·실적저조 둘 다 아닌 SKU만 (화면에서 고른 것도 뺌)
{
  const link = (id: string) => `https://www.coupang.com/vp/products/${id}?itemId=1`;
  const base = { optionLabel: "", reregistrationTier: "" };
  const items = [
    { ...base, skuId: "900", currentStatus: "과재고", orderableStatus: "일시중단", productName: "정상 해제 대상", productLink: link("1") },
    { ...base, skuId: "901", currentStatus: "과재고", orderableStatus: "일시중단", productName: "판매중지 링크와 같은 링크", productLink: link("2") },
    { ...base, skuId: "902", currentStatus: "판매중지", orderableStatus: "불가", productName: "판매중지", productLink: link("2"), sourceTab: "판매중지SKU" },
    { ...base, skuId: "41093260", currentStatus: "재고있음", orderableStatus: "일시중단", productName: "실적저조 목록", storageTab: true },
  ];
  const lists = buildStatusLists(items, { memoReleaseSkuIds: [], memoDiscontinueSkuIds: [], releaseFromScreen: { "902": { productName: "판매중지" }, "41093260": { productName: "실적저조", manual: true } } });
  assert.deepEqual(lists.release.map(item => item.skuId), ["900"]);
  assert.deepEqual(lists.discontinue.map(item => item.skuId), [], "새 제외 규칙이 단종 대상에 끼어들지 않음");
  console.log("PASS 단종해제 대상: 판매중지·같은 링크·실적저조 목록은 화면에서 골라도 뺌");
}

// 2026-10-23: 단종 대상 = 옛 SKU 탭(판매중지·실적저조·그 외 재등록·비관리(재고있음 제외))에서 아직 정상인 SKU 전부
{
  const base = { optionLabel: "", reregistrationTier: "", productName: "x", orderableStatus: "정상" };
  const lists = buildStatusLists([
    { ...base, skuId: "1", currentStatus: "재고있음", sourceTab: "판매중지SKU" },
    { ...base, skuId: "2", currentStatus: "과재고", sourceTab: "실적저조SKU" },
    { ...base, skuId: "3", currentStatus: "재등록대상", sourceTab: "그 외 재등록SKU" },
    { ...base, skuId: "4", currentStatus: "거래처단종", storageTab: true },
    { ...base, skuId: "5", currentStatus: "재고있음", storageTab: true },
    { ...base, skuId: "6", currentStatus: "과재고" },
    { ...base, skuId: "7", currentStatus: "단종" },
    { ...base, skuId: "8", currentStatus: "과재고", sourceTab: "실적저조SKU", orderableStatus: "일시중단" },
  ], { memoReleaseSkuIds: [], memoDiscontinueSkuIds: [], cleared: { discontinue: { [JSON.stringify(["2", "과재고", "정상", "실적저조SKU"])]: "2026-10-22" } } });
  assert.deepEqual(lists.discontinue.map(item => [item.skuId, item.reason]), [["1", "판매중지SKU"], ["2", "실적저조SKU"], ["3", "그 외 재등록SKU"], ["4", "비관리SKU"], ["7", "제품DB"]]);
  console.log("PASS 단종 대상: 옛 SKU 탭의 정상 SKU 전부(비관리 재고있음·제품DB 정상 판매 제외)");
}

// 2026-10-23: 같은 모델 빈 원가·치수 채우기
{
  const H = ["모델명/품번", "SKU ID", "치수", "원가(부가세포함)"];
  const tabs = [
    { title: "제품DB", rows: [H, ["We001", "1", "3cm", "2,750"], ["we001", "2", "", ""], ["we002", "3", "", "=A1"], ["we003", "4", "", "1,100"]] },
    { title: "비관리SKU", rows: [H, [" we001 ", "5", "", "2090"], ["we003", "6", "1cm", ""], ["we004", "7", "", ""]] },
  ];
  const plan = planSameModelFill(tabs);
  const cell = (title: string, row: number, field: string) => plan.updates.find(u => u.title === title && u.row === row && u.field === field)?.value;
  assert.equal(cell("제품DB", 3, "원가(부가세포함)"), undefined, "값이 여러 가지(2,750/2090)면 채우지 않음");
  assert.equal(cell("제품DB", 3, "치수"), "3cm");
  assert.equal(cell("비관리SKU", 2, "치수"), "3cm");
  assert.equal(cell("비관리SKU", 2, "원가(부가세포함)"), undefined, "값이 있는 칸은 그대로");
  assert.equal(cell("제품DB", 5, "치수"), "1cm", "다른 탭 값으로 채움");
  assert.equal(cell("비관리SKU", 3, "원가(부가세포함)"), "1100");
  assert.equal(cell("제품DB", 4, "치수"), undefined, "같은 모델에 값이 없으면 그대로");
  assert.equal(plan.updates.some(u => u.title === "비관리SKU" && u.row === 4), false);
  assert.deepEqual(plan.conflicts.map(c => [c.model, c.field]), [["we001", "원가(부가세포함)"]]);
  applySameModelFill(tabs, plan);
  assert.equal(tabs[0].rows[2][2], "3cm", "대소문자·공백 무시하고 같은 모델");
  console.log("PASS 같은 모델 빈 원가·치수 채우기(전 탭, 있는 값은 그대로)");
}

// 2026-10-23: 제품DB 같은 모델 줄 붙이기
{
  const { planModelRegroup } = require("../lib/wms/model-regroup") as typeof import("../lib/wms/model-regroup");
  const rows = [["모델명/품번"], ["a"], ["B"], ["a "], ["c"], ["b"], [""], ["a"]];
  const { moves } = planModelRegroup(rows);
  const order = rows.map((_, i) => i);
  for (const m of moves) { const block = order.splice(m.startIndex, m.endIndex - m.startIndex); order.splice(m.destinationIndex, 0, ...block); }
  assert.deepEqual(order.slice(1).map(i => String(rows[i][0]).trim().toLowerCase()), ["a", "a", "a", "b", "b", "c", ""]);
  assert.deepEqual(planModelRegroup([["모델명/품번"], ["a"], ["a"], ["b"]]).moves, []);
  console.log("PASS 같은 모델 줄 붙이기(처음 나오는 자리로, 나머지 순서 유지)");
}

// 2026-10-23: 세트 구성 줄은 세트 줄 바로 아래
{
  const { planModelRegroup } = require("../lib/wms/model-regroup") as typeof import("../lib/wms/model-regroup");
  const apply = (rows: string[][]) => {
    const order = rows.map((_, i) => i);
    for (const m of planModelRegroup(rows).moves) { const block = order.splice(m.startIndex, m.endIndex - m.startIndex); order.splice(m.destinationIndex, 0, ...block); }
    return order.slice(1).map(i => rows[i][1]);
  };
  const rows = [["모델명/품번", "모델SKU"], ["we00306", "we00306RG"], ["x", "x1"], ["wn00307", "wn00307RG"], ["wn00307", "wn00307RG\nwe00306RG"], ["x", "x2"], ["we00305", "we00305RG"]];
  const result = apply(rows);
  assert.deepEqual(result, ["x1", "x2", "wn00307RG\nwe00306RG", "wn00307RG", "we00306RG", "we00305RG"]);
  // 다시 정리해도 그대로(왔다 갔다 하지 않음)
  const again = [rows[0], ...result.map(sku => rows.find(r => r[1] === sku)!)];
  assert.deepEqual(planModelRegroup(again).moves, []);
  // 모델SKU 칸이 없으면 예전과 같다
  assert.deepEqual(planModelRegroup([["모델명/품번"], ["a"], ["a"], ["b"]]).moves, []);
  console.log("PASS 세트 구성 줄을 세트 줄 바로 아래로");
}
