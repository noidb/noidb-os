import type { PickingWaveStoreSnapshot, PickingWaveStoreMutation } from "../picking-wave/shared-store-types";
import type { VendorOrderDraft } from "./types";

/** Create a fresh order without reusing sent lines. The old sent draft is moved
 * to history atomically; its quantities, sentAt and receipt records stay intact. */
export function planNewVendorDraft(snapshot: PickingWaveStoreSnapshot, waveId: string, vendorName: string, operationId: string, at: string) {
  if (snapshot.activeVendorQueueId !== waveId) throw new Error("최신 거래처 발주관리에서 다시 만들어 주세요.");
  const name = vendorName.trim();
  if (!name) throw new Error("거래처명을 입력해 주세요.");
  const current = snapshot.vendorOrderDrafts.filter(d => d.waveId === waveId && d.vendorName === name && !d.archivedAt && !snapshot.deletedVendorDraftIds[d.id]);
  if (current.some(d => d.status !== "sent")) throw new Error("진행 중인 발주서가 있습니다. 승인한 발주서는 발주내용 수정을 먼저 눌러 주세요.");
  const now = new Date(Math.max(Date.parse(at), ...current.map(d => Date.parse(d.updatedAt) + 1))).toISOString();
  const draft: VendorOrderDraft = { id: waveId + "::" + name + "::new-" + operationId, waveId, vendorName: name, status: "draft", createdAt: now, updatedAt: now };
  if (snapshot.vendorOrderDrafts.some(d => d.id === draft.id) || snapshot.deletedVendorDraftIds[draft.id]) throw new Error("이미 사용한 발주서 번호입니다. 다시 만들어 주세요.");
  const drafts = [...current.map(d => ({ ...d, archivedAt: now, updatedAt: now })), draft];
  const mutation: Extract<PickingWaveStoreMutation, { action: "saveVendorWorkspace" }> = {
    action: "saveVendorWorkspace", operationId, waveId, lines: [], drafts, removedLineIds: [],
    expectedUpdatedAtByLineId: {},
    expectedUpdatedAtByDraftId: Object.fromEntries([...current.map(d => [d.id, d.updatedAt]), [draft.id, null]]),
    expectedLineIdsByDraftId: Object.fromEntries(drafts.map(d => [d.id, snapshot.vendorOrderLines.filter(line => line.draftId === d.id && !line.orderExclusion && line.shortageQuantity > 0).map(line => line.id)])),
    now,
  };
  return { draft, archivedDraftIds: current.map(d => d.id), mutation };
}
