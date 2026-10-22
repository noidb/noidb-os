import { readWeeklyWorkspace } from "./weekly-work-store";
import { readPickingWaveStore } from "./picking-wave/server-store";
import { listStatusRequests } from "./vendor-order-actions";
import { readDiscontinueCodeDraft } from "./discontinue-code-draft-store";
import { clearedSkuId } from "./discontinue-lists";

/**
 * 사이트 곳곳에 남은 '단종으로 보낸' 기록을 SKU별로 모은다(읽기 전용, 2026-10-22).
 * 주간업무·입고결과·단종 대상 목록·거래처발주·단종해제이력 시트. 반환: SKU → "경로@날짜" 모음.
 */
export async function collectSiteDiscontinueHistory(): Promise<{ events: Map<string, Set<string>>; errors: string[] }> {

  const events = new Map<string, Set<string>>();
  const add = (skuId: unknown, source: string, at?: unknown) => {
    const id = String(skuId ?? "").trim();
    if (!/^\d{5,20}$/.test(id)) return;
    const day = typeof at === "string" && at ? at.slice(0, 10) : "";
    if (!events.has(id)) events.set(id, new Set());
    events.get(id)!.add(day ? `${source}@${day}` : source);
  };
  const errors: string[] = [];
  const [workspace, store, requests, draft] = await Promise.all([
    readWeeklyWorkspace().catch(error => { errors.push(`주간업무: ${error instanceof Error ? error.message : error}`); return null; }),
    readPickingWaveStore().catch(error => { errors.push(`발주저장소: ${error instanceof Error ? error.message : error}`); return null; }),
    listStatusRequests().catch(error => { errors.push(`단종해제이력: ${error instanceof Error ? error.message : error}`); return []; }),
    readDiscontinueCodeDraft().catch(() => ({ text: "", savedAt: "" })),
  ]);
  for (const request of requests) if (String(request.requestType || "").includes("단종") && !String(request.requestType || "").includes("해제")) add(request.skuId, "단종해제이력시트", request.requestedAt);
  if (workspace) {
    for (const [skuId, check] of Object.entries(workspace.supplyStatusChecks || {})) if (check.decision === "discontinued") add(skuId, "입고결과_단종확인", check.at);
    for (const [key, at] of Object.entries(workspace.statusListCleared?.discontinue || {})) add(clearedSkuId(key), "단종대상_목록비우기", at);
    for (const [skuId, at] of Object.entries(workspace.statusListRequested?.discontinue || {})) add(skuId, "단종대상_신청완료", at);
    for (const [skuId, value] of Object.entries(workspace.productOverrides || {})) if (value?.discontinued) add(skuId, "주간업무_단종표시");
    for (const proof of workspace.logisticsFollowUp?.proofs || []) if (proof.kind === "discontinue") for (const skuId of proof.requestSkuIds || []) add(skuId, "입고결과_단종서류", proof.at);
    for (const run of workspace.runs || []) {
      for (const skuId of run.discontinueSubmittedSkuIds || []) add(skuId, "주간업무_단종신청", run.discontinueSubmittedAt || run.updatedAt);
      for (const check of run.discontinueSubmissionChecks || []) add(check.skuId, "주간업무_단종신청확인", check.submittedAt);
      for (const skuId of run.generated?.discontinueSkuIds || []) add(skuId, "주간업무_단종파일", run.generated?.at);
      for (const skuId of run.previouslyDiscontinuedSkuIds || []) add(skuId, "주간업무_이전단종", run.updatedAt);
      for (const [skuId, review] of Object.entries(run.reviews || {})) if (review?.decision === "discontinue") add(skuId, "주간업무_단종분류", run.updatedAt);
      for (const [skuId, route] of Object.entries(run.itemRoutes || {})) if (route?.decision === "discontinue") add(skuId, "주간업무_단종분류", route.at);
      if (run.actualInboundRoute?.decision === "discontinue") for (const line of [run.logisticsReceiptLine, ...(run.logisticsReceiptLines || [])]) if (line) add(line.skuId, "입고결과_단종분류", run.actualInboundRoute.at);
    }
  }
  if (store) for (const line of store.vendorOrderLines || []) if (line.sentResolution?.kind === "discontinue") add(line.skuId, "거래처발주_단종으로이동", line.sentResolution.at);
  for (const code of String(draft.text || "").split(/\s+/)) add(code, "단종신청목록_지금입력칸", draft.savedAt);
  return { events, errors };
}
