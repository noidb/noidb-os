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
