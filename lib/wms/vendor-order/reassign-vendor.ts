import { UNASSIGNED_VENDOR_NAME, type VendorOrderDraft, type VendorOrderDraftLine } from "./types";

const editable = (draft?: VendorOrderDraft) => !draft || ["draft", "review", "resend_needed"].includes(draft.status);

/** Move exactly one existing line ID. Never reset quantities/memos or touch sent drafts. */
export function prepareVendorReassignment(input: {
  line: VendorOrderDraftLine;
  vendorName: string;
  baseline?: VendorOrderDraftLine;
  latestLines: VendorOrderDraftLine[];
  latestDrafts: VendorOrderDraft[];
  now: string;
}) {
  const { line, baseline, latestLines, latestDrafts, now } = input;
  const vendorName = input.vendorName.trim();
  if (!vendorName || vendorName === UNASSIGNED_VENDOR_NAME) throw new Error("새 거래처명을 입력해 주세요.");
  const matches = latestLines.filter(candidate => candidate.id === line.id);
  if (matches.length > 1) throw new Error("동일한 발주 품목이 중복되어 거래처 이동을 중단했습니다.");
  const latest = matches[0];
  if (baseline && (!latest || latest.updatedAt !== baseline.updatedAt)) throw new Error("다른 화면에서 이 품목이 수정되었습니다. 저장된 최신 발주서를 다시 확인해 주세요.");
  const sourceDraft = latestDrafts.find(draft => draft.id === (latest?.draftId || line.draftId));
  const targets = latestDrafts.filter(draft => draft.waveId === line.waveId && draft.vendorName === vendorName);
  if (targets.length > 1) throw new Error("새 거래처의 발주서가 중복되어 이동을 중단했습니다.");
  const targetDraft = targets[0];
  if (!editable(sourceDraft) || !editable(targetDraft)) throw new Error("승인·전송완료 발주서는 그대로 보존합니다. 먼저 해당 발주서를 수정 상태로 전환해 주세요.");
  if (latestLines.some(candidate => candidate.id !== line.id && candidate.waveId === line.waveId && candidate.vendorName === vendorName && candidate.skuId === line.skuId)) throw new Error("새 거래처 초안에 같은 SKU가 있습니다. 중복 발주를 막기 위해 기존 수량을 먼저 확인해 주세요.");
  const draft: VendorOrderDraft = targetDraft || { id: `${line.waveId}::${vendorName}`, waveId: line.waveId, vendorName, status: "draft", createdAt: now, updatedAt: now };
  const movedLine: VendorOrderDraftLine = { ...line, vendorName, draftId: draft.id, updatedAt: now };
  return { line: movedLine, draft, createDraft: !targetDraft };
}
