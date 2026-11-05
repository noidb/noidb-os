/**
 * 2026-11-05 택배(한진) 파일 K열 문구 끝의 "총수량 N" 검사.
 * 실행: npx --yes tsx scripts/verify-shipment-label-quantity.ts
 */
import assert from "node:assert/strict";
import { buildShipmentLabel } from "../lib/wms/hanjin-upload";
import { parseShipmentLabel } from "../lib/wms/hanjin-shipment-auto";

// 발주번호 1개(한 줄) + 총수량
const one = buildShipmentLabel("양산1", "2026-11-06", ["146461087"], 37);
assert.equal(one, "양산1 / 11월6일 / 발주서 번호 146461087 / 총수량 37");
assert.deepEqual(parseShipmentLabel(one), { fulfillmentCenter: "양산1", monthDayText: "11월6일", purchaseOrderNumbers: ["146461087"] });

// 발주번호 2개(한 줄, 쉼표) — 마지막 발주번호가 총수량 때문에 사라지면 안 된다
const two = buildShipmentLabel("시흥2", "2026-11-06", ["146584658", "146584659"], 12);
assert.equal(two, "시흥2 / 11월6일 / 발주서 번호 146584658, 146584659 / 총수량 12");
assert.deepEqual(parseShipmentLabel(two)?.purchaseOrderNumbers, ["146584658", "146584659"]);

// 발주번호 4개(두 줄, 슬래시)
const four = buildShipmentLabel("대구3", "2026-11-06", ["146461465", "146462543", "146495709", "146601611"], 37);
assert.equal(four, "대구3 / 11월6일\n발주서 번호 146461465 / 146462543 / 146495709 / 146601611 / 총수량 37");
assert.deepEqual(parseShipmentLabel(four), { fulfillmentCenter: "대구3", monthDayText: "11월6일", purchaseOrderNumbers: ["146461465", "146462543", "146495709", "146601611"] });

// 수량을 모르면(없음·0) 예전 문구 그대로
assert.equal(buildShipmentLabel("인천4", "2026-11-06", ["146460839"]), "인천4 / 11월6일 / 발주서 번호 146460839");
assert.equal(buildShipmentLabel("인천4", "2026-11-06", ["146460839"], 0), "인천4 / 11월6일 / 발주서 번호 146460839");

// 총수량이 없는 예전 파일도 그대로 읽힌다
assert.deepEqual(parseShipmentLabel("동탄1 / 9월4일 / 발주서 번호 146000001, 146000002")?.purchaseOrderNumbers, ["146000001", "146000002"]);
assert.deepEqual(parseShipmentLabel("대구3 / 11월6일\n발주서 번호 1 / 2 / 3")?.purchaseOrderNumbers, ["1", "2", "3"]);

console.log("verify-shipment-label-quantity OK");
