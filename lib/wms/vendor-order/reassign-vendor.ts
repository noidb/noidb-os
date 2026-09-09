import { UNASSIGNED_VENDOR_NAME, type VendorOrderDraft, type VendorOrderDraftLine } from "./types";
import { normalizeSkuId } from "../sku-normalize";
import type { PickingWaveStoreSnapshot, PickingWaveStoreMutation } from "../picking-wave/shared-store-types";
import { planNewVendorDraft } from "./new-draft";

const editable = (draft?: VendorOrderDraft) => !draft || ["draft", "review", "resend_needed"].includes(draft.status);

/** Move exactly one existing line ID. Never reset quantities/memos or touch sent drafts. */
export function prepareVendorReassignment(input: {
  line: VendorOrderDraftLine;
  vendorName: string;
  baseline?: VendorOrderDraftLine;
  latestLines: VendorOrderDraftLine[];
  localLines?: readonly VendorOrderDraftLine[];
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
  const targets = latestDrafts.filter(draft => draft.waveId === line.waveId && draft.vendorName === vendorName && !draft.archivedAt);
  if (targets.length > 1) throw new Error("새 거래처의 발주서가 중복되어 이동을 중단했습니다.");
  const targetDraft = targets[0];
  if (!editable(sourceDraft) || !editable(targetDraft)) throw new Error("승인·전송완료 발주서는 그대로 보존합니다. 먼저 해당 발주서를 수정 상태로 전환해 주세요.");
  const archivedIds = new Set(latestDrafts.filter(draft => draft.archivedAt).map(draft => draft.id));
  if ([...latestLines, ...(input.localLines || [])].some(candidate => candidate.id !== line.id && candidate.waveId === line.waveId && candidate.vendorName.trim() === vendorName && !candidate.orderExclusion && !archivedIds.has(candidate.draftId) && normalizeSkuId(candidate.skuId) === normalizeSkuId(line.skuId))) throw new Error("새 거래처 초안에 같은 SKU가 있습니다. 중복 발주를 막기 위해 기존 수량을 먼저 확인해 주세요.");
  const draft: VendorOrderDraft = targetDraft || { id: `${line.waveId}::${vendorName}`, waveId: line.waveId, vendorName, status: "draft", createdAt: now, updatedAt: now };
  const movedLine: VendorOrderDraftLine = { ...line, vendorName, draftId: draft.id, updatedAt: now };
  return { line: movedLine, draft, createDraft: !targetDraft };
}

/** Reserve a fresh target for a sent vendor and move the source in one CAS write. */
export function planVendorReassignment(input: {
  snapshot: PickingWaveStoreSnapshot; line: VendorOrderDraftLine; vendorName: string;
  baseline?: VendorOrderDraftLine; localLines: readonly VendorOrderDraftLine[];
  operationId: string; now: string;
}) {
  const { snapshot, line, operationId, now } = input;
  if (snapshot.activeVendorQueueId !== line.waveId) throw new Error("최신 거래처 발주관리에서 다시 이동해 주세요.");
  const latestDrafts = snapshot.vendorOrderDrafts.filter(d => d.waveId === line.waveId && !snapshot.deletedVendorDraftIds[d.id]);
  const latestLines = snapshot.vendorOrderLines.filter(l => l.waveId === line.waveId && !snapshot.deletedVendorLineIds[l.id]);
  const targets = latestDrafts.filter(d => d.vendorName === input.vendorName.trim() && !d.archivedAt);
  const fresh = !targets.length || targets.every(d => d.status === "sent")
    ? planNewVendorDraft(snapshot, line.waveId, input.vendorName, operationId, now) : undefined;
  const archived = new Set(fresh?.archivedDraftIds || []);
  const projectedDrafts = fresh ? latestDrafts.filter(d => !archived.has(d.id)).concat(fresh.mutation.drafts) : latestDrafts;
  const plan = prepareVendorReassignment({ ...input, latestLines, latestDrafts: projectedDrafts });
  const source = latestDrafts.find(d => d.id === line.draftId);
  const drafts = [...(fresh?.mutation.drafts || [plan.draft])];
  if (source && !drafts.some(d => d.id === source.id)) drafts.push(source);
  const mutation: Extract<PickingWaveStoreMutation, { action: "saveVendorWorkspace" }> = {
    action: "saveVendorWorkspace", operationId, waveId: line.waveId, lines: [plan.line], drafts, removedLineIds: [],
    expectedUpdatedAtByLineId: { [line.id]: latestLines.find(l => l.id === line.id)?.updatedAt ?? null },
    expectedUpdatedAtByDraftId: Object.fromEntries(drafts.map(d => [d.id, latestDrafts.find(old => old.id === d.id)?.updatedAt ?? null])),
    expectedLineIdsByDraftId: Object.fromEntries(drafts.map(d => [d.id, latestLines.filter(l => l.draftId === d.id && !l.orderExclusion && l.shortageQuantity > 0).map(l => l.id)])),
    now,
  };
  return { ...plan, archivedDraftIds: [...archived], mutation };
}
