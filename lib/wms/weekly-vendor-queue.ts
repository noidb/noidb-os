import { randomUUID } from "node:crypto";
import { mutateWeeklyWorkspace } from "./weekly-work-store";
import { assertWeeklyCurrentRules, requireWeeklyRun, weeklySelectedOrders, weeklyVendorLines, weeklyReviewToken } from "./weekly-work-state";
import { mutatePickingWaveStore } from "./picking-wave/server-store";
import { toVendorOrderQuantity } from "./vendor-order/aggregate";
export async function transferWeeklyVendorQueue(runId: string, revision: number) {
  const now = new Date().toISOString();
  const operationId = randomUUID();
  const transfer = await mutateWeeklyWorkspace(workspace => {
    const run = requireWeeklyRun(workspace, runId, revision);
    const pending = run.vendorQueueTransfers?.find(t => !t.completed);
    if (pending) return pending;
    assertWeeklyCurrentRules(run);
    if (run.snapshot.blockers.length) throw new Error("입고 자료 확인을 먼저 마쳐 주세요.");
    const queued = new Set(run.vendorQueueTransfers?.flatMap(t => t.lines.map(l => l.skuId)) || []);
    // Weekly review selects the action; the draft owns order quantities.
    const draftRun = { ...run, reviews: { ...run.reviews } };
    for (const review of Object.values(run.reviews)) {
      if (review.decision !== "order" || queued.has(review.skuId) || run.sentVendors[review.vendorName]) continue;
      const item = run.snapshot.vendorItems.find(item => item.skuId === review.skuId);
      if (!item || !Number.isSafeInteger(item.shortageQuantity) || item.shortageQuantity <= 0) throw new Error("실제 미입고 수량을 확인할 수 없는 상품입니다. 입고 자료를 다시 확인해 주세요.");
      if (item.discontinued) throw new Error("단종된 SKU입니다. 단종해제를 먼저 처리해 주세요.");
      draftRun.reviews[review.skuId] = { ...review, quantity: toVendorOrderQuantity(item.shortageQuantity, item.productName) };
    }
    const vendors = [...new Set(weeklySelectedOrders(draftRun).map(r => r.vendorName))];
    if (vendors.some(v => run.pendingVendorSends?.[v])) throw new Error("기존 발송완료 연결을 먼저 확인해 주세요.");
    const lines = vendors.filter(v => !run.sentVendors[v]).flatMap(v => weeklyVendorLines(draftRun, v));
    if (!lines.length) return run.vendorQueueTransfers?.at(-1) || null;
    const reserved = { id: operationId, at: now, lines };
    run.vendorQueueTransfers = [...(run.vendorQueueTransfers || []), reserved];
    if (run.generated) run.generated = { ...run.generated, vendors: [], reviewToken: weeklyReviewToken(run) };
    run.completedAt = undefined;
    run.revision++; run.updatedAt = now;
    return reserved;
  });
  if (!transfer) throw new Error("거래처 발주로 선택한 상품이 없습니다.");
  const snapshot = await mutatePickingWaveStore({ action: "consolidateVendorOrders", operationId: transfer.id, lines: transfer.lines, now });
  const receipt = snapshot.vendorQueueReceipts![transfer.id];
  const run = await mutateWeeklyWorkspace(workspace => {
    const current = requireWeeklyRun(workspace, runId);
    const saved = current.vendorQueueTransfers!.find(t => t.id === transfer.id)!;
    if (!saved.completed) { saved.completed = true; saved.queueId = receipt.queueId; current.revision++; current.updatedAt = now; }
    return current;
  });
  return { run, receipt: { queueId: receipt.queueId, added: receipt.added, duplicates: receipt.duplicates } };
}
