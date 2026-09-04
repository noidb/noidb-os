import assert from "node:assert/strict";
import { buildRegistrationFileStageUpdates, REGISTRATION_FILE_CREATED_STATUS } from "../lib/wms/registration-file-stage";

const rows = [
  ["현재상태", "모델명/품번", "모델SKU", "SKU ID"],
  ["신상승인대기", "new001", "new001-GO", ""],
  ["신상승인대기", "new001", "new001-SI", ""],
  ["완료", "old001", "old001-GO", "123"],
];
const updates = buildRegistrationFileStageUpdates(rows, "new001", ["new001-GO", "new001-SI"]);
assert.deepEqual(updates, [
  { row: 2, col: 1, value: REGISTRATION_FILE_CREATED_STATUS },
  { row: 3, col: 1, value: REGISTRATION_FILE_CREATED_STATUS },
]);
assert.throws(() => buildRegistrationFileStageUpdates(rows, "new001", ["new001-GO"]), /생성된 제품DB 행 2개와 예상 모델SKU 1개/);
assert.throws(() => buildRegistrationFileStageUpdates(rows, "old001", ["old001-GO"]), /보호해야 할 기존 상태/);
console.log("등록파일생성 상태 전환 규칙 검증 완료");
