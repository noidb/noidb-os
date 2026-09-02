import assert from "node:assert/strict";
import { safelyMatchesAddress, verifyAddressCandidates } from "../lib/wms/center-address/address-normalize";

assert.equal(safelyMatchesAddress("서울특별시 송파구 송파대로 55 E동", "서울특별시 송파구 송파대로 55"), true);
assert.equal(safelyMatchesAddress("서울특별시 송파구 송파대로 55 E동", "서울특별시 송파구 송파대로49길 55"), false);
assert.equal(safelyMatchesAddress("경기도 화성시 신동 703 동탄쿠팡물류센터", "경기도 화성시 동탄구 신동 703"), true);
assert.equal(safelyMatchesAddress("경기도 이천시 매곡리 977-5", "경기도 이천시 호법면 매곡리 977-5"), true);
assert.equal(safelyMatchesAddress("경기도 이천시 매곡리 977-5", "경기도 이천시 호법면 매곡리 977-6"), false);

const one = verifyAddressCandidates("서울특별시 송파구 송파대로 55 E동", [
  { postalCode: "05842", roadAddress: "서울특별시 송파구 송파대로 55", jibunAddress: "서울특별시 송파구 장지동 875", source: "kakao-postcode" },
  { postalCode: "05611", roadAddress: "서울특별시 송파구 송파대로49길 55", jibunAddress: "서울특별시 송파구 석촌동 23", source: "kakao-postcode" },
]);
assert.equal(one.approved, true);
assert.equal(one.candidate?.postalCode, "05842");

const ambiguous = verifyAddressCandidates("서울특별시 송파구 송파대로 55", [
  { postalCode: "05842", roadAddress: "서울특별시 송파구 송파대로 55", jibunAddress: "", source: "kakao-postcode" },
  { postalCode: "99999", roadAddress: "서울특별시 송파구 송파대로 55", jibunAddress: "", source: "juso-api" },
]);
assert.equal(ambiguous.approved, false);
assert.equal(ambiguous.validCandidateCount, 2);

const invalidPostal = verifyAddressCandidates("경기도 광주시 오포로297번길 54", [
  { postalCode: "1277", roadAddress: "경기도 광주시 오포로297번길 54", jibunAddress: "", source: "kakao-postcode" },
]);
assert.equal(invalidPostal.approved, false);

console.log("center address verification rules: PASS");
