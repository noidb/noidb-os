/** 2026-11-06 미납 SKU 리스트: 처리한 줄 접기 + 단종 SKU 버튼 종류 검사. 실행: npx --yes tsx scripts/verify-missed-line-handled.ts */
import assert from "node:assert/strict";
import { discontinueActionFor, isHandledMissStatus } from "../lib/wms/missed-line-handled";

for (const status of ["재발주요청 제외함", "기존 거래처 발주로 처리", "거래처발주(으)로 보냄", "단종(으)로 보냄"])
  assert.equal(isHandledMissStatus(status, false), true, `${status} → 처리한 줄`);
for (const status of ["처리 전", "확인 필요", "단종해제 승인 대기", "공급상태 확인 필요"])
  assert.equal(isHandledMissStatus(status, false), false, `${status} → 계속 보임`);
assert.equal(isHandledMissStatus("거래처발주(으)로 보냄", true), false, "단종해제 승인 대기 중이면 계속 보임");

assert.equal(discontinueActionFor(["단종"], "정상"), "send", "단종인데 아직 정상 → 단종으로 보내기");
assert.equal(discontinueActionFor(["단종", "누적입고 120"], "정상"), "send");
assert.equal(discontinueActionFor(["단종"], "판매중지"), "confirm", "이미 정상 아님 → 단종확인");
assert.equal(discontinueActionFor(["단종"], ""), "confirm", "발주가능상태를 모르면 신청 대신 단종확인");
assert.equal(discontinueActionFor(["과재고"], "정상"), null, "단종 아닌 SKU는 버튼 없음");
assert.equal(discontinueActionFor(undefined, "정상"), null);
console.log("PASS 미납 SKU 리스트: 처리한 줄 접기, 단종 SKU 버튼 종류");
