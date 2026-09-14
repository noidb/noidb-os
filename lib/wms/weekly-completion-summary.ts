import { get } from "@vercel/blob";

const WORKSPACE_PATH = "noidb-wms/weekly-work/v1/workspace.json";
const pairKey = (orderNo: string, skuId: string) => JSON.stringify([orderNo.trim(), skuId.trim()]);
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

type RawRun = Record<string, unknown>;

async function readWorkspace(): Promise<{ runs: RawRun[] } | null> {
  if (!process.env.VERCEL && !process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    let result;
    try {
      result = await get(WORKSPACE_PATH, { access: "private", useCache: false });
    } catch (error) {
      if (!/403|forbidden/i.test(String(error))) return null;
      result = await get(WORKSPACE_PATH, { access: "private" });
    }
    if (!result || result.statusCode !== 200) return null;
    const value = JSON.parse(await new Response(result.stream).text()) as Record<string, unknown>;
    return value.schemaVersion === 1 && Array.isArray(value.runs)
      ? { runs: value.runs.filter((run): run is RawRun => Boolean(object(run))) }
      : null;
  } catch {
    return null;
  }
}

function completedShortagePairs(runs: RawRun[]): string[] {
  const completed = new Set<string>();
  for (const savedRun of runs) {
    const lines = Array.isArray(savedRun.reorderRequestedLines) ? savedRun.reorderRequestedLines : [];
    if (text(savedRun.reorderRequestedAt) || text(savedRun.reorderQueuePartialRequestedAt)) {
      for (const value of lines) {
        const line = object(value);
        const orderNo = text(line?.purchaseOrderNumber);
        const skuId = text(line?.skuId);
        if (orderNo && skuId) completed.add(pairKey(orderNo, skuId));
      }
    }

    if (!text(savedRun.reorderRequestedAt)) continue;
    const snapshot = object(savedRun.snapshot);
    const reviews = object(savedRun.reviews);
    const items = Array.isArray(snapshot?.vendorItems) ? snapshot.vendorItems : [];
    for (const value of items) {
      const item = object(value);
      const skuId = text(item?.skuId);
      const review = object(reviews?.[skuId]);
      if (!skuId || text(review?.decision) !== "reorder") continue;
      const details = Array.isArray(item?.shortageDetails) ? item.shortageDetails : [];
      for (const detailValue of details) {
        const detail = object(detailValue);
        const orderNo = text(detail?.purchaseOrderNumber);
        if (orderNo) completed.add(pairKey(orderNo, skuId));
      }
    }
  }
  return [...completed];
}

function isCouponCompletion(run: RawRun, runs: RawRun[]): boolean {
  if (text(run.couponUploadedAt)) return true;
  const completedRuns = runs.filter(other => text(other.couponUploadedAt))
    .sort((a, b) => text(b.couponUploadedAt).localeCompare(text(a.couponUploadedAt)));
  const snapshot = object(run.snapshot);
  const items = Array.isArray(snapshot?.couponItems) ? snapshot.couponItems : [];
  if (!items.length) {
    const period = object(snapshot?.period);
    return completedRuns.some(other => {
      const otherPeriod = object(object(other.snapshot)?.period);
      return text(period?.startDate) === text(otherPeriod?.startDate) && text(period?.endDate) === text(otherPeriod?.endDate);
    });
  }
  const receiptKeys = object(snapshot?.couponReceiptKeys);
  return items.every(value => {
    const item = object(value);
    const keys = Array.isArray(receiptKeys?.[text(item?.skuId)]) ? receiptKeys[text(item?.skuId)] as unknown[] : [];
    return keys.length > 0 && keys.every(key => completedRuns.some(other => {
      const otherKeys = object(object(other.snapshot)?.couponReceiptKeys);
      const candidate = otherKeys?.[text(item?.skuId)];
      return Array.isArray(candidate) && candidate.includes(key);
    }));
  });
}

function couponSummary(runs: RawRun[]): { total: number; completed: number; pending: number } {
  const current = [...runs].sort((a, b) => {
    const left = object(a.snapshot), right = object(b.snapshot);
    return text(right?.createdAt).localeCompare(text(left?.createdAt)) || text(b.updatedAt).localeCompare(text(a.updatedAt));
  })[0];
  const snapshot = object(current?.snapshot);
  const items = Array.isArray(snapshot?.couponItems) ? snapshot.couponItems : [];
  const excluded = new Set(Array.isArray(current?.couponExcludedSkuIds) ? current.couponExcludedSkuIds.map(text).filter(Boolean) : []);
  const total = items.length;
  const completed = current && isCouponCompletion(current, runs) ? Math.max(0, total - excluded.size) : 0;
  return { total, completed, pending: completed ? 0 : Math.max(0, total - excluded.size) };
}

export async function readWeeklyCompletionSummary(): Promise<{
  available: boolean;
  completedShortagePairs: string[];
  couponTotal: number;
  couponCompleted: number;
  couponPending: number;
}> {
  const workspace = await readWorkspace();
  const runs = workspace?.runs.filter(run => !text(run.id).startsWith("TRANSFER-")) || [];
  const coupon = couponSummary(runs);
  return {
    available: Boolean(workspace),
    completedShortagePairs: completedShortagePairs(runs),
    couponTotal: coupon.total,
    couponCompleted: coupon.completed,
    couponPending: coupon.pending,
  };
}
