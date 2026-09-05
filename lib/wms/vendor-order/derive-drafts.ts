import type { VendorOrderDraft, VendorOrderDraftLine } from "./types";

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
