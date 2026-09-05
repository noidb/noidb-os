import assert from "node:assert/strict";
import { deriveArchivedVendorOrderWorkspace, deriveVendorOrderDrafts, indexVendorOrderLinesBySku } from "../lib/wms/vendor-order/derive-drafts";
import type { VendorOrderDraft, VendorOrderDraftLine } from "../lib/wms/vendor-order/types";

const line = {
  id: "WAVE-1::거래처A::SKU-1", draftId: "WAVE-1::거래처A", waveId: "WAVE-1", vendorName: "거래처A", skuId: "SKU-1",
  modelName: "M1", category: "반지", optionLabel: "실버, 17호", productName: "상품", imageUrl: "", barcode: "R1",
  shortageQuantity: 12, currentStock: "0", relatedPurchaseOrderNumbers: ["PO-1"], memo: "", isManuallyAdded: false,
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z",
} satisfies VendorOrderDraftLine;

const derived = deriveVendorOrderDrafts([], [line]);
assert.equal(derived.length, 1);
assert.equal(derived[0].id, line.draftId);
assert.equal(derived[0].status, "draft", "상위 카드가 없는 품목은 외부 전송 상태를 추측하지 않고 초안으로 복구해야 합니다.");

const sent = { ...derived[0], status: "sent" as const } satisfies VendorOrderDraft;
const preserved = deriveVendorOrderDrafts([sent], [line]);
assert.equal(preserved.length, 1);
assert.equal(preserved[0].status, "sent", "기존 발주서 상태를 읽기용 복구가 덮어쓰면 안 됩니다.");

const archivedWorkspace = deriveArchivedVendorOrderWorkspace(line.waveId, derived, [line]);
assert.equal(archivedWorkspace?.id, line.waveId);
assert.deepEqual(archivedWorkspace?.sourcePurchaseOrderNumbers, ["PO-1"]);
assert.equal(deriveArchivedVendorOrderWorkspace("EMPTY", [], []), null, "거래처 발주 데이터까지 없는 작업을 임의 복구하면 안 됩니다.");
const movedLine = { ...line, id: "WAVE-1::거래처B::SKU-1", draftId: "WAVE-1::거래처B", vendorName: "거래처B", updatedAt: "2026-09-03T00:00:00.000Z" };
const indexedBySku = indexVendorOrderLinesBySku([line, movedLine]);
assert.equal(indexedBySku.size, 1, "거래처가 바뀐 같은 SKU를 별도 발주행으로 중복 생성하면 안 됩니다.");
assert.equal(indexedBySku.get(line.skuId)?.vendorName, "거래처B", "사용자가 가장 최근에 수정한 거래처를 보존해야 합니다.");
console.log("거래처 발주 연결 검증 통과: 초안·상세 복구, 전송상태 보존, 동일 SKU 중복 이동 차단");
