import assert from "node:assert/strict";
import { buildStatusLists } from "../lib/wms/discontinue-lists";
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
