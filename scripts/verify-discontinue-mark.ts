import assert from "node:assert/strict";
import { planDiscontinueMark } from "../lib/wms/discontinue-mark-product-db";
import { buildStatusLists } from "../lib/wms/discontinue-lists";

const rows = [["모델명", "SKU ID", "현재상태"], ["a", "100", ""], ["b", "101", "판매중지"], ["c", "102", "거래처단종"], ["d", "103", "과재고"], ["e", "100", ""], ["f", "104", "단종"]];
const plan = planDiscontinueMark(rows, ["100", "101", "102", "103", "104", "999", " 100 "]);
assert.deepEqual(plan.updates, [{ row: 2, col: 3, value: "거래처단종" }, { row: 6, col: 3, value: "거래처단종" }, { row: 5, col: 3, value: "거래처단종" }], "빈칸·과재고는 거래처단종, 같은 SKU 행 모두");
assert.deepEqual(plan.marked, ["100", "103"]);
assert.deepEqual(plan.kept, [{ skuId: "101", status: "판매중지" }], "판매중지는 그대로");
assert.deepEqual(plan.notInDb, ["999"]);
assert(planDiscontinueMark([["SKU ID"]], ["1"]).problem, "현재상태 열 없음");

// 처리완료한 단종 SKU는 현재상태가 거래처단종으로 바뀌어도 다시 나오지 않는다.
const item = (skuId: string, currentStatus: string, orderableStatus: string) => ({ skuId, currentStatus, orderableStatus, productName: "x", optionLabel: "" }) as never;
const before = buildStatusLists([item("1", "판매중지", "정상")], { memoReleaseSkuIds: [], memoDiscontinueSkuIds: [] });
const cleared = { discontinue: { [before.discontinue[0].key]: "t" } };
assert.equal(buildStatusLists([item("1", "거래처단종", "정상")], { memoReleaseSkuIds: [], memoDiscontinueSkuIds: [], cleared }).discontinue.length, 0);
assert.equal(buildStatusLists([item("1", "거래처단종", "불가")], { memoReleaseSkuIds: [], memoDiscontinueSkuIds: ["1"], cleared }).discontinue.length, 0, "불가면 원래 대상 아님");
const memo = buildStatusLists([item("2", "", "정상")], { memoReleaseSkuIds: [], memoDiscontinueSkuIds: ["2"] });
assert.equal(buildStatusLists([item("2", "거래처단종", "정상")], { memoReleaseSkuIds: [], memoDiscontinueSkuIds: ["2"], cleared: { discontinue: { [memo.discontinue[0].key]: "t" } } }).discontinue.length, 0, "메모 단종도 거래처단종으로 바뀐 뒤 다시 안 나옴");
console.log("PASS discontinue mark plan + cleared key");

// 처리한 SKU는 발주가능상태·이름·탭이 바뀌어도 다시 안 나옴(2026-10-19)
const d1 = buildStatusLists([item("30", "거래처단종", "정상")], { memoReleaseSkuIds: [], memoDiscontinueSkuIds: [] });
const d1Cleared = { discontinue: { [d1.discontinue[0].key]: "2026-10-01T00:00:00Z" } };
assert.equal(buildStatusLists([{ ...(item("30", "단종", "정상") as object), productName: "다른 이름" } as never], { memoReleaseSkuIds: [], memoDiscontinueSkuIds: ["30"], cleared: d1Cleared }).discontinue.length, 0, "단종 처리한 SKU 다시 안 나옴");
const r1 = buildStatusLists([item("40", "과재고", "불가")], { memoReleaseSkuIds: [], memoDiscontinueSkuIds: [] });
const r1Cleared = { release: { [r1.release[0].key]: "2026-10-01T00:00:00Z" } };
assert.equal(buildStatusLists([item("40", "제품DB로 이동(재고있음)", "일시중단")], { memoReleaseSkuIds: ["40"], memoDiscontinueSkuIds: [], cleared: r1Cleared }).release.length, 0, "단종해제 처리한 SKU 다시 안 나옴");
assert.equal(buildStatusLists([item("40", "과재고", "불가")], { memoReleaseSkuIds: [], memoDiscontinueSkuIds: [], cleared: r1Cleared, releaseFromScreen: { "40": { productName: "x", at: "2026-09-01T00:00:00Z" } } }).release.length, 0, "비우기 전 화면 선택은 숨김");
assert.equal(buildStatusLists([item("41", "", "불가")], { memoReleaseSkuIds: [], memoDiscontinueSkuIds: [], cleared: { release: { [JSON.stringify(["41", "입고결과"])]: "2026-10-01T00:00:00Z" } }, releaseFromScreen: { "41": { productName: "x", at: "2026-10-20T00:00:00Z" } } }).release.length, 1, "비운 뒤 화면에서 새로 단종해제 누르면 다시 보임");
console.log("PASS cleared SKUs stay hidden");
