import type { VendorOrderDraft, VendorOrderDraftLine } from "./types";
import type { PickingWave } from "../picking-wave/types";

export function deriveVendorOrderDrafts(
  drafts: readonly VendorOrderDraft[],
  lines: readonly VendorOrderDraftLine[],
): VendorOrderDraft[] {
  const result = new Map(drafts.map(draft => [draft.id, draft]));
  const linesByDraft = new Map<string, VendorOrderDraftLine[]>();
  for (const line of lines) {
    const grouped = linesByDraft.get(line.draftId) || [];
    grouped.push(line);
    linesByDraft.set(line.draftId, grouped);
  }
  for (const [draftId, grouped] of linesByDraft) {
    if (result.has(draftId) || grouped.length === 0) continue;
    const first = grouped[0];
    const createdAt = grouped.map(line => line.createdAt).sort()[0] || new Date(0).toISOString();
    const updatedAt = grouped.map(line => line.updatedAt).sort().at(-1) || createdAt;
    result.set(draftId, {
      id: draftId,
      waveId: first.waveId,
      vendorName: first.vendorName,
      status: "draft",
      createdAt,
      updatedAt,
    });
  }
  return [...result.values()];
}

/**
 * 예전 출고작업이 보관되거나 사라졌어도 거래처 발주 데이터가 남아 있으면 상세 화면을 연다.
 * 표시용 객체만 만들며 PickingWave 저장소에는 쓰지 않는다.
 */
export function deriveArchivedVendorOrderWorkspace(
  waveId: string,
  drafts: readonly VendorOrderDraft[],
  lines: readonly VendorOrderDraftLine[],
): PickingWave | null {
  if (drafts.length === 0 && lines.length === 0) return null;
  const timestamps = [
    ...drafts.flatMap(draft => [draft.createdAt, draft.updatedAt]),
    ...lines.flatMap(line => [line.createdAt, line.updatedAt]),
  ].filter(Boolean).sort();
  return {
    id: waveId,
    displayName: "보존된 거래처 발주",
    status: "completed",
    sourcePurchaseOrderNumbers: Array.from(new Set(lines.flatMap(line => line.relatedPurchaseOrderNumbers))).sort(),
    completedGroupIds: [],
    productDbConfigured: true,
    createdAt: timestamps[0] || new Date(0).toISOString(),
    updatedAt: timestamps.at(-1) || timestamps[0] || new Date(0).toISOString(),
  };
}
