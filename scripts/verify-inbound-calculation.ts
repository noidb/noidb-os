import assert from "node:assert/strict";
import { buildInboundDateResults } from "../lib/wms/inbound-results";
import type { ProductCatalogItem } from "../lib/wms/product-catalog";

// 로컬 G:·Google Sheet·운영 파일 없이 계산 함수만 회귀 검증한다.
const purchaseHeaders = ["발주번호", "SKU ID", "상품명", "확정수량", "발주수량", "발주현황"];
const inboundHeaders = ["발주번호", "SKU ID", "상품명", "순입고", "최근입고일"];
const purchases = [
  purchaseHeaders,
  ["PO-A", "70000001", "반지, 실버, 17호", "12", "12", "발주확정"],
  ["PO-A", "70000002", "확정 취소 상품", "0", "10", "발주확정"],
  ["PO-A", "70000003", "미확정 상품", "", "3", "발주확정"],
  ["PO-A", "70000004", "전체 취소 상품", "5", "5", "발주취소"],
  ["PO-B", "70000001", "반지, 실버, 17호", "4", "4", "발주확정"],
  ["PO-B", "70000005", "다른 상품", "1", "1", "발주확정"],
];
const inbounds = [
  inboundHeaders,
  ["PO-A", "70000001", "반지, 실버, 17호", "8", "2026-09-05"],
  ["PO-B", "70000005", "다른 상품", "1", "2026-09-05"],
];
const catalog = [{ skuId: "70000001", productName: "다른 DB 상품명", productLink: "https://example.com/70000001" }] as ProductCatalogItem[];
const initial = buildInboundDateResults(inbounds, purchases, catalog)[0];
assert.equal(initial.actualDate, "2026-09-05");
assert.equal(initial.purchaseOrderCount, 2);
assert.equal(initial.receivedSkuCount, 2);
assert.equal(initial.partialSkuCount, 1);
assert.equal(initial.missingSkuCount, 2);
assert.ok(!initial.missingItems.some(item => item.skuId === "70000002"), "확정 0은 발주수량 10으로 부활하면 안 됩니다.");
assert.ok(initial.missingItems.some(item => item.skuId === "70000003"), "빈 확정수량은 기존 발주수량으로 계산합니다.");
assert.ok(!initial.missingItems.some(item => item.skuId === "70000004"), "취소 발주는 미입고에서 제외합니다.");
assert.equal(initial.missingItems.find(item => item.skuId === "70000001")?.productLink, "https://example.com/70000001", "미입고 C열용 제품링크를 유지합니다.");
assert.equal(initial.couponItems.find(item => item.skuId === "70000001")?.productName, "반지, 실버, 17호", "발주 상품명·전체 옵션을 보존합니다.");

const late = buildInboundDateResults([...inbounds, ["PO-A", "70000001", "반지, 실버, 17호", "4", "2026-09-08"]], purchases, catalog);
assert.equal(late[0].actualDate, "2026-09-08");
assert.ok(!late[0].missingItems.some(item => item.skuId === "70000001"), "같은 발주의 지연입고 8+4는 완전입고입니다.");
assert.ok(late[1].missingItems.some(item => item.skuId === "70000001"), "다른 발주의 같은 SKU 미입고를 섞어 없애면 안 됩니다.");
assert.equal(late[0].couponItems.filter(item => item.skuId === "70000001").length, 1);

const conflicts = buildInboundDateResults(inbounds, [...purchases, ["PO-B", "70000001", "충돌하는 상품명", "1", "1", "발주확정"]], catalog)[0];
assert.ok(conflicts.nameConflicts.some(item => item.skuId === "70000001"), "서로 다른 발주 상품명은 임의 선택하지 않습니다.");
console.log("입고 계산 검증 통과: 확정 0·빈값 구분, 실제일·지연입고·발주별 분리, 부분입고 쿠폰, 제품링크·옵션 보존");
