import { createHash, randomUUID } from "node:crypto";
import { buildWeeklyOutput, weeklyOutputKey } from "./weekly-work-output";
import { loadWeeklyAdvertisingSelection } from "./weekly-advertising-source";
import { assertWeeklyCouponEligibility, validWeeklyCouponDate, weeklyKoreaDay, weeklyReviewToken } from "./weekly-work-state";
import { LOGISTICS_DISCONTINUE_STATUS_RUN_ID } from "./logistics-discontinue-adapter";
import { weeklyDiscontinueQueueRequestIds } from "./weekly-discontinue-queue";
import { receiptSourceFingerprint, reserveLogisticsReceiptRoute, type RouteLogisticsReceiptInput } from "./logistics-receipt-routing";
import { buildWeeklyReorderWorkbook, nextWeeklyReorderFriday } from "./weekly-reorder-files";
import { currentReorderRows, pendingReorderQueue, reorderDigest, reorderPair } from "./weekly-reorder-queue";
import { savedWeeklyMaterial } from "./saved-weekly-material";
import { logisticsReorderLines } from "./logistics-reorder-material";
import type { LogisticsReceiptBoard, LogisticsReceiptBoardLine, LogisticsReceiptTarget } from "./logistics-receipts";
import type { WeeklyRun, WeeklyWorkspace } from "./weekly-work-types";
import type { LogisticsFollowUpKind, LogisticsFollowUpLine, LogisticsFollowUpProof, LogisticsFollowUpResponse } from "./logistics-follow-up-types";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const now = () => new Date().toISOString();
const sourceKey = (run: WeeklyRun) => run.logisticsReceiptLine?.lineKey || "";
const isMarketing = (run: WeeklyRun) => Boolean(run.logisticsReceiptLine && run.snapshot.couponItems.length);
const isDiscontinue = (run: WeeklyRun) => Boolean(run.logisticsReceiptLine && run.reviews[run.logisticsReceiptLine.skuId]?.decision === "discontinue");
const isReorder = (run: WeeklyRun) => Boolean(run.logisticsReceiptLine && run.reviews[run.logisticsReceiptLine.skuId]?.decision === "reorder");
const isVendor = (run: WeeklyRun) => Boolean(run.logisticsReceiptLine && run.reviews[run.logisticsReceiptLine.skuId]?.decision === "order");

/** Finish only vendor-origin receipt tasks whose exact downstream sources were completed. */
export function completeVendorReceiptOrigins(workspace: WeeklyWorkspace, lineKeys: readonly string[], at = now()) {
  const completed = new Set(lineKeys);
  for (const run of workspace.runs) {
    if (!isVendor(run) || run.completedAt || !completed.has(run.logisticsReceiptLine!.lineKey)) continue;
    run.completedAt = at; run.updatedAt = at; run.revision++;
  }
}

function line(row: LogisticsReceiptBoardLine): LogisticsFollowUpLine {
  return { lineKey: row.lineKey, sourceLineKey: row.sourceLineKey, shipmentNumber: row.shipmentNumber, boxId: row.boxId,
    purchaseOrderNumber: row.purchaseOrderNumber, skuId: row.skuId, productName: row.productName, barcode: row.barcode,
    kind: row.kind, sourceFingerprint: receiptSourceFingerprint(row), state: row.state, route: row.route && { decision: row.route.decision, runId: row.route.runId, completed: row.route.completed } };
}
export function activeMarketingExclusionKeys(workspace: WeeklyWorkspace) { return new Set((workspace.logisticsFollowUp?.exclusions || []).filter(item => !item.restoredAt).map(item => item.lineKey)); }
function allSourceLines(board: LogisticsReceiptBoard) { return new Map(board.lines.map(row => [row.lineKey, row])); }
export function logisticsFollowUpToken(workspace: WeeklyWorkspace, board: LogisticsReceiptBoard): string {
  return hash([workspace.revision, workspace.logisticsReceipts?.collectedAt, board.collectedAt, board.lines.map(row => [row.lineKey, receiptSourceFingerprint(row), row.state, row.route?.runId]), workspace.logisticsFollowUp || {}]);
}
export function logisticsFollowUpResponse(workspace: WeeklyWorkspace, board: LogisticsReceiptBoard): LogisticsFollowUpResponse {
  const excluded = activeMarketingExclusionKeys(workspace), lines = allSourceLines(board);
  const select = (predicate: (run: WeeklyRun) => boolean): LogisticsFollowUpLine[] => workspace.runs.filter(predicate).map(run => lines.get(sourceKey(run))).filter((row): row is LogisticsReceiptBoardLine => Boolean(row)).map(line);
  const marketing = board.lines.filter(row => row.kind === "marketing" && row.state === "ready" && !excluded.has(row.lineKey)).map(line);
  const reorderQueue = pendingReorderQueue(workspace);
  const reorder = reorderQueue.sources.flatMap(source => {
    const run = workspace.runs.find(item => item.id === source.id); const sourceRows = source.kind === "logistics" ? source.rows || [] : reorderQueue.rows.filter(row => source.pairs.includes(reorderPair(row)));
    const receipt = run && logisticsReorderLines(run).find(line => line.lineKey === source.lineKey);
    return sourceRows.map(row => ({ lineKey: source.kind === "logistics" ? source.lineKey! : JSON.stringify([source.id, reorderPair(row)]), sourceLineKey: source.kind === "logistics" ? source.lineKey! : source.id, shipmentNumber: receipt?.shipmentNumber || "", boxId: receipt?.boxId || "", purchaseOrderNumber: row.purchaseOrderNumber, skuId: row.skuId, productName: row.productName, barcode: run?.snapshot.vendorItems.find(item => item.skuId === row.skuId)?.barcode || "", kind: "shortage" as const, sourceFingerprint: reorderDigest([source.id, source.lineKey, row]), state: "ready" as const }));
  });
  return { ok: true, token: logisticsFollowUpToken(workspace, board), collectedAt: board.collectedAt,
    queues: { marketing: select(run => isMarketing(run) && !run.couponUploadedAt && !run.completedAt && !excluded.has(sourceKey(run))).map(row => ({ ...row, blockedReason: workspace.logisticsFollowUp?.blockedMarketingSkuIds?.includes(row.skuId) ? "단종 분류되어 쿠폰·광고 생성이 차단되었습니다." : undefined })), discontinue: select(run => isDiscontinue(run) && !run.discontinueSubmittedAt && !run.discontinueSubmittedSkuIds?.includes(run.logisticsReceiptLine!.skuId) && !run.completedAt), reorder, vendor: select(run => isVendor(run) && !run.completedAt) },
    exclusionHistory: workspace.logisticsFollowUp?.exclusions || [], proofs: workspace.logisticsFollowUp?.proofs || [] };
}
function assertCurrent(workspace: WeeklyWorkspace, board: LogisticsReceiptBoard, token: unknown, collectedAt: unknown) {
  if (typeof token !== "string" || token !== logisticsFollowUpToken(workspace, board) || collectedAt !== board.collectedAt || workspace.logisticsReceipts?.collectedAt !== board.collectedAt) throw new Error("목록이 변경됐습니다. 새로고침 후 다시 확인해 주세요.");
}
function exactKeys(raw: unknown, allowEmpty = false): string[] {
  if (!Array.isArray(raw) || (!allowEmpty && !raw.length) || raw.length > 5000 || raw.some(value => typeof value !== "string")) throw new Error("선택한 쉽먼트 상품을 확인해 주세요.");
  const result = [...new Set(raw)]; if (result.length !== raw.length) throw new Error("중복 선택된 쉽먼트 상품이 있습니다."); return result;
}
export function queueMarketing(workspace: WeeklyWorkspace, targets: LogisticsReceiptTarget[], board: LogisticsReceiptBoard, input: { token: unknown; expectedCollectedAt: unknown; lineKeys: unknown; excludedLineKeys?: unknown; confirmMarketing?: unknown }, at = now()) {
  assertCurrent(workspace, board, input.token, input.expectedCollectedAt);
  if (input.confirmMarketing !== true) throw new Error("초도 입고 후보 검토를 확인해 주세요.");
  const selected = exactKeys(input.lineKeys, true); const excluded = input.excludedLineKeys === undefined ? [] : exactKeys(input.excludedLineKeys, true);
  if (!selected.length && !excluded.length) throw new Error("선택 또는 제외할 초도 입고 후보를 확인해 주세요.");
  if (selected.some(key => excluded.includes(key))) throw new Error("선택과 제외 목록이 겹칩니다.");
  const candidates = new Map(board.lines.filter(row => row.kind === "marketing" && row.state === "ready" && !activeMarketingExclusionKeys(workspace).has(row.lineKey)).map(row => [row.lineKey, row]));
  if ([...selected, ...excluded].some(key => !candidates.has(key))) throw new Error("현재 초도 입고 후보만 선택 또는 제외할 수 있습니다.");
  // Validate the entire batch against a copy before creating any source run.
  const copy = structuredClone(workspace);
  for (const key of selected) reserveLogisticsReceiptRoute(copy, targets, { lineKey: key, decision: "marketing", expectedCollectedAt: board.collectedAt!, confirmMarketing: true } as RouteLogisticsReceiptInput, undefined, at);
  for (const key of selected) {
    const reserved = reserveLogisticsReceiptRoute(workspace, targets, { lineKey: key, decision: "marketing", expectedCollectedAt: board.collectedAt!, confirmMarketing: true } as RouteLogisticsReceiptInput, undefined, at);
    const skuId = reserved.run.logisticsReceiptLine!.skuId;
    reserved.run.snapshot.couponReceiptKeys = { ...reserved.run.snapshot.couponReceiptKeys,
      [skuId]: [...new Set([...(reserved.run.snapshot.couponReceiptKeys?.[skuId] || []), reserved.run.logisticsReceiptLine!.lineKey])] };
  }
  if (excluded.length) {
    const history = workspace.logisticsFollowUp?.exclusions || [];
    workspace.logisticsFollowUp = { ...workspace.logisticsFollowUp, exclusions: [...history, ...excluded.map(key => ({ lineKey: key, sourceFingerprint: receiptSourceFingerprint(candidates.get(key)!), skuId: candidates.get(key)!.skuId, at }))] };
  }
  return logisticsFollowUpResponse(workspace, board);
}
export function setMarketingExclusion(workspace: WeeklyWorkspace, board: LogisticsReceiptBoard, input: { token: unknown; expectedCollectedAt: unknown; lineKeys: unknown }, restore: boolean, at = now()) {
  assertCurrent(workspace, board, input.token, input.expectedCollectedAt); const keys = exactKeys(input.lineKeys); const rows = allSourceLines(board);
  const history = [...(workspace.logisticsFollowUp?.exclusions || [])];
  for (const key of keys) {
    const item = [...history].reverse().find(value => value.lineKey === key && !value.restoredAt);
    if (restore) { if (!item) throw new Error("복원할 제외 이력이 없습니다."); if (workspace.logisticsFollowUp?.blockedMarketingSkuIds?.includes(item.skuId)) throw new Error("단종 분류된 SKU는 마케팅 후보로 복원할 수 없습니다."); item.restoredAt = at; continue; }
    const row = rows.get(key); if (!row || row.kind !== "marketing" || item || row.state !== "ready") throw new Error("현재 초도 입고 후보만 제외할 수 있습니다.");
    history.push({ lineKey: key, sourceFingerprint: receiptSourceFingerprint(row), skuId: row.skuId, at });
  }
  workspace.logisticsFollowUp = { ...workspace.logisticsFollowUp, exclusions: history };
  return logisticsFollowUpResponse(workspace, board);
}
function batchRuns(workspace: WeeklyWorkspace, board: LogisticsReceiptBoard, kind: "marketing" | "discontinue") {
  const rows = allSourceLines(board); const excluded = activeMarketingExclusionKeys(workspace); const rejectedSku = new Set([...(workspace.logisticsFollowUp?.blockedMarketingSkuIds || []), ...workspace.runs.filter(isDiscontinue).map(run => run.logisticsReceiptLine!.skuId)]);
  const candidates = workspace.runs.filter(kind === "marketing" ? isMarketing : isDiscontinue).filter(run => !run.completedAt && (kind === "marketing" ? !run.couponUploadedAt && !excluded.has(sourceKey(run)) : !run.discontinueSubmittedAt && !run.discontinueSubmittedSkuIds?.includes(run.logisticsReceiptLine!.skuId)));
  const invalid = candidates.find(run => { if (!run.logisticsReceiptLine) return false; const row = rows.get(sourceKey(run)); return !row || row.state === "review" || receiptSourceFingerprint(row) !== workspace.logisticsReceiptRoutes?.[sourceKey(run)]?.sourceFingerprint; });
  if (invalid) throw new Error("쉽먼트 출처 수량이 바뀌었거나 재검토가 필요합니다. 목록을 새로고침해 주세요.");
  const source = candidates.filter(run => {
    if (kind === "marketing" && (run.couponUploadedAt || rejectedSku.has(run.logisticsReceiptLine!.skuId))) return false;
    if (kind === "discontinue" && (run.discontinueSubmittedSkuIds?.includes(run.logisticsReceiptLine!.skuId) || run.discontinueSubmittedAt)) return false;
    if (!run.logisticsReceiptLine) return true;
    const row = rows.get(sourceKey(run)); return Boolean(row && row.state !== "review" && receiptSourceFingerprint(row) === (workspace.logisticsReceiptRoutes?.[sourceKey(run)]?.sourceFingerprint));
  });
  if (kind === "marketing" && candidates.some(run => !run.couponUploadedAt && !run.completedAt && rejectedSku.has(run.logisticsReceiptLine!.skuId))) throw new Error("단종 분류된 쿠폰·광고 후보가 있습니다. 목록을 확인해 주세요.");
  const deduped = kind === "marketing" ? source.filter((run, index, all) => all.findIndex(other => other.logisticsReceiptLine!.skuId === run.logisticsReceiptLine!.skuId) === index) : source;
  return deduped;
}
function transientRun(runs: WeeklyRun[], kind: "marketing" | "discontinue"): WeeklyRun {
  const items = runs.map(run => kind === "marketing" ? run.snapshot.couponItems[0] : run.snapshot.vendorItems[0]);
  const reviews = Object.fromEntries(runs.map(run => [run.logisticsReceiptLine!.skuId, { ...run.reviews[run.logisticsReceiptLine!.skuId], decision: "discontinue" as const }]));
  const id = `LOGISTICS-FOLLOWUP-${hash([kind, runs.map(sourceKey)]).slice(0, 24)}`;
  const couponReceiptKeys = kind === "marketing" ? Object.fromEntries(runs.map(run => [run.logisticsReceiptLine!.skuId, [sourceKey(run)]])) : undefined;
  return { id, revision: 0, updatedAt: now(), sentVendors: {},
    snapshot: { id, rulesVersion: 5, sourceToken: hash(runs.map(sourceKey)), createdAt: now(), period: { startDate: weeklyKoreaDay(), endDate: weeklyKoreaDay() }, source: { files: [], latestActualDate: "", firstActualDate: "", eventCount: 0, duplicateCount: 0, selectedEventCount: 0, mode: "browser" }, couponItems: kind === "marketing" ? items as any : [], couponReceiptKeys, vendorItems: kind === "discontinue" ? items as any : [], warnings: [], blockers: [] }, reviews, reviewedSkuIds: Object.keys(reviews), itemRoutes: {} };
}
export async function generateLogisticsFollowUp(workspace: WeeklyWorkspace, board: LogisticsReceiptBoard, input: { token: unknown; expectedCollectedAt: unknown; kind: unknown }, deps: Partial<{ loadWeeklyAdvertisingSelection: typeof loadWeeklyAdvertisingSelection; buildWeeklyOutput: typeof buildWeeklyOutput; buildWeeklyReorderWorkbook: typeof buildWeeklyReorderWorkbook }> = {}) {
  const services = { loadWeeklyAdvertisingSelection, buildWeeklyOutput, buildWeeklyReorderWorkbook, ...deps };
  assertCurrent(workspace, board, input.token, input.expectedCollectedAt); const kind = input.kind;
  if (kind !== "marketing" && kind !== "discontinue" && kind !== "reorder") throw new Error("생성할 후속 업무를 확인해 주세요.");
  if (kind === "reorder") {
    const queue = pendingReorderQueue(workspace); if (!queue.rows.length || queue.issues.length) throw new Error(queue.issues.length ? "재검토가 필요한 재발주 항목을 먼저 확인해 주세요." : "생성할 재발주 요청이 없습니다.");
    const rows = queue.rows.map(row => queue.logisticsPairs.includes(reorderPair(row)) ? row : currentReorderRows([row], (() => { const material = savedWeeklyMaterial(workspace, row.skuId, [row.purchaseOrderNumber]); return { ...material.snapshot, vendorItems: [material.item] }; })())[0]);
    const date = nextWeeklyReorderFriday(); const buffer = await services.buildWeeklyReorderWorkbook(rows, new Date());
    const sourceRows = queue.sources.flatMap(source => (source.kind === "logistics" ? source.rows || [] : rows.filter(row => source.pairs.includes(reorderPair(row)))).map(row => ({ sourceId: source.id, pair: reorderPair(row), sourceLineKey: source.kind === "logistics" ? source.lineKey : undefined, purchaseOrderNumber: row.purchaseOrderNumber, skuId: row.skuId, shortageQuantity: row.shortageQuantity })));
    const outputKey = hash(["logistics-followup-reorder", queue.token, rows, date, randomUUID()]);
    const proof: LogisticsFollowUpProof = { kind, outputKey, fileName: `재발주요청_${date}.xlsx`, at: now(), token: logisticsFollowUpToken(workspace, board), sourceKeys: sourceRows.map(row => JSON.stringify([row.sourceId, row.pair, row.sourceLineKey || ""])), sourceFingerprints: sourceRows.map(row => reorderDigest(row)), couponCount: 0, discontinueCount: 0, advertisingCount: 0, advertisingFiles: [], reorderRows: sourceRows };
    const output = { fileName: proof.fileName, base64: buffer.toString("base64"), generated: { at: proof.at, reviewToken: queue.token, couponCount: 0, vendors: [], discontinueCount: 0, reorderCount: rows.length } };
    return { fileName: output.fileName, base64: output.base64, outputKey, proof, saved: { output, proof, digest: hash([output.fileName, output.base64, output.generated, proof]) } };
  }
  const runs = batchRuns(workspace, board, kind);
  const statusRun = kind === "discontinue" ? workspace.runs.find(item => item.id === LOGISTICS_DISCONTINUE_STATUS_RUN_ID) : undefined;
  const statusSkuIds = statusRun ? Object.values(statusRun.reviews).filter(review => review.decision === "discontinue" && statusRun.discontinueQueueRequestIds?.[review.skuId]?.length && !statusRun.discontinueSubmittedSkuIds?.includes(review.skuId)).map(review => review.skuId).sort() : [];
  const requestIds = statusRun ? weeklyDiscontinueQueueRequestIds(statusRun, statusSkuIds) : [];
  if (!runs.length && !requestIds.length) throw new Error(kind === "marketing" ? "생성할 쿠폰·광고 후보가 없습니다." : "생성할 단종 후보가 없습니다.");
  const run = transientRun(runs, kind);
  if (statusRun && requestIds.length) {
    for (const skuId of statusSkuIds) {
      const item = statusRun.snapshot.vendorItems.find(item => item.skuId === skuId);
      if (!item) throw new Error("단종 대기 상품 정보를 확인하지 못했습니다.");
      if (!run.snapshot.vendorItems.some(item => item.skuId === skuId)) run.snapshot.vendorItems.push(structuredClone(item));
      run.reviews[skuId] = { ...statusRun.reviews[skuId], decision: "discontinue" };
    }
    run.reviewedSkuIds = Object.keys(run.reviews);
  }
  const advertising = kind === "marketing" ? await services.loadWeeklyAdvertisingSelection(run) : undefined;
  if (kind === "marketing") assertWeeklyCouponEligibility(workspace, run);
  const output = await services.buildWeeklyOutput(run, kind === "marketing" ? "marketing" : "discontinue", new Date(), advertising);
  const baseKey = weeklyOutputKey(run, kind === "marketing" ? "marketing" : "discontinue", new Date(), advertising?.token);
  // Every saved output is immutable; repeat generation must not share a writable artifact key.
  const outputKey = hash([baseKey, output.fileName, output.base64, randomUUID()]);
  const proof: LogisticsFollowUpProof = { kind, outputKey, fileName: output.fileName, at: now(), token: logisticsFollowUpToken(workspace, board), sourceKeys: runs.map(sourceKey), sourceFingerprints: runs.map(run => workspace.logisticsReceiptRoutes?.[sourceKey(run)]?.sourceFingerprint || ""), couponCount: output.generated.couponCount, discontinueCount: output.generated.discontinueCount, advertisingCount: output.generated.advertisingCount || 0, advertisingFiles: output.generated.advertisingFiles || [] };
  if (statusRun && requestIds.length) {
    proof.requestIds = requestIds;
    proof.requestSkuIds = statusSkuIds;
    proof.discontinueReviewToken = weeklyReviewToken(statusRun);
    proof.sourceKeys.push(...requestIds.map(id => `status::${id}`));
  }
  const digest = hash([output.fileName, output.base64, output.generated, proof]);
  return { fileName: output.fileName, base64: output.base64, outputKey, proof, saved: { output, proof, digest } };
}
export function completeLogisticsFollowUp(workspace: WeeklyWorkspace, board: LogisticsReceiptBoard, input: { token: unknown; expectedCollectedAt: unknown; kind: unknown; outputKey: unknown; confirmCoupon?: unknown; confirmAdvertising?: unknown; confirmSubmitted?: unknown; confirmRequested?: unknown; couponStartsOn?: unknown; couponExpiresOn?: unknown; validatedSavedProof?: LogisticsFollowUpProof }, at = now()) {
  assertCurrent(workspace, board, input.token, input.expectedCollectedAt); if (input.kind !== "marketing" && input.kind !== "discontinue" && input.kind !== "reorder" || typeof input.outputKey !== "string") throw new Error("완료할 생성 파일을 확인해 주세요.");
  const proof = workspace.logisticsFollowUp?.proofs?.find(item => item.kind === input.kind && item.outputKey === input.outputKey); if (!proof) throw new Error("현재 목록으로 생성한 완료 전 파일을 확인해 주세요.");
  if (proof.completedAt) return proof;
  if (!input.validatedSavedProof || JSON.stringify(input.validatedSavedProof) !== JSON.stringify(proof)) throw new Error("생성 파일 증빙이 현재 완료 대상과 일치하지 않습니다.");
  if (input.kind === "reorder") {
    if (input.confirmRequested !== true || !proof.reorderRows?.length) throw new Error("재발주 요청 완료를 확인해 주세요.");
    const queue = pendingReorderQueue(workspace);
    for (const row of proof.reorderRows) {
      const source = queue.sources.find(item => item.id === row.sourceId && item.pairs.includes(row.pair) && (!row.sourceLineKey || item.lineKey === row.sourceLineKey));
      if (!source) throw new Error("생성 후 재발주 출처가 변경됐습니다. 파일을 다시 생성해 주세요.");
      const current = source.kind === "logistics" ? source.rows?.find(item => reorderPair(item) === row.pair) : (() => {
        const material = savedWeeklyMaterial(workspace, row.skuId, [row.purchaseOrderNumber]);
        return currentReorderRows([{ purchaseOrderNumber: row.purchaseOrderNumber, skuId: row.skuId, productName: row.skuId, shortageQuantity: row.shortageQuantity }], { ...material.snapshot, vendorItems: [material.item] })[0];
      })();
      if (!current || current.shortageQuantity !== row.shortageQuantity || current.skuId !== row.skuId || current.purchaseOrderNumber !== row.purchaseOrderNumber) throw new Error("생성 후 재발주 출처가 변경됐습니다. 파일을 다시 생성해 주세요.");
    }
    for (const row of proof.reorderRows) {
      const run = workspace.runs.find(item => item.id === row.sourceId); if (!run) throw new Error("재발주 출처 업무를 찾지 못했습니다.");
      const source = queue.sources.find(item => item.id === row.sourceId && item.pairs.includes(row.pair) && (!row.sourceLineKey || item.lineKey === row.sourceLineKey));
      const requested = new Map((run.reorderRequestedLines || []).map(item => [reorderPair(item), item]));
      requested.set(row.pair, { purchaseOrderNumber: row.purchaseOrderNumber, skuId: row.skuId,
        shortageQuantity: row.shortageQuantity + (source?.kind === "logistics" ? requested.get(row.pair)?.shortageQuantity || 0 : 0) });
      run.reorderRequestedLines = [...requested.values()]; run.reorderQueuePartialRequestedAt = at; run.revision++; run.updatedAt = at;
      if (source?.kind === "logistics" && source.lineKey) run.reorderRequestedShipmentLineKeys = [...new Set([...(run.reorderRequestedShipmentLineKeys || []), source.lineKey])];
    }
    const after = pendingReorderQueue(workspace);
    for (const id of [...new Set(proof.reorderRows.map(row => row.sourceId))]) {
      const run = workspace.runs.find(item => item.id === id)!;
      const receipts = logisticsReorderLines(run);
      const complete = receipts.length ? receipts.every(line => run.reorderRequestedShipmentLineKeys?.includes(line.lineKey)) : !after.sources.some(source => source.id === id);
      if (complete) { run.reorderRequestedAt = at; run.reorderQueuePartialRequestedAt = undefined; }
    }
    completeVendorReceiptOrigins(workspace, proof.reorderRows.flatMap(row => {
      const source = queue.sources.find(item => item.id === row.sourceId && item.pairs.includes(row.pair) && (!row.sourceLineKey || item.lineKey === row.sourceLineKey));
      return source?.lineKey ? [source.lineKey] : [];
    }), at);
    proof.completedAt = at; return proof;
  }
  if (input.kind === "marketing") {
    if (input.confirmCoupon !== true || input.confirmAdvertising !== true || !validWeeklyCouponDate(input.couponStartsOn) || !validWeeklyCouponDate(input.couponExpiresOn) || input.couponExpiresOn < weeklyKoreaDay() || input.couponStartsOn > input.couponExpiresOn) throw new Error("쿠폰·광고 등록 확인과 유효한 쿠폰 날짜를 입력해 주세요.");
  } else if (input.confirmSubmitted !== true) throw new Error("단종 신청 완료를 확인해 주세요.");
  const rows = allSourceLines(board); const receiptKeys = proof.sourceKeys.filter(key => !key.startsWith("status::")); const sourceRuns = receiptKeys.map(key => workspace.runs.find(run => sourceKey(run) === key)).filter((run): run is WeeklyRun => Boolean(run));
  if (sourceRuns.length !== receiptKeys.length || sourceRuns.some((run, index) => { const row = rows.get(sourceKey(run)); return !row || row.state === "review" || receiptSourceFingerprint(row) !== proof.sourceFingerprints[index]; })) throw new Error("생성 후 쉽먼트 출처가 바뀌었습니다. 파일을 다시 생성해 주세요.");
  for (const run of sourceRuns) {
    if (input.kind === "marketing") { run.couponUploadedAt ||= at; run.couponStartsOn = input.couponStartsOn as string | undefined; run.couponExpiresOn = input.couponExpiresOn as string; }
    else { const skuId = run.logisticsReceiptLine!.skuId; run.discontinueSubmittedSkuIds = [...new Set([...(run.discontinueSubmittedSkuIds || []), skuId])]; run.discontinueSubmittedAt ||= at; }
    run.completedAt ||= at; run.revision++; run.updatedAt = at;
  }
  proof.completedAt = at; return proof;
}
