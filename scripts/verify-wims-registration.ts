import assert from "node:assert/strict";
import { parseWimsClipboard } from "../lib/wms/wims-registration";

const sample = [
  "상품명\t상품 등록일\t카테고리\t바코드\t원본 견적서\t견적서 ID\tSKU ID\t상태\t등록 진행 단계",
  "써지컬스틸 변색없는 대나무체인 남성목걸이, 유광골드 mn011236-GO\t2026/08/28\t남성패션목걸이\t바코드 없음(쿠팡 바코드 생성 요청)\t다운로드\t2897812\t-\t상품 등록 불가\t가격/정책 상품정보",
  "써지컬스틸 2PI세트 투웨이 얇은링 스티커 통통하트 여성 피어싱, 16mm wp24041505-16\t2026/08/27\t여성피어싱\tR259891680004\t다운로드\t2897813\t79392730\t상품 검수 완료\t가격/정책 상품정보 발주서 발행",
].join("\n");

const result = parseWimsClipboard(sample);
assert.equal(result.rows.length, 2);
assert.equal(result.rejectedCount, 1);
assert.equal(result.approvedCount, 1);
assert.equal(result.rows[0].modelSku, "mn011236-GO");
assert.equal(result.rows[0].skuId, "");
assert.equal(result.rows[0].barcode, "");
assert.equal(result.rows[1].modelSku, "wp24041505-16");
assert.equal(result.rows[1].skuId, "79392730");
assert.equal(result.rows[1].barcode, "R259891680004");
console.log("WIMS 등록상태 표 파서 검증 완료");

const verticalSample = `상품 등록 상태 확인
상품명\t상품 등록일\t카테고리\t바코드\t원본 견적서\t견적서 ID\tSKU ID\t상태\t등록 진행 단계

써지컬스틸 변색없는 대나무체인 남성목걸이, 유광골드 mn011236-GO
2026/08/28
17:40:31
패션의류잡화 >> 남성패션목걸이 (71633)
바코드 없음(쿠팡 바코드 생성 요청)
021df240...
(
2897812
)
-
상품 등록 불가
가격/정책
해당 검수가 완료되었습니다.

써지컬스틸 2P세트 투웨이 얇은링 여성 피어싱, 16mm wp24041505-16
2026/08/27
18:39:43
패션의류잡화 >> 여성피어싱 (109077)
R259891680004
2427903a...
(
2897813
)
79392730
상품 검수 완료
가격/정책`;

const vertical = parseWimsClipboard(verticalSample);
assert.equal(vertical.rows.length, 2);
assert.equal(vertical.rejectedCount, 1);
assert.equal(vertical.approvedCount, 1);
assert.equal(vertical.rows[0].modelSku, "mn011236-GO");
assert.equal(vertical.rows[0].estimateId, "2897812");
assert.equal(vertical.rows[0].skuId, "");
assert.equal(vertical.rows[1].modelSku, "wp24041505-16");
assert.equal(vertical.rows[1].skuId, "79392730");
assert.equal(vertical.rows[1].barcode, "R259891680004");
assert.equal(parseWimsClipboard(verticalSample.replace(" wp24041505-16", "")).rows[1].modelSku, "");
