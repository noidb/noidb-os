import assert from "node:assert/strict";
import { buildProductLabelLines } from "../lib/product-db/files";

assert.deepEqual(
  buildProductLabelLines({ model: "WE012345", manufactureYearMonth: "2026.08", manufacturerName: "테스트 제조자", importerName: "노이드비" }),
  [
    "1. 모델명 : WE012345",
    "2. 제조연월 : 2026.08",
    "3. 제조자명 : 테스트 제조자",
    "4. 수입자명 : 노이드비",
    "5. 주소 및 전화번호 : 경기도 고양시 탄현동 1559-1 / 010-5769-5602",
    "6. 제조국명 : 중국",
    "7. 사용연령 : 14세 이상",
    "8. 주의사항 : 분실, 파손주의",
  ],
);

const defaults = buildProductLabelLines({ model: "WR000001" }, new Date("2026-09-04T00:00:00+09:00"));
assert.equal(defaults[1], "2. 제조연월 : 2026.09");
assert.equal(defaults[2], "3. 제조자명 : 프리스타일 협력사");
assert.equal(defaults[3], "4. 수입자명 : 프리스타일");
assert.throws(() => buildProductLabelLines({ model: " " }), /모델명/);

console.log("상품 라벨 검증 통과: 사용자 입력, 현재 기본값, 빈 모델명 차단");
