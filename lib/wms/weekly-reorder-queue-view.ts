import type { WeeklyRun } from "./weekly-work-types";
import { weeklyReviewIsActive } from "./weekly-work-progress";
/** Reanalyses point back to the original queue; do not open an empty copied run. */
export function weeklyReorderQueueRuns(runs: WeeklyRun[]): WeeklyRun[] {
  const seen = new Map<string, number>();
  return [...runs].sort((a,b) => b.snapshot.createdAt.localeCompare(a.snapshot.createdAt)).filter(run => {
    const rows = run.snapshot.vendorItems.filter(item => run.reviews[item.skuId]?.decision === "reorder" && weeklyReviewIsActive(run, run.reviews[item.skuId], true))
      .flatMap(item => (item.shortageDetails || []).map(row => ({ key: JSON.stringify([item.skuId, row.purchaseOrderNumber]), quantity: row.shortageQuantity })));
    const fresh = rows.some(row => (seen.get(row.key) || 0) < row.quantity);
    for (const row of rows) seen.set(row.key, Math.max(seen.get(row.key) || 0, row.quantity));
    return fresh;
  });
}
