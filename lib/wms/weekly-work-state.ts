import { createHash } from "node:crypto";
import type { WeeklyReview, WeeklyRun, WeeklySnapshot, WeeklyWorkspace } from "./weekly-work-types";
import { weeklyReviewCompletion, weeklyFreshVendorItem } from "./weekly-work-progress";
import { WEEKLY_RULES_VERSION } from "./weekly-work-types";
import type { VendorOrderDraftLine } from "./vendor-order/types";

export function emptyWeeklyWorkspace(): WeeklyWorkspace {
  return { schemaVersion: 1, revision: 0, runs: [], productOverrides: {} };
}
/** Import operator-provided submission evidence; this is not Coupang approval. */
export function recordWeeklyDiscontinueHistory(workspace: WeeklyWorkspace, run: WeeklyRun, rows: unknown, source: unknown, now = new Date().toISOString()): number {
  if (run.completedAt || run.pendingDiscontinueSubmission) throw new Error("완료 또는 연결 중인 업무는 신청 이력을 별도로 확인해 주세요.");
  if (typeof source !== "string" || !source.trim() || source.length > 1000 || !Array.isArray(rows) || !rows.length || rows.length > 1000) throw new Error("단종 신청 근거와 상품 목록을 확인해 주세요.");
  const seen = new Set<string>();
  const requestIds = new Set<string>();
  const normalized = rows.map((row: {skuId?:unknown;productName?:unknown;requestId?:unknown;submittedAt?:unknown}) => {
    if (!row || typeof row.skuId !== "string" || !/^\d+$/.test(row.skuId) || typeof row.requestId !== "string" || !/^\d+$/.test(row.requestId)
      || typeof row.submittedAt !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(row.submittedAt) || !Number.isFinite(Date.parse(row.submittedAt)) || Date.parse(row.submittedAt) > Date.parse(now)
      || seen.has(row.skuId) || requestIds.has(row.requestId)) throw new Error("SKU·신청번호·신청일 또는 중복 행을 확인해 주세요.");
    seen.add(row.skuId); requestIds.add(row.requestId);
    const items = run.snapshot.vendorItems.filter(item => item.skuId === row.skuId);
    if (items.length !== 1 || items[0].productName !== row.productName || run.reviews[row.skuId]?.decision !== "discontinue") throw new Error("기존 단종 검토 상품명·옵션과 신청 내역이 일치하지 않습니다.");
    if (run.discontinueQueueRequestIds?.[row.skuId]?.length) throw new Error("단종대기 연결 항목은 원래 신청 완료 기능으로 확인해 주세요.");
    const existing = workspace.runs.flatMap(item => item.discontinueSubmissionChecks || []).filter(item => item.requestId === row.requestId);
    if (existing.some(item => item.skuId !== row.skuId || item.submittedAt !== row.submittedAt)) throw new Error("기존 신청번호의 상품 또는 신청일과 충돌합니다.");
    return {skuId:row.skuId,requestId:row.requestId,submittedAt:row.submittedAt,recordedAt:now,source:source.trim()};
  });
  const added = normalized.filter(row => !(run.discontinueSubmissionChecks || []).some(old => old.requestId === row.requestId));
  if (!added.length) return 0;
  run.discontinueSubmissionChecks = [...(run.discontinueSubmissionChecks || []), ...added];
  run.discontinueSubmittedSkuIds = [...new Set([...(run.discontinueSubmittedSkuIds || []), ...normalized.map(row => row.skuId)])].sort();
  if (Object.values(run.reviews).filter(row => row.decision === "discontinue").every(row => run.discontinueSubmittedSkuIds!.includes(row.skuId))) run.discontinueSubmittedAt = normalized.map(row => row.submittedAt).sort((a,b)=>Date.parse(a)-Date.parse(b)).at(-1);
  run.revision++; run.updatedAt = now;
  if (run.generated) run.generated = {...run.generated,discontinueCount:0,discontinueSkuIds:[]};
  return added.length;
}
export function weeklyReviewToken(run: WeeklyRun): string {
  const parts: unknown[] = [run.snapshot.rulesVersion, run.snapshot.sourceToken, weeklyCouponSelection(run.snapshot), [...new Set(run.couponExcludedSkuIds || [])].sort(), Object.values(run.reviews).sort((a,b)=>a.skuId.localeCompare(b.skuId))];
  if (run.routedElsewhereSkuIds?.length) parts.push(["routed-elsewhere", ...run.routedElsewhereSkuIds.slice().sort()]);
  if (run.previouslyDiscontinuedSkuIds?.length) parts.push([...run.previouslyDiscontinuedSkuIds].sort());
  // Existing runs without reorder provenance retain their prior acknowledged token.
  if (run.snapshot.vendorItems.some(item => item.shortageDetails) || run.reorderPreviouslyRequestedLines?.length || Object.values(run.reviews).some(review => review.decision === "reorder")) {
    parts.push(run.snapshot.vendorItems.map(item => [item.skuId, item.shortageQuantity, item.shortageDetails]), [...(run.reorderPreviouslyRequestedLines || [])].sort((a,b)=>reorderPair(a).localeCompare(reorderPair(b))));
  }
  if (run.vendorQueueTransfers?.length) parts.push(run.vendorQueueTransfers.flatMap(t => t.lines.map(l => l.skuId)).sort());
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
type ReorderLine = { purchaseOrderNumber: string; skuId: string; shortageQuantity: number };
export type WeeklyReorderRow = ReorderLine & { productName: string };
const reorderPair = (line: Pick<ReorderLine, "purchaseOrderNumber" | "skuId">) => JSON.stringify([line.purchaseOrderNumber, line.skuId]);
const reorderSourceError = () => new Error("재발주할 원래 발주번호별 확정·실제 입고·미입고 수량을 확인할 수 없습니다. 기간 자료를 다시 준비해 주세요.");
/** Preserve the source totals. Only the explicit previously-requested PO+SKU ledger
 * removes rows, never vendor order quantities or twelve-unit suggestions. */
export function weeklyReorderRows(run: WeeklyRun): WeeklyReorderRow[] {
  const excluded = new Set((run.reorderPreviouslyRequestedLines || []).map(reorderPair));
  const rows: WeeklyReorderRow[] = [];
  const pairs = new Set<string>();
  for (const review of Object.values(run.reviews).filter(r => r.decision === "reorder" && !run.routedElsewhereSkuIds?.includes(r.skuId))) {
    const matches = run.snapshot.vendorItems.filter(item => item.skuId === review.skuId);
    if (matches.length !== 1 || !/^\d+$/.test(review.skuId)) throw reorderSourceError();
    const item = matches[0];
    if (!item.shortageDetails?.length || !Number.isSafeInteger(item.shortageQuantity) || item.shortageQuantity <= 0) throw reorderSourceError();
    const detailPos = new Set<string>();
    let total = 0;
    for (const detail of item.shortageDetails) {
      if (!detail || typeof detail.purchaseOrderNumber !== "string" || !/^\d+$/.test(detail.purchaseOrderNumber)
        || detailPos.has(detail.purchaseOrderNumber) || !item.relatedPurchaseOrderNumbers.includes(detail.purchaseOrderNumber)
        || !Number.isSafeInteger(detail.confirmedQuantity) || detail.confirmedQuantity < 0
        || !Number.isSafeInteger(detail.receivedQuantity) || detail.receivedQuantity < 0
        || !Number.isSafeInteger(detail.shortageQuantity) || detail.shortageQuantity <= 0
        || detail.confirmedQuantity - detail.receivedQuantity !== detail.shortageQuantity) throw reorderSourceError();
      detailPos.add(detail.purchaseOrderNumber); total += detail.shortageQuantity;
      const row = { purchaseOrderNumber: detail.purchaseOrderNumber, skuId: item.skuId, productName: item.productName, shortageQuantity: detail.shortageQuantity };
      const pair = reorderPair(row);
      if (pairs.has(pair)) throw reorderSourceError();
      pairs.add(pair);
      if (!excluded.has(pair)) rows.push(row);
    }
    if (!Number.isSafeInteger(total) || total !== item.shortageQuantity) throw reorderSourceError();
  }
  return rows;
}
function otherWeeklyReorderRequests(workspace: WeeklyWorkspace, ownRunId: string): ReorderLine[] {
  const lines = new Map<string, ReorderLine>();
  for (const run of workspace.runs) if (run.id !== ownRunId && run.reorderRequestedAt) {
    for (const line of run.reorderRequestedLines || []) lines.set(reorderPair(line), line);
  }
  return [...lines.values()];
}
export function assertWeeklyReviewEligibility(workspace: WeeklyWorkspace, run: WeeklyRun): void {
  if (run.completedAt) return;
  const otherDiscontinued = workspace.runs.filter(other => other.id !== run.id).flatMap(other => other.discontinueSubmittedSkuIds || (other.discontinueSubmittedAt ? Object.values(other.reviews).filter(review => review.decision === "discontinue").map(review => review.skuId) : []));
  const current = { ...run, previouslyDiscontinuedSkuIds: [...new Set([...(run.previouslyDiscontinuedSkuIds || []), ...otherDiscontinued])], reorderPreviouslyRequestedLines: otherWeeklyReorderRequests(workspace, run.id) };
  if (Object.values(run.reviews).some(review => !weeklyReviewCompletion(run, review) && weeklyReviewCompletion(current, review))) throw new Error("다른 업무에서 이미 단종 신청을 완료했거나 이미 재발주 요청을 완료한 상품이 있습니다. 기간 자료를 다시 준비해 주세요.");
}
export function assertWeeklyReorderEligibility(workspace: WeeklyWorkspace, run: WeeklyRun): void {
  if (run.reorderRequestedAt) return;
  const requested = new Set(otherWeeklyReorderRequests(workspace, run.id).map(reorderPair));
  if (weeklyReorderRows(run).some(line => requested.has(reorderPair(line)))) {
    throw new Error("다른 주간 업무에서 이미 재발주 요청한 발주번호·SKU가 있습니다. 기간 자료를 다시 준비해 주세요.");
  }
}
function refreshWeeklyReorderLedger(workspace: WeeklyWorkspace, run: WeeklyRun, now: string): void {
  if (run.reorderRequestedAt) return;
  const relevant = new Set(run.snapshot.vendorItems.flatMap(item => (item.shortageDetails || []).map(detail => reorderPair({ ...detail, skuId: item.skuId }))));
  const next = otherWeeklyReorderRequests(workspace, run.id).filter(line => relevant.has(reorderPair(line))).sort((a,b)=>reorderPair(a).localeCompare(reorderPair(b)));
  const previous = [...(run.reorderPreviouslyRequestedLines || [])].sort((a,b)=>reorderPair(a).localeCompare(reorderPair(b)));
  if (JSON.stringify(next) === JSON.stringify(previous)) return;
  run.reorderPreviouslyRequestedLines = next;
  const excluded = new Set(next.map(reorderPair));
  for (const item of run.snapshot.vendorItems) if (item.shortageDetails?.some(detail => excluded.has(reorderPair({ ...detail, skuId: item.skuId })))) {
    const review = run.reviews[item.skuId];
    if (review && !(review.decision === "order" && (run.sentVendors[review.vendorName] || run.pendingVendorSends?.[review.vendorName]))) {
      if (review.decision === "order" || item.shortageDetails.every(detail => excluded.has(reorderPair({ ...detail, skuId: item.skuId })))) review.decision = "hold";
      review.quantityConfirmed = false;
    }
  }
  run.completedAt = undefined;
  if (run.generated) run.generated = { ...run.generated, reviewToken: weeklyReviewToken(run), reorderCount: 0, reorderRequestDate: undefined };
  run.revision++; run.updatedAt = now;
}
export function assertWeeklyCurrentRules(run: WeeklyRun): void {
  if (run.snapshot.rulesVersion !== WEEKLY_RULES_VERSION) throw new Error("입고·쿠폰 기준이 변경된 이전 업무입니다. 기간 자료를 다시 준비해 주세요. 기존 처리 기록은 그대로 보관됩니다.");
}
export function weeklySelectedCoupons(run: Pick<WeeklyRun, "snapshot" | "couponExcludedSkuIds">): WeeklySnapshot["couponItems"] {
  const excluded = new Set(run.couponExcludedSkuIds || []);
  return run.snapshot.couponItems.filter(item => !excluded.has(item.skuId));
}
/** Coupon exclusions are this run's review, never a product discontinuation. */
export function updateWeeklyCouponSelection(run: WeeklyRun, excludedSkuIds: unknown, now: string): void {
  assertWeeklyCurrentRules(run);
  if (run.couponUploadedAt) throw new Error("이미 쿠팡에 등록한 쿠폰입니다. 등록한 SKU 선택은 변경할 수 없습니다.");
  if (!Array.isArray(excludedSkuIds) || excludedSkuIds.length > run.snapshot.couponItems.length) throw new Error("쿠폰에서 제외할 SKU 목록을 확인해 주세요.");
  const known = new Set(run.snapshot.couponItems.map(item => item.skuId));
  const seen = new Set<string>();
  for (const skuId of excludedSkuIds) {
    if (typeof skuId !== "string" || !known.has(skuId) || seen.has(skuId)) throw new Error("쿠폰 목록에 없는 SKU이거나 중복된 SKU입니다.");
    seen.add(skuId);
  }
  const next = [...seen].sort();
  if (JSON.stringify(next) === JSON.stringify([...(run.couponExcludedSkuIds || [])].sort())) return;
  run.couponExcludedSkuIds = next;
  run.completedAt = undefined;
  if (run.generated) run.generated = { ...run.generated, couponCount: 0, advertisingCount: 0, advertisingFiles: [], advertisingToken: undefined, reviewToken: weeklyReviewToken(run) };
  run.revision++; run.updatedAt = now;
}
export function weeklyKoreaDay(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
export function validWeeklyCouponDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
/** The operator verifies the latest end date across ALL coupons on each SKU. */
export function recordWeeklyCouponChecks(workspace: WeeklyWorkspace, rows: unknown, source: unknown, now = new Date().toISOString()): number {
  if (!Array.isArray(rows) || !rows.length || rows.length > 10000 || typeof source !== "string" || !source.trim() || source.length > 300) throw new Error("확인한 쿠폰 SKU·마지막 종료일과 자료 출처를 입력해 주세요.");
  const checked = new Map<string, string>();
  for (const row of rows) {
    if (!row || typeof row.skuId !== "string" || !/^\d+$/.test(row.skuId) || !validWeeklyCouponDate(row.expiresOn)) throw new Error("SKU는 숫자로, 종료일은 YYYY-MM-DD 형식으로 입력해 주세요.");
    checked.set(row.skuId, [checked.get(row.skuId) || "", row.expiresOn].sort().at(-1)!);
  }
  workspace.couponChecks = [...(workspace.couponChecks || []), ...[...checked].map(([skuId, expiresOn]) => ({ skuId, expiresOn, checkedAt: now, source: source.trim() }))];
  return checked.size;
}
export function weeklyCouponBlocks(workspace: WeeklyWorkspace, ownRunId?: string, now = new Date()): Array<{ skuId: string; expiresOn?: string; reason: string }> {
  const known = new Map<string, { expiresOn?: string; checkedAt?: string }>();
  for (const check of workspace.couponChecks || []) known.set(check.skuId, { expiresOn: check.expiresOn, checkedAt: check.checkedAt });
  for (const run of workspace.runs) if (run.id !== ownRunId && run.couponUploadedAt) {
    for (const item of weeklySelectedCoupons(run)) {
      const prior = known.get(item.skuId);
      if (prior?.checkedAt && Date.parse(run.couponUploadedAt) <= Date.parse(prior.checkedAt)) continue;
      const expiresOn = validWeeklyCouponDate(run.couponExpiresOn) ? run.couponExpiresOn : undefined;
      known.set(item.skuId, { checkedAt: prior?.checkedAt, expiresOn: prior && !prior.expiresOn || !expiresOn ? undefined : [prior?.expiresOn || "", expiresOn].sort().at(-1) });
    }
  }
  const today = weeklyKoreaDay(now);
  return [...known].filter(([, value]) => !value.expiresOn || value.expiresOn >= today).map(([skuId, value]) => ({ skuId, expiresOn: value.expiresOn, reason: value.expiresOn ? `${value.expiresOn}까지 쿠폰 적용` : "기존 쿠폰 종료일 확인 필요" }));
}
function weeklyCouponSelection(snapshot: Pick<WeeklySnapshot, "couponItems" | "couponReceiptKeys">): Array<[string, string[]]> {
  return snapshot.couponItems.map(item => [item.skuId, [...new Set(snapshot.couponReceiptKeys?.[item.skuId] || [])].sort()] as [string, string[]]).sort((a,b)=>a[0].localeCompare(b[0]));
}
/** Coupon eligibility follows completed receipt events, even for an already-open run. */
export function eligibleWeeklyCoupons(workspace: WeeklyWorkspace, snapshot: WeeklySnapshot, ownRunId = snapshot.id, now = new Date()): Pick<WeeklySnapshot, "couponItems" | "couponReceiptKeys"> {
  const uploaded = workspace.runs.filter(run => run.id !== ownRunId && run.couponUploadedAt);
  const usedReceiptKeys = new Set(uploaded.flatMap(run => run.snapshot.couponItems.flatMap(item => run.snapshot.couponReceiptKeys?.[item.skuId] || [])));
  const couponItems: WeeklySnapshot["couponItems"] = [];
  const couponReceiptKeys: NonNullable<WeeklySnapshot["couponReceiptKeys"]> = {};
  const blockedSkus = new Set(weeklyCouponBlocks(workspace, ownRunId, now).map(item => item.skuId));
  for (const item of snapshot.couponItems) {
    if (blockedSkus.has(item.skuId)) continue;
    const events = [...new Set(snapshot.couponReceiptKeys?.[item.skuId] || [])];
    if (events.length) {
      const available = events.filter(key => !usedReceiptKeys.has(key));
      if (!available.length) continue;
      couponReceiptKeys[item.skuId] = available;
    } else if (uploaded.some(run => run.snapshot.period.startDate === snapshot.period.startDate && run.snapshot.period.endDate === snapshot.period.endDate && weeklySelectedCoupons(run).some(old => old.skuId === item.skuId))) continue;
    couponItems.push(item);
  }
  return { couponItems, couponReceiptKeys };
}
export function assertWeeklyCouponEligibility(workspace: WeeklyWorkspace, run: WeeklyRun): void {
  // An already-uploaded run is historical evidence and remains downloadable.
  if (run.couponUploadedAt) return;
  const eligible = eligibleWeeklyCoupons(workspace, run.snapshot, run.id);
  const selected = { ...run.snapshot, couponItems: weeklySelectedCoupons(run) };
  const selectedEligible = { ...eligible, couponItems: weeklySelectedCoupons({ snapshot: { ...run.snapshot, ...eligible }, couponExcludedSkuIds: run.couponExcludedSkuIds }) };
  if (JSON.stringify(weeklyCouponSelection(selectedEligible)) !== JSON.stringify(weeklyCouponSelection(selected))) {
    throw new Error("다른 주간 업무에서 쿠폰 등록을 완료한 입고 또는 아직 유효하거나 종료일을 확인하지 못한 쿠폰 SKU가 있습니다. 기간 자료를 다시 준비해 주세요.");
  }
}
function hasWeeklyUserReview(run: WeeklyRun, review: WeeklyReview): boolean {
  if (run.reviewedSkuIds) return run.reviewedSkuIds.includes(review.skuId);
  // Older runs predate explicit edit tracking. Retain values that differ from
  // the source defaults without treating every automatically created row as reviewed.
  const item = run.snapshot.vendorItems.find(row => row.skuId === review.skuId);
  if (!item) return false;
  const decision = item.discontinued || item.shortageQuantity > 0 && item.openOrderQuantity >= item.shortageQuantity ? "hold" : "order";
  return review.decision !== decision || review.quantity !== item.suggestedQuantity
    || review.vendorName !== item.vendorName || review.imageUrl !== item.imageUrl
    || review.quantityConfirmed !== (item.issues.length === 0 && Boolean(item.vendorName) && Boolean(item.imageUrl));
}
function unfinishedWeeklyUserReview(run: WeeklyRun, skuId: string): WeeklyReview | undefined {
  const review = run.reviews[skuId];
  if (!review || run.completedAt || !hasWeeklyUserReview(run, review)) return undefined;
  if (review.decision === "order" && (run.sentVendors[review.vendorName] || run.pendingVendorSends?.[review.vendorName])) return undefined;
  if (review.decision === "reorder" && run.reorderRequestedAt) return undefined;
  if (review.decision === "discontinue" && (run.discontinueSubmittedAt || run.discontinueSubmittedSkuIds?.includes(skuId))) return undefined;
  return review;
}
function latestUnfinishedWeeklyUserReview(runs: WeeklyRun[], skuId: string): WeeklyReview | undefined {
  for (const run of runs) {
    // A failed source read is not evidence that this SKU stopped being short.
    // Skip only an explicitly unresolved row with no review or confirmed item.
    // Every normal absence, completed run or reviewed/unreviewed item is a boundary.
    if (!run.completedAt && !run.reviews[skuId]
      && !run.snapshot.vendorItems.some(item => item.skuId === skuId)
      && run.snapshot.unresolvedItems?.some(item => item.skuId === skuId)) continue;
    return unfinishedWeeklyUserReview(run, skuId);
  }
  return undefined;
}
function refreshWeeklyRouteOwnership(workspace: WeeklyWorkspace, run: WeeklyRun, now: string): void {
  let changed = false;
  for (const item of run.snapshot.vendorItems) {
    if (run.routedElsewhereSkuIds?.includes(item.skuId) || run.itemRoutes?.[item.skuId] || run.reviews[item.skuId]?.decision === "reorder"
      || run.vendorQueueTransfers?.some(t => t.lines.some(line => line.skuId === item.skuId)) || run.discontinueQueueRequestIds?.[item.skuId]?.length) continue;
    if (!weeklyFreshVendorItem(item, workspace.runs, run.id)) {
      run.routedElsewhereSkuIds = [...(run.routedElsewhereSkuIds || []), item.skuId]; changed = true;
    }
  }
  if (changed) { run.revision++; run.updatedAt = now; }
}
export function addWeeklyRun(workspace: WeeklyWorkspace, snapshot: WeeklySnapshot): WeeklyRun {
  const existing = workspace.runs.find(run => run.id === snapshot.id);
  if (existing) refreshWeeklyRouteOwnership(workspace, existing, snapshot.createdAt);
  if (existing?.couponUploadedAt) { refreshWeeklyReorderLedger(workspace, existing, snapshot.createdAt); refreshWeeklyDiscontinuedLedger(workspace, existing, snapshot.createdAt); return existing; }
  const eligible = eligibleWeeklyCoupons(workspace, snapshot);
  const excludedCoupons = snapshot.couponItems.length - eligible.couponItems.length;
  snapshot = { ...snapshot, ...eligible, warnings: excludedCoupons ? [...snapshot.warnings, `기등록 입고 또는 유효한 쿠폰·종료일 미확인 SKU ${excludedCoupons}개는 쿠폰 재발행 목록에서 제외했습니다.`] : snapshot.warnings };
  if (existing) {
    if (JSON.stringify(weeklyCouponSelection(existing.snapshot)) !== JSON.stringify(weeklyCouponSelection(snapshot))) {
      existing.snapshot = { ...existing.snapshot, couponItems: snapshot.couponItems, couponReceiptKeys: snapshot.couponReceiptKeys,
        warnings: [...new Set([...existing.snapshot.warnings, ...snapshot.warnings, "다른 주간 업무의 쿠폰 등록 내역을 반영했습니다. 쿠폰 파일을 다시 생성해 주세요."])] };
      existing.couponExcludedSkuIds = existing.couponExcludedSkuIds?.filter(skuId => snapshot.couponItems.some(item => item.skuId === skuId));
      if (existing.generated) existing.generated = { ...existing.generated, couponCount: 0, advertisingCount: 0, advertisingFiles: [], advertisingToken: undefined, reviewToken: weeklyReviewToken(existing) };
      existing.revision++; existing.updatedAt = snapshot.createdAt; existing.completedAt = undefined;
    }
    refreshWeeklyReorderLedger(workspace, existing, snapshot.createdAt);
    refreshWeeklyDiscontinuedLedger(workspace, existing, snapshot.createdAt);
    return existing;
  }
  const routedElsewhereSkuIds: string[] = [];
  snapshot = { ...snapshot, vendorItems: snapshot.vendorItems.map(item => {
    const fresh = weeklyFreshVendorItem(item, workspace.runs, snapshot.id);
    if (!fresh) routedElsewhereSkuIds.push(item.skuId);
    return fresh || item;
  }) };
  const submittedDiscontinued = new Set(workspace.runs.flatMap(run => run.discontinueSubmittedSkuIds || (run.discontinueSubmittedAt ? Object.values(run.reviews).filter(r => r.decision === "discontinue").map(r => r.skuId) : [])));
  const reviews: Record<string, WeeklyReview> = {};
  for (const item of snapshot.vendorItems) {
    const saved = workspace.productOverrides[item.skuId];
    const vendorName = saved?.vendorName || item.vendorName;
    const imageUrl = saved?.imageUrl || item.imageUrl;
    const discontinued = item.discontinued || saved?.discontinued === true;
    reviews[item.skuId] = { skuId: item.skuId, vendorName, imageUrl, quantity: item.suggestedQuantity,
      decision: item.discontinued || submittedDiscontinued.has(item.skuId) ? "hold" : discontinued ? "discontinue" : item.shortageQuantity > 0 && item.openOrderQuantity >= item.shortageQuantity ? "hold" : "order",
      quantityConfirmed: item.issues.length === 0 && Boolean(vendorName) && Boolean(imageUrl) };
  }
  const run: WeeklyRun = { id: snapshot.id, snapshot, reviews, routedElsewhereSkuIds, reviewedSkuIds: [], revision: 0, updatedAt: snapshot.createdAt, sentVendors: {} };
  const priorPeriods = [...workspace.runs].filter(old => old.snapshot.period.startDate === snapshot.period.startDate && old.snapshot.period.endDate === snapshot.period.endDate)
    .sort((a,b)=>Date.parse(b.snapshot.createdAt)-Date.parse(a.snapshot.createdAt) || Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
  const priorPeriod = priorPeriods[0];
  if (priorPeriod?.couponExcludedSkuIds) run.couponExcludedSkuIds = priorPeriod.couponExcludedSkuIds.filter(skuId => snapshot.couponItems.some(item => item.skuId === skuId));
  if (priorPeriod) for (const item of snapshot.vendorItems) {
    const priorReview = latestUnfinishedWeeklyUserReview(priorPeriods, item.skuId);
    if (!priorReview || item.discontinued || submittedDiscontinued.has(item.skuId)) continue;
    const priorItem = priorPeriods.find(old => old.reviews[item.skuId] === priorReview)?.snapshot.vendorItems.find(row => row.skuId === item.skuId);
    if (JSON.stringify(priorItem?.relatedPurchaseOrderNumbers.slice().sort()) !== JSON.stringify(item.relatedPurchaseOrderNumbers.slice().sort())) continue;
    reviews[item.skuId] = { ...priorReview, quantityConfirmed: false };
    run.reviewedSkuIds!.push(item.skuId);
  }
  refreshWeeklyReorderLedger(workspace, run, snapshot.createdAt);
  refreshWeeklyDiscontinuedLedger(workspace, run, snapshot.createdAt);
  workspace.runs.unshift(run);
  return run;
}
function refreshWeeklyDiscontinuedLedger(workspace: WeeklyWorkspace, run: WeeklyRun, now: string): void {
  if (run.completedAt) return;
  const known = new Set(run.snapshot.vendorItems.map(item => item.skuId));
  const next = [...new Set(workspace.runs.filter(other => other.id !== run.id).flatMap(other => other.discontinueSubmittedSkuIds || (other.discontinueSubmittedAt ? Object.values(other.reviews).filter(review => review.decision === "discontinue").map(review => review.skuId) : [])))].filter(skuId => known.has(skuId)).sort();
  if (JSON.stringify(next) === JSON.stringify(run.previouslyDiscontinuedSkuIds || [])) return;
  run.previouslyDiscontinuedSkuIds = next;
  run.revision++; run.updatedAt = now;
  if (run.generated) run.generated = { ...run.generated, reviewToken: weeklyReviewToken(run), vendors: [], discontinueCount: 0 };
}
export function requireWeeklyRun(workspace: WeeklyWorkspace, id: unknown, revision?: unknown): WeeklyRun {
  const run = workspace.runs.find(item => item.id === id);
  if (!run) throw new Error("주간 업무를 다시 열어 주세요.");
  if (revision !== undefined && (!Number.isSafeInteger(revision) || revision !== run.revision)) throw new Error("다른 화면에서 내용이 변경됐습니다. 새로고침 후 다시 확인해 주세요.");
  return run;
}
export function isWeeklyImageUrl(value: string): boolean {
  if (!value) return true;
  if (/^\/api\/wms\/weekly-work\/image\?id=[a-f0-9]{64}$/.test(value)) return true;
  try { const url = new URL(value); return url.protocol === "https:"; } catch { return false; }
}
export function updateWeeklyReviews(workspace: WeeklyWorkspace, run: WeeklyRun, changes: unknown, now: string): void {
  assertWeeklyCurrentRules(run);
  if (!Array.isArray(changes) || changes.length > 5000) throw new Error("검토할 상품 목록을 확인해 주세요.");
  const next = { ...run.reviews };
  const seen = new Set<string>();
  const changed = new Set<string>();
  for (const raw of changes) {
    if (!raw || typeof raw !== "object") throw new Error("검토값이 올바르지 않습니다.");
    const item = raw as WeeklyReview;
    const source = run.snapshot.vendorItems.find(row => row.skuId === item.skuId);
    if (!source || seen.has(item.skuId)) throw new Error("분석 목록에 없는 상품이거나 중복된 상품입니다.");
    seen.add(item.skuId);
    if (typeof item.vendorName !== "string" || item.vendorName.trim().length > 150 || typeof item.imageUrl !== "string" || item.imageUrl.length > 4000 || !isWeeklyImageUrl(item.imageUrl)
      || !["order", "reorder", "hold", "discontinue"].includes(item.decision) || typeof item.quantityConfirmed !== "boolean"
      || !Number.isSafeInteger(item.quantity) || item.quantity < 0 || item.quantity > 100000) throw new Error("거래처·사진·발주수량을 확인해 주세요.");
    const old = run.reviews[item.skuId];
    if (run.itemRoutes?.[item.skuId] && JSON.stringify(old) !== JSON.stringify(item)) throw new Error("이미 대기 목록으로 이동 중이거나 이동한 상품입니다. 해당 목록에서 확인해 주세요.");
    const normalized = { ...item, vendorName: item.vendorName.trim(), imageUrl: item.imageUrl.trim() };
    if (run.pendingDiscontinueSubmission?.skuIds.includes(item.skuId) && JSON.stringify(old) !== JSON.stringify(normalized)) throw new Error("단종 완료 연결을 처리 중입니다. 같은 완료 버튼으로 결과를 확인해 주세요.");
    if (old && old.decision !== "reorder" && !(old.decision === "order" && normalized.decision === "discontinue") && weeklyReviewCompletion(run, old) && JSON.stringify(old) !== JSON.stringify(normalized)) throw new Error("처리 완료한 상품입니다. 완료 이력은 변경할 수 없습니다.");
    if (normalized.decision === "order" && run.vendorQueueTransfers?.some(t => t.lines.some(l => l.skuId === item.skuId)) && JSON.stringify(old) !== JSON.stringify(normalized)) throw new Error("발주대기로 이동한 상품입니다. 거래처 발주대기에서 수정해 주세요.");
    if (old && run.reorderRequestedAt && (old.decision === "reorder" || normalized.decision === "reorder") && JSON.stringify(old) !== JSON.stringify(normalized)) throw new Error("이미 재발주 요청을 완료한 업무입니다. 요청한 내역은 변경할 수 없습니다.");
    if (old?.decision === "order" && run.pendingVendorSends?.[old.vendorName] && JSON.stringify(old) !== JSON.stringify(normalized)) throw new Error("발송한 발주를 입고관리와 연결 중입니다. 연결 확인을 마친 뒤 수정해 주세요.");
    // A sent order is immutable. The same screen can still record a supplier's later discontinuation response.
    if (old?.decision === "order" && (run.sentVendors[old.vendorName] || run.pendingVendorSends?.[old.vendorName]) && JSON.stringify(old) !== JSON.stringify(normalized)
      && !(normalized.decision === "discontinue" && normalized.vendorName === old.vendorName && normalized.quantity === old.quantity && normalized.imageUrl === old.imageUrl)) {
      throw new Error("이미 보낸 발주입니다. 발주 내용 수정은 거래처 발주관리에서 진행해 주세요. 단종 체크는 여기에서 가능합니다.");
    }
    if (source.discontinued && normalized.decision === "order") throw new Error("단종된 SKU입니다. 단종해제를 먼저 처리해 주세요.");
    if (JSON.stringify(old) !== JSON.stringify(normalized)) changed.add(item.skuId);
    next[item.skuId] = normalized;
  }
  if (JSON.stringify(next) === JSON.stringify(run.reviews)) return;
  const priorDiscontinue = Object.values(run.reviews).filter(r => r.decision === "discontinue").map(r => r.skuId).sort().join(",");
  const previouslyReviewed = run.reviewedSkuIds || Object.values(run.reviews).filter(review => hasWeeklyUserReview(run, review)).map(review => review.skuId);
  run.reviewedSkuIds = [...new Set([...previouslyReviewed, ...changed])].sort();
  run.reviews = next;
  const nextDiscontinue = Object.values(next).filter(r => r.decision === "discontinue").map(r => r.skuId).sort().join(",");
  if (priorDiscontinue !== nextDiscontinue) run.discontinueSubmittedAt = undefined;
  for (const skuId of seen) {
    const review = next[skuId];
    const alreadyDiscontinued = run.snapshot.vendorItems.find(i => i.skuId === skuId)?.discontinued || workspace.runs.some(r => r.discontinueSubmittedSkuIds?.includes(skuId));
    workspace.productOverrides[skuId] = { vendorName: review.vendorName, imageUrl: review.imageUrl, discontinued: alreadyDiscontinued || review.decision === "discontinue" };
  }
  run.completedAt = undefined;
  if (run.generated) run.generated = { ...run.generated, reviewToken: weeklyReviewToken(run), vendors: [], discontinueCount: 0, reorderCount: run.reorderRequestedAt ? run.generated.reorderCount : 0, reorderRequestDate: run.reorderRequestedAt ? run.generated.reorderRequestDate : undefined };
  run.revision++; run.updatedAt = now;
}
export function weeklySelectedOrders(run: WeeklyRun): WeeklyReview[] {
  const queued = new Set(run.vendorQueueTransfers?.flatMap(t => t.lines.map(l => l.skuId)) || []);
  return Object.values(run.reviews).filter(review => review.decision === "order" && !run.routedElsewhereSkuIds?.includes(review.skuId) && review.quantity > 0 && !queued.has(review.skuId) && !weeklyReviewCompletion(run, review));
}
export function assertWeeklyOrdersReady(run: WeeklyRun): void {
  const queued = new Set(run.vendorQueueTransfers?.flatMap(t => t.lines.map(l => l.skuId)) || []);
  const bad = Object.values(run.reviews).filter(r => !queued.has(r.skuId) && !run.routedElsewhereSkuIds?.includes(r.skuId) && r.decision === "order" && !weeklyReviewCompletion(run, r) && (!r.vendorName || !r.imageUrl || r.quantity <= 0));
  if (bad.length) throw new Error(`발주 상품 ${bad.length}개의 사진·거래처를 확인해 주세요. 쿠폰은 별도로 받을 수 있습니다.`);
}
export function weeklyVendorLines(run: WeeklyRun, vendorName: string): VendorOrderDraftLine[] {
  const waveId = `WEEKLY-${run.id}`;
  const draftId = `${waveId}::${vendorName}`;
  return weeklySelectedOrders(run).filter(r => r.vendorName === vendorName).map(review => {
    const item = run.snapshot.vendorItems.find(i => i.skuId === review.skuId)!;
    return { id: `${draftId}::${item.skuId}`, draftId, waveId, vendorName, skuId: item.skuId,
      modelName: item.modelName, category: "", optionLabel: item.optionLabel, productName: item.productName,
      imageUrl: review.imageUrl, barcode: item.barcode, actualShortageQuantity: item.shortageQuantity,
      shortageQuantity: review.quantity, currentStock: "", relatedPurchaseOrderNumbers: item.relatedPurchaseOrderNumbers,
      memo: "", isManuallyAdded: false, createdAt: run.snapshot.createdAt, updatedAt: run.snapshot.createdAt };
  });
}
