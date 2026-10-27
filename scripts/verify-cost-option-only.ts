// 거래처발주 원가 수정: 기본은 같은 모델 전부, '해당 옵션 단가만 수정'은 이 SKU만(2026-10-27).
// 실행: npx --yes tsx scripts/verify-cost-option-only.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const editor = readFileSync("app/wms/picking/waves/[waveId]/vendor-orders/CostPriceEditor.tsx", "utf8");
const route = readFileSync("app/api/wms/product-catalog/update/route.ts", "utf8");
assert.match(editor, /save\("model"\)[^]*같은 모델 원가 모두 저장/, "기본 버튼은 같은 모델 전부 저장");
assert.match(editor, /save\("option"\)[^]*해당 옵션 단가만 수정/, "해당 옵션만 수정 버튼");
assert.match(editor, /const sameModel = scope === "model"/, "옵션 버튼일 때만 sameModel=false");
assert.match(editor, /JSON\.stringify\(\{ skuId, costVatIncluded: [^}]*, sameModel \}\)/, "sameModel 값을 그대로 서버로 보냄");
assert.match(route, /body\.sameModel === true/, "서버는 sameModel이 true일 때만 같은 모델 전부 수정");
console.log("verify-cost-option-only: OK");

// 2026-10-27: 결과 메모 한 줄 + 최근 쿠팡 공급가·마진 표시.
const memo = readFileSync("app/wms/picking/waves/[waveId]/vendor-orders/SentVendorMemoInput.tsx", "utf8");
assert.match(memo, /gridTemplateColumns: "auto minmax\(0, 1fr\) auto"/, "결과 메모 글씨는 입력칸 앞에 한 줄로");
assert.match(editor, /쿠팡 공급가/, "쿠팡 공급가 표시");
assert.match(editor, /color: "#c0392b", fontSize: 20/, "마진은 빨간 굵은 큰 글씨(원가·공급가와 세 칸 분리)");
assert.match(editor, /마진[^]*supply - current/, "마진 = 공급가 - 원가");
assert.match(readFileSync("lib/wms/product-catalog.ts", "utf8"), /recentSupplyPrice: \["최근쿠팡공급가"\]/, "제품DB 최근쿠팡공급가 칸을 읽음");
console.log("verify-cost-option-only(공급가·메모): OK");
