import type { PickingWaveStoreSnapshot } from "../picking-wave/shared-store-types";
import type { VendorOrderDraft, VendorOrderDraftLine } from "./types";
import { getVendorLineDeletionBlockReason } from "./delete-lines";
import { VendorOrderWriteConflictError } from "./queue-write-guard";

export const VENDOR_ORDER_DISCARD_REASONS = ["잘못 생성", "중복", "테스트"] as const;
export type VendorOrderDiscardReason = typeof VENDOR_ORDER_DISCARD_REASONS[number];
export interface DiscardedVendorOrder { draft: VendorOrderDraft; lines: VendorOrderDraftLine[]; reason: VendorOrderDiscardReason; deletedAt: string }
export interface DiscardVendorOrderInput { draftId: string; expectedUpdatedAt: string; expectedUpdatedAtByLineId: Record<string, string>; reason: VendorOrderDiscardReason; deletedAt: string }
export function vendorOrderDiscardBlockReason(lines: readonly VendorOrderDraftLine[]): string | null {
  return lines.some(line => getVendorLineDeletionBlockReason(line, { status: "draft" }))
    ? "입고·원가 이력이 있는 발주서입니다. 입고관리에서 이력을 확인해 주세요." : null;
}
/** Explicit removal keeps a server-owned copy and targets one exact draft, including sent test orders. */
export function discardVendorOrder(store: PickingWaveStoreSnapshot, input: DiscardVendorOrderInput): boolean {
  const fail = (message: string): never => { throw new VendorOrderWriteConflictError(message); };
  if (!input.draftId || !input.expectedUpdatedAt || !VENDOR_ORDER_DISCARD_REASONS.includes(input.reason) || !Number.isFinite(Date.parse(input.deletedAt))
    || !input.expectedUpdatedAtByLineId || typeof input.expectedUpdatedAtByLineId !== "object" || Array.isArray(input.expectedUpdatedAtByLineId)) fail("삭제할 발주서와 사유를 확인해 주세요.");
  const matches = (draft: VendorOrderDraft, lines: VendorOrderDraftLine[]) => draft.updatedAt === input.expectedUpdatedAt
    && lines.length === Object.keys(input.expectedUpdatedAtByLineId).length
    && lines.every(line => Object.hasOwn(input.expectedUpdatedAtByLineId, line.id) && input.expectedUpdatedAtByLineId[line.id] === line.updatedAt);
  const draft = store.vendorOrderDrafts.find(row => row.id === input.draftId);
  if (!draft) {
    const prior = store.discardedVendorOrders?.[input.draftId];
    if (prior && store.deletedVendorDraftIds[input.draftId] === prior.deletedAt && matches(prior.draft, prior.lines)) return false;
    return fail("이미 삭제되었거나 변경된 발주서입니다. 최신 목록을 확인해 주세요.");
  }
  const lines = store.vendorOrderLines.filter(line => line.draftId === draft.id);
  if (!matches(draft, lines)) fail("삭제 확인 중 발주서나 상품이 변경되었습니다. 닫고 다시 확인해 주세요.");
  const blocked = vendorOrderDiscardBlockReason(lines);
  if (blocked) fail(blocked);
  store.discardedVendorOrders = { ...store.discardedVendorOrders, [draft.id]: { draft: structuredClone(draft), lines: structuredClone(lines), reason: input.reason, deletedAt: input.deletedAt } };
  store.deletedVendorDraftIds[draft.id] = input.deletedAt;
  for (const line of lines) store.deletedVendorLineIds[line.id] = input.deletedAt;
  store.vendorOrderDrafts = store.vendorOrderDrafts.filter(row => row.id !== draft.id);
  store.vendorOrderLines = store.vendorOrderLines.filter(line => line.draftId !== draft.id);
  return true;
}
