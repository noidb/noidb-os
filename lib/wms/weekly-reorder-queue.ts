import { createHash } from "node:crypto";
import { weeklyReorderRows } from "./weekly-work-state";
import { savedWeeklyMaterial } from "./saved-weekly-material";
import type { WeeklyWorkspace, WeeklySnapshot } from "./weekly-work-types";
import type { WeeklyReorderRow } from "./weekly-reorder-files";

export const reorderPair = (row: Pick<WeeklyReorderRow, "purchaseOrderNumber" | "skuId">) => JSON.stringify([row.purchaseOrderNumber, row.skuId]);
export const reorderDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function pendingReorderQueue(workspace: WeeklyWorkspace) {
  const requested = new Set(workspace.runs.filter(run => run.reorderRequestedAt || run.reorderQueuePartialRequestedAt).flatMap(run => (run.reorderRequestedLines || []).map(reorderPair)));
  const rows = new Map<string, WeeklyReorderRow>();
  const sources: Array<{ id: string; revision: number; pairs: string[]; hasIssues: boolean }> = [];
  const unresolved = new Map<string, { skuId: string; productName: string; purchaseOrderNumbers: string[]; message: string }>();
  for (const run of [...workspace.runs].sort((a,b) => b.snapshot.createdAt.localeCompare(a.snapshot.createdAt) || a.id.localeCompare(b.id))) {
    if (run.reorderRequestedAt || run.completedAt) continue;
    const lines: WeeklyReorderRow[] = [];
    let hasIssues = false;
    for (const review of Object.values(run.reviews).filter(row=>row.decision === "reorder" && !run.routedElsewhereSkuIds?.includes(row.skuId))) {
      const item = run.snapshot.vendorItems.find(row=>row.skuId===review.skuId);
      const pos = [...new Set(item?.relatedPurchaseOrderNumbers || [])];
      if (pos.length && pos.every(po=>requested.has(reorderPair({purchaseOrderNumber:po,skuId:review.skuId})))) continue;
      const selected = { ...run, reviews: { [review.skuId]: review } };
      try {
        let selectedRows: WeeklyReorderRow[];
        try { selectedRows = weeklyReorderRows(selected); }
        catch {
          const material = savedWeeklyMaterial(workspace, review.skuId, pos);
          selectedRows = weeklyReorderRows({ ...selected, snapshot: { ...selected.snapshot, vendorItems: [material.item] } });
        }
        lines.push(...selectedRows.filter(row=>!requested.has(reorderPair(row))));
      } catch {
        hasIssues = true;
        const issue = { skuId: review.skuId, productName: item?.productName || `SKU ${review.skuId}`, purchaseOrderNumbers: pos,
          message: "저장된 자료에서 발주번호별 미납수량을 확인할 수 없어 파일에서 제외됩니다." };
        unresolved.set(JSON.stringify([review.skuId,[...pos].sort()]),issue);
      }
    }
    if (!lines.length) continue;
    sources.push({ id: run.id, revision: run.revision, pairs: lines.map(reorderPair).sort(), hasIssues });
    for (const row of lines) if (!rows.has(reorderPair(row))) rows.set(reorderPair(row), row);
  }
  const items = [...rows.values()].sort((a,b) => reorderPair(a).localeCompare(reorderPair(b)));
  const discarded = new Set(workspace.runs.flatMap(run => (run.reorderDiscardedIssues || []).map(issue => JSON.stringify([issue.skuId, [...issue.purchaseOrderNumbers].sort()]))));
  const issues = [...unresolved.values()].filter(issue=>!discarded.has(JSON.stringify([issue.skuId, [...issue.purchaseOrderNumbers].sort()])) && (!issue.purchaseOrderNumbers.length || !issue.purchaseOrderNumbers.every(po=>rows.has(reorderPair({purchaseOrderNumber:po,skuId:issue.skuId})))));
  return { rows: items, sources, issues, token: reorderDigest([sources, items, issues]) };
}

/** Only selected PO+SKU pairs may enter the export; fresh unrelated candidates cannot. */
export function currentReorderRows(pending: WeeklyReorderRow[], snapshot: WeeklySnapshot): WeeklyReorderRow[] {
  if (!snapshot.operationalToken || snapshot.blockers.length) throw new Error("현재 발주·입고 원문을 확인하지 못했습니다. 자료 연결을 확인한 뒤 다시 시도해 주세요.");
  return pending.map(row => {
    const matches = snapshot.vendorItems.filter(item => item.skuId === row.skuId);
    const item = matches.length === 1 ? matches[0] : undefined;
    const details = item?.shortageDetails?.filter(detail => detail.purchaseOrderNumber === row.purchaseOrderNumber);
    const detail = details?.length === 1 ? details[0] : undefined;
    if (!detail || item?.discontinued || !Number.isSafeInteger(detail.confirmedQuantity) || !Number.isSafeInteger(detail.receivedQuantity)
      || detail.receivedQuantity < 0 || !Number.isSafeInteger(detail.shortageQuantity) || detail.shortageQuantity <= 0
      || detail.confirmedQuantity - detail.receivedQuantity !== detail.shortageQuantity) {
      throw new Error(`발주 ${row.purchaseOrderNumber} · SKU ${row.skuId}의 현재 미납수량을 확인해 주세요. 입고완료·단종 또는 원문 누락 여부 확인이 필요합니다.`);
    }
    return { ...row, productName: item!.productName, shortageQuantity: detail.shortageQuantity };
  });
}
