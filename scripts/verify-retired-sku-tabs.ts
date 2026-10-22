import assert from "node:assert/strict";
import { planWarehouseRecheckCleanup } from "../lib/wms/warehouse-recheck-cleanup";
import { LOW_PERFORMANCE_SKU_IDS, pickLowPerformanceTab } from "../lib/wms/retired-sku-tabs";
import { buildStatusLists } from "../lib/wms/discontinue-lists";

// 2026-10-22 탭 나눔: 실적저조SKU(예전 재등록SKU) · 그 외 재등록SKU · 판매중지SKU
assert.equal(pickLowPerformanceTab(["제품DB", "재등록SKU"]), "재등록SKU");
assert.equal(pickLowPerformanceTab(["제품DB", "실적저조SKU", "재등록SKU"]), "실적저조SKU");
assert.equal(LOW_PERFORMANCE_SKU_IDS.size, 63);
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
