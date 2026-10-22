import { NextRequest, NextResponse } from "next/server";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { mutateWeeklyWorkspace, readWeeklyWorkspace } from "@/lib/wms/weekly-work-store";
import { clearedSkuId, lastClearedBatch } from "@/lib/wms/discontinue-lists";
import { logDiscontinue } from "@/lib/wms/discontinue-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/**
 * 공급상태가 정상이 아닌 SKU 확인:
 * - discontinued: 단종이 맞음 → 목록에서 뺀다
 * - release: 단종해제 대상 → 복사용 '단종해제 대상' 목록에 모은다
 * - undo: 확인을 되돌린다
 * - clear-release: 단종해제 대상 목록을 처리완료로 비운다(기록은 남김)
 */
/** 읽기 전용: 마지막으로 한꺼번에 비운 단종·단종해제 묶음(시각·건수)만 알려 준다(되살리기 확인용). */
export async function GET() {
  try {
    const workspace = await readWeeklyWorkspace();
    const info = Object.fromEntries((["discontinue", "release"] as const).map(kind => {
      const batch = lastClearedBatch(workspace.statusListCleared?.[kind]);
      return [kind, batch ? { at: batch.at, count: batch.keys.length, total: Object.keys(workspace.statusListCleared?.[kind] || {}).length } : null];
    }));
    return NextResponse.json({ ok: true, lastCleared: info }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "읽지 못했습니다." }, { status: 500, headers });
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({ ok: false, error: "입고결과 화면에서 다시 진행해 주세요." }, { status: 403, headers });
  try {
    const body = await request.json() as { action?: unknown; skuId?: unknown; productName?: unknown; kind?: unknown; keys?: unknown; skuIds?: unknown };
    const at = new Date().toISOString();
    const checks = await mutateWeeklyWorkspace(workspace => {
      const current = { ...(workspace.supplyStatusChecks || {}) };
      if (body.action === "clear-list") {
        // 단종·단종해제 대상 목록 처리완료: 보이던 항목 키를 기록해 숨긴다(상태가 바뀌면 다시 나타남).
        const kind = body.kind === "discontinue" ? "discontinue" : body.kind === "release" ? "release" : "";
        const keys = Array.isArray(body.keys) ? body.keys.filter((key): key is string => typeof key === "string" && key.length <= 400).slice(0, 5000) : [];
        if (!kind || !keys.length) throw new Error("비울 목록을 확인해 주세요.");
        const cleared = { ...(workspace.statusListCleared || {}) };
        cleared[kind] = { ...(cleared[kind] || {}), ...Object.fromEntries(keys.map(key => [key, at])) };
        workspace.statusListCleared = cleared;
        // 비운 SKU의 '신청완료' 표시도 지운다. 되살리기를 누르면 함께 돌아오도록 따로 보관한다.
        const requested = { ...(workspace.statusListRequested?.[kind] || {}) };
        const pruned: Record<string, string> = {};
        for (const skuId of keys.map(clearedSkuId)) if (requested[skuId]) { pruned[skuId] = requested[skuId]; delete requested[skuId]; }
        workspace.statusListRequested = { ...(workspace.statusListRequested || {}), [kind]: requested };
        workspace.statusListRequestedPruned = { ...(workspace.statusListRequestedPruned || {}), [kind]: { at, marks: pruned } };
        if (kind === "release") for (const [skuId, check] of Object.entries(current)) if (check.decision === "release" && !check.releasedListClearedAt) current[skuId] = { ...check, releasedListClearedAt: at };
      } else if (body.action === "clear-one") {
        // 단종해제 승인(정상전환)을 확인한 SKU 하나만 목록에서 지운다(2026-10-19). 다른 화면 선택 SKU는 그대로 둔다.
        const kind = body.kind === "discontinue" ? "discontinue" : body.kind === "release" ? "release" : "";
        const key = Array.isArray(body.keys) && typeof body.keys[0] === "string" && body.keys[0].length <= 400 ? body.keys[0] : "";
        const skuId = typeof body.skuId === "string" && /^\d{1,20}$/.test(body.skuId) ? body.skuId : "";
        if (!kind || !key || !skuId) throw new Error("지울 SKU를 확인해 주세요.");
        const cleared = { ...(workspace.statusListCleared || {}) };
        cleared[kind] = { ...(cleared[kind] || {}), [key]: at };
        workspace.statusListCleared = cleared;
        const requested = { ...(workspace.statusListRequested?.[kind] || {}) };
        delete requested[skuId];
        workspace.statusListRequested = { ...(workspace.statusListRequested || {}), [kind]: requested };
        const check = current[skuId];
        if (kind === "release" && check?.decision === "release" && !check.releasedListClearedAt) current[skuId] = { ...check, releasedListClearedAt: at };
      } else if (body.action === "restore-last-clear") {
        // 실수로 비운 목록 되살리기(2026-10-20): 가장 최근에 같은 시각으로 비운 묶음만 기록에서 지운다.
        // 그 전에 하나씩 '삭제'한 SKU(승인 확인한 것)는 시각이 달라 그대로 숨겨 둔다.
        const kind = body.kind === "discontinue" ? "discontinue" : body.kind === "release" ? "release" : "";
        if (!kind) throw new Error("되살릴 목록을 확인해 주세요.");
        const cleared = { ...(workspace.statusListCleared || {}) };
        const batch = lastClearedBatch(cleared[kind]);
        if (!batch) throw new Error("되살릴 목록이 없습니다.");
        const kept = { ...(cleared[kind] || {}) };
        for (const key of batch.keys) delete kept[key];
        cleared[kind] = kept;
        workspace.statusListCleared = cleared;
        const pruned = workspace.statusListRequestedPruned?.[kind];
        if (pruned?.at === batch.at) {
          workspace.statusListRequested = { ...(workspace.statusListRequested || {}), [kind]: { ...(workspace.statusListRequested?.[kind] || {}), ...pruned.marks } };
          workspace.statusListRequestedPruned = { ...(workspace.statusListRequestedPruned || {}), [kind]: undefined };
        }
        if (kind === "release") for (const [skuId, check] of Object.entries(current)) if (check.releasedListClearedAt === batch.at) {
          const { releasedListClearedAt: _ignored, ...rest } = check;
          current[skuId] = rest;
        }
      } else if (body.action === "mark-requested" || body.action === "unmark-requested") {
        // 단종해제 신청 완료(2026-10-20): 목록은 그대로 두고 신청 시각만 남긴다 → 화면에서 색으로 구분.
        const kind = body.kind === "discontinue" ? "discontinue" : body.kind === "release" ? "release" : "";
        const skuIds = Array.isArray(body.skuIds) ? body.skuIds.filter((id): id is string => typeof id === "string" && /^\d{1,20}$/.test(id)).slice(0, 5000) : [];
        if (!kind || !skuIds.length) throw new Error("신청완료로 표시할 SKU를 확인해 주세요.");
        const requested = { ...(workspace.statusListRequested?.[kind] || {}) };
        if (body.action === "mark-requested") { for (const skuId of skuIds) if (!requested[skuId]) requested[skuId] = at; }
        else for (const skuId of skuIds) delete requested[skuId];
        workspace.statusListRequested = { ...(workspace.statusListRequested || {}), [kind]: requested };
      } else if (body.action === "add-release") {
        // 단종해제 대상에 SKU 직접 추가(2026-10-22): 입고결과에 없는 SKU도 번호만 붙여넣어 넣는다.
        // 화면에서 '단종해제'를 누른 것과 같은 기록이라 엑셀·신청완료·삭제가 똑같이 동작한다.
        const skuIds = Array.isArray(body.skuIds) ? [...new Set(body.skuIds.filter((id): id is string => typeof id === "string" && /^\d{1,20}$/.test(id)))].slice(0, 2000) : [];
        if (!skuIds.length) throw new Error("추가할 SKU ID(숫자)를 확인해 주세요.");
        for (const skuId of skuIds) current[skuId] = { decision: "release", productName: current[skuId]?.decision === "release" ? current[skuId].productName : "", at, manual: true };
      } else if (body.action === "clear-release") {
        for (const [skuId, check] of Object.entries(current)) if (check.decision === "release" && !check.releasedListClearedAt) current[skuId] = { ...check, releasedListClearedAt: at };
      } else {
        const skuId = typeof body.skuId === "string" && /^\d{1,20}$/.test(body.skuId) ? body.skuId : "";
        if (!skuId) throw new Error("SKU를 확인해 주세요.");
        if (body.action === "undo") delete current[skuId];
        else if (body.action === "discontinued" || body.action === "release") {
          current[skuId] = { decision: body.action, productName: typeof body.productName === "string" ? body.productName.slice(0, 300) : "", at };
        } else throw new Error("처리 방법을 확인해 주세요.");
      }
      workspace.supplyStatusChecks = current;
      return { current, cleared: workspace.statusListCleared || {}, requested: workspace.statusListRequested || {} };
    });
    if (body.action === "discontinued" && typeof body.skuId === "string") await logDiscontinue([body.skuId], "입고결과 단종확인");
    if (body.action === "clear-list" && body.kind === "discontinue" && Array.isArray(body.keys)) await logDiscontinue(body.keys.filter((key): key is string => typeof key === "string").map(clearedSkuId), "단종 대상 목록 신청완료");
    return NextResponse.json({ ok: true, supplyStatusChecks: checks.current, statusListCleared: checks.cleared, statusListRequested: checks.requested }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "저장하지 못했습니다." }, { status: 400, headers });
  }
}
