import assert from "node:assert/strict";
import { diffWimsStatuses, wimsStatusMap, type WimsRegistrationRow } from "../lib/wms/wims-registration";

// 2026-11-11: 'WIMS 지난 수집 이후 바뀐 것' 비교 검사.
const row = (modelSku: string, registeredAt: string, status: WimsRegistrationRow["status"]): WimsRegistrationRow => ({
  productName: `테스트 상품, ${modelSku} | 실버`, modelSku, estimateId: "", skuId: "", barcode: "", status, statusLabel: status, registeredAt,
});

const before = [
  row("we00001SI", "2026/11/04 10:00:00", "reviewing"),
  row("we00002SI", "2026/11/04 10:00:00", "reviewing"),
  row("we00003SI", "2026/11/04 10:00:00", "rejected"),
  row("we00004SI", "2026/11/04 10:00:00", "approved"),
  row("we00005SI", "2026/11/04 10:00:00", "reviewing"),
];
const baseline = wimsStatusMap(before);

// 아무 것도 안 바뀌면 변경 없음
const same = diffWimsStatuses(before, baseline);
assert.equal(same.total, 0);

const now = [
  row("we00001SI", "2026/11/04 10:00:00", "rejected"),   // 검수중 → 반려
  row("we00002SI", "2026/11/04 10:00:00", "approved"),   // 검수중 → 검수완료
  row("we00003SI", "2026/11/04 10:00:00", "reviewing"),  // 반려 → 검수중(그 밖)
  row("we00004SI", "2026/11/04 10:00:00", "approved"),   // 그대로
  row("we00005SI", "2026/11/04 10:00:00", "reviewing"),  // 그대로
  row("we00006SI", "2026/11/10 09:00:00", "reviewing"),  // 새 등록
];
const changes = diffWimsStatuses(now, baseline);
assert.deepEqual(changes.rejected.map(item => item.modelSku), ["we00001SI"]);
assert.deepEqual(changes.approved.map(item => item.modelSku), ["we00002SI"]);
assert.deepEqual(changes.added.map(item => item.modelSku), ["we00006SI"]);
assert.deepEqual(changes.other.map(item => [item.row.modelSku, item.before]), [["we00003SI", "rejected"]]);
assert.equal(changes.total, 4);

// 같은 식별자(모델SKU+등록일시)가 겹쳐도, 지난번과 같은 내용이면 가짜 변경이 생기지 않는다.
const dup = [row("we00009SI", "2026/11/04 10:00:00", "reviewing"), row("we00009SI", "2026/11/04 10:00:00", "approved")];
assert.equal(diffWimsStatuses(dup, wimsStatusMap(dup)).total, 0);

// 지난 수집본에 없던 줄이 사라진 경우(WIMS 필터 등)는 변경으로 세지 않는다.
assert.equal(diffWimsStatuses(before.slice(0, 2), baseline).total, 0);

console.log("verify-wims-changes: OK");
