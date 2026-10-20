import { NextRequest, NextResponse } from "next/server";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { mutateWeeklyWorkspace } from "@/lib/wms/weekly-work-store";
import { lastClearedBatch } from "@/lib/wms/discontinue-lists";

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
export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({ ok: false, error: "입고결과 화면에서 다시 진행해 주세요." }, { status: 403, headers });
  try {
    const body = await request.json() as { action?: unknown; skuId?: unknown; productName?: unknown; kind?: unknown; keys?: unknown };
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
        if (kind === "release") for (const [skuId, check] of Object.entries(current)) if (check.releasedListClearedAt === batch.at) {
          const { releasedListClearedAt: _ignored, ...rest } = check;
          current[skuId] = rest;
        }
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
      return { current, cleared: workspace.statusListCleared || {} };
    });
    return NextResponse.json({ ok: true, supplyStatusChecks: checks.current, statusListCleared: checks.cleared }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "저장하지 못했습니다." }, { status: 400, headers });
  }
}
