import type { PickingWaveStoreSnapshot } from "../picking-wave/shared-store-types";
import type { VendorOrderDraftLine } from "./types";

export interface VendorLineImagePatch {
  lineId: string;
  imageUrl: string;
  expectedImageUrl: string;
  now: string;
}

function validImageUrl(value: string): boolean {
  if (/^\/api\/wms\/weekly-work\/image\?id=[a-f0-9]{64}$/.test(value)) return true;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

/** Patch the latest stored row atomically; clipboard upload never resaves stale quantities or receiving history. */
export function patchVendorLineImage(store: PickingWaveStoreSnapshot, input: VendorLineImagePatch): boolean {
  if (typeof input.lineId !== "string" || !input.lineId.trim() || typeof input.imageUrl !== "string" || input.imageUrl.length > 4000
    || !validImageUrl(input.imageUrl) || typeof input.expectedImageUrl !== "string" || !Number.isFinite(Date.parse(input.now))) {
    throw new Error("사진 저장 요청을 다시 확인해 주세요.");
  }
  if (store.vendorQueueConsumedLineIds?.[input.lineId]) throw new Error("발주대기로 취합한 상품입니다. 메인의 거래처 발주대기에서 사진을 다시 변경해 주세요.");
  const matches = store.vendorOrderLines.filter(line => line.id === input.lineId);
  if (matches.length !== 1 || store.deletedVendorLineIds[input.lineId]) throw new Error("사진을 저장할 발주 품목이 변경되었거나 삭제됐습니다. 새로 추가한 상품은 먼저 발주서를 저장해 주세요.");
  const current = matches[0];
  if (store.deletedVendorDraftIds[current.draftId]) throw new Error("삭제된 거래처 발주서에는 사진을 저장할 수 없습니다.");
  // A lost response may be retried after other fields changed or the draft was approved.
  if ((current.imageUrl || "") === input.imageUrl) return false;
  if ((current.imageUrl || "") !== input.expectedImageUrl) throw new Error("다른 화면에서 이 상품의 사진이 변경됐습니다. 최신 발주서를 다시 확인해 주세요.");
  const draft = store.vendorOrderDrafts.find(entry => entry.id === current.draftId);
  if (draft && !["draft", "review", "resend_needed"].includes(draft.status)) throw new Error("승인·전송한 발주서는 먼저 수정 상태로 전환한 뒤 사진을 변경해 주세요.");
  store.vendorOrderLines = store.vendorOrderLines.map(line => line.id === input.lineId ? { ...line, imageUrl: input.imageUrl, updatedAt: input.now } : line);
  return true;
}

/** Retain deliberate unsaved row edits in the UI while accepting newer server fields. */
export function mergeVendorImageResult(current: VendorOrderDraftLine, baseline: VendorOrderDraftLine | undefined, saved: VendorOrderDraftLine): VendorOrderDraftLine {
  const result = { ...saved };
  if (baseline && current.shortageQuantity !== baseline.shortageQuantity) result.shortageQuantity = current.shortageQuantity;
  if (baseline && current.memo !== baseline.memo) result.memo = current.memo;
  if (baseline && current.optionLabel !== baseline.optionLabel) result.optionLabel = current.optionLabel;
  return result;
}
