import type { WeeklyRun } from "./weekly-work-types";
/** Completion covers the review's excluded receipt events as well as uploaded SKUs. */
export function weeklyCouponCompletion(run: WeeklyRun, runs: WeeklyRun[]): WeeklyRun | undefined {
  if (run.couponUploadedAt) return run;
  const completed = runs.filter(other => other.couponUploadedAt).sort((a,b) => b.couponUploadedAt!.localeCompare(a.couponUploadedAt!));
  if (!run.snapshot.couponItems.length) return completed.find(other => other.snapshot.period.startDate === run.snapshot.period.startDate && other.snapshot.period.endDate === run.snapshot.period.endDate);
  const covered = run.snapshot.couponItems.every(item => {
    const keys = run.snapshot.couponReceiptKeys?.[item.skuId];
    return keys?.length && keys.every(key => completed.some(other => other.snapshot.couponReceiptKeys?.[item.skuId]?.includes(key)));
  });
  return covered ? completed[0] : undefined;
}
