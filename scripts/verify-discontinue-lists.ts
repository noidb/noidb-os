import assert from "node:assert/strict";
import { buildStatusLists, lastClearedBatch } from "../lib/wms/discontinue-lists";
const item = (skuId: string, currentStatus: string, orderableStatus: string) => ({ skuId, currentStatus, orderableStatus, productName: `상품${skuId}`, optionLabel: "" }) as never;
const items = [item("1", "거래처단종", "정상"), item("2", "단종", "불가"), item("3", "판매중지", "정상"), item("4", "과재고", "일시중단"),
  item("5", "제품DB로 이동 (재고있음)", "불가"), item("6", "과재고", "정상"), item("7", "", "불가"), item("8", "가품중단", "정상")];
const lists = buildStatusLists(items, { memoReleaseSkuIds: ["7", "4", "99", "8"], memoDiscontinueSkuIds: [], releaseFromScreen: { "2": { productName: "x" } } });
assert.deepEqual(lists.discontinue.map(x => x.skuId), ["1", "3"], "단종 계열 + 정상, 메모로 해제 지정된 8은 단종에서 빠짐");
assert.deepEqual(lists.release.map(x => x.skuId), ["2", "4", "5", "7", "99"], "판매 계열 + 비정상, 메모·화면 해제, 중복 하나");
const cleared = buildStatusLists(items, { memoReleaseSkuIds: [], memoDiscontinueSkuIds: [], cleared: { discontinue: { [lists.discontinue[0].key]: "t" } } });
assert.deepEqual(cleared.discontinue.map(x => x.skuId), ["3", "8"]);
const rr = buildStatusLists([...items, { skuId: "10", currentStatus: "과재고", orderableStatus: "불가", productName: "x", optionLabel: "", reregistrationTier: "2차_판매량저조영구정지" } as never,
  { skuId: "11", currentStatus: "판매중지", orderableStatus: "정상", productName: "옛", optionLabel: "", reregistrationTier: "재등록완료_20261001" } as never], { memoReleaseSkuIds: ["7", "4", "11"], memoDiscontinueSkuIds: ["12"], reregisteredSkuIds: new Set(["4"]) });
assert.equal(rr.release.some(x => ["4", "10", "11"].includes(x.skuId)), false, "재등록 대상은 단종해제에서 뺌");
assert.deepEqual(rr.reregisteredExcluded, ["10", "4"]);
assert(rr.discontinue.some(x => x.skuId === "11"), "재등록완료 옛 SKU가 아직 정상이면 단종 대상");
assert(rr.discontinue.some(x => x.skuId === "12" && x.productName === "제품DB에 없음"), "메모 단종 SKU");
const already = buildStatusLists([item("20", "", "정상")], { memoReleaseSkuIds: ["20"], memoDiscontinueSkuIds: [] });
assert.equal(already.release.length, 0, "메모 SKU라도 이미 정상이면 단종해제에서 뺌");
console.log("PASS discontinue/release lists from 제품DB, memo merge, dedupe, cleared");

// 2026-10-20 마지막으로 한꺼번에 비운 묶음 되살리기
{
  const batch = lastClearedBatch({ a: "2026-10-19T01:00:00Z", b: "2026-10-20T03:00:00Z", c: "2026-10-20T03:00:00Z" });
  if (!batch || batch.at !== "2026-10-20T03:00:00Z" || batch.keys.sort().join() !== "b,c") throw new Error("lastClearedBatch 실패");
  if (lastClearedBatch({}) !== null) throw new Error("빈 기록 실패");
  console.log("lastClearedBatch OK");
}

// 2026-10-22 단종해제 SKU 직접 추가: 제품DB에 '불가'로만 있는 SKU, 예전에 비웠던 SKU도 다시 넣으면 보인다
{
  const db = [item("40117827", "", "불가"), item("5", "제품DB로 이동 (재고있음)", "불가"), item("6", "", "정상")];
  const base = buildStatusLists(db, { memoReleaseSkuIds: [], memoDiscontinueSkuIds: [] });
  const key5 = base.release.find(x => x.skuId === "5")!.key;
  const added = buildStatusLists(db, { memoReleaseSkuIds: [], memoDiscontinueSkuIds: [],
    cleared: { release: { [key5]: "2026-10-20T00:00:00Z" } },
    releaseFromScreen: { "40117827": { productName: "", at: "2026-10-22T05:00:00Z", manual: true }, "5": { productName: "", at: "2026-10-22T05:00:00Z", manual: true }, "6": { productName: "", at: "2026-10-22T05:00:00Z", manual: true } } });
  assert.deepEqual(added.release.map(x => x.skuId), ["40117827", "5"], "직접 추가 SKU는 보이고, 비웠던 SKU도 다시 보이고, 이미 정상은 뺌");
  assert.equal(added.release.find(x => x.skuId === "40117827")!.reason, "직접 추가");
  const stale = buildStatusLists(db, { memoReleaseSkuIds: [], memoDiscontinueSkuIds: [], cleared: { release: { [key5]: "2026-10-20T00:00:00Z" } } });
  assert.equal(stale.release.some(x => x.skuId === "5"), false, "다시 고르지 않으면 비운 SKU는 계속 숨김");
  console.log("manual release add OK");
}

// 2026-10-22 현재상태 '재고있음'도 발주가능상태가 정상이 아니면 단종해제 대상
{
  const r = buildStatusLists([item("40117827", "재고있음", "정상전환대상"), item("2", "재고있음", "정상")], { memoReleaseSkuIds: [], memoDiscontinueSkuIds: [] });
  assert.deepEqual(r.release.map(x => x.skuId), ["40117827"]);
  console.log("재고있음 auto release OK");
}

// 2026-10-22 현재상태에 글이 붙어도: 누적입고100이상/재고있음·과재고/○○ → 단종해제, 단종(중복등록) → 단종, 단종해제요청 → 단종 아님
{
  const r = buildStatusLists([item("1", "누적입고100이상/재고있음", "불가"), item("2", "과재고/메모", "일시중단"), item("3", "단종(중복등록)", "정상"), item("4", "단종해제요청/재고있음", "불가"), item("5", "누적입고100이상", "불가")], { memoReleaseSkuIds: [], memoDiscontinueSkuIds: [] });
  assert.deepEqual(r.release.map(x => x.skuId), ["1", "2", "4"]);
  assert.deepEqual(r.discontinue.map(x => x.skuId), ["3"]);
  console.log("contains rule OK");
}
