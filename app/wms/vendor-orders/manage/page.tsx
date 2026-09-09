"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { VendorQueueEditingContext } from "@/lib/wms/vendor-order/queue-editing-context";
import { requestVendorJson } from "@/lib/wms/vendor-order/request-json";
const QueueEditor = dynamic(() => import("../../picking/waves/[waveId]/vendor-orders/VendorOrderEditor"), { loading: () => <p>발주서를 불러오는 중…</p> });
import { deriveVendorOrderDrafts } from "@/lib/wms/vendor-order/derive-drafts";
import type { PickingWaveStoreSnapshot } from "@/lib/wms/picking-wave/shared-store-types";
import { useVendorOrderRepository } from "@/lib/wms/vendor-order/context";
import {
  MANUAL_VENDOR_WORKSPACE_ID,
  UNASSIGNED_VENDOR_NAME,
  VENDOR_ORDER_STATUS_LABEL,
  type VendorOrderDraft,
  type VendorOrderDraftLine,
  type VendorOrderDraftStatus,
} from "@/lib/wms/vendor-order/types";
import type { PickingWave } from "@/lib/wms/picking-wave/types";
import { PICKING_WAVE_STATUS_LABEL } from "@/lib/wms/picking-wave/status-label";
import { WMS_MOBILE_WIDTH, wmsColors, wmsPrimaryButton, wmsGhostButton } from "@/lib/wms/ui-tokens";
import { useWmsUndo } from "@/lib/wms/undo-context";

/** Current vendor orders share one editor; previous sent orders remain available as history. */
export default function VendorOrderManageListPage() {
  const vendorOrderRepository = useVendorOrderRepository();
  const { pushUndo } = useWmsUndo();

  const [queueId, setQueueId] = useState<string | null>(null);
  const [queueEditing, setQueueEditing] = useState(false);
  const editingRef = useRef(false);
  const queueFingerprint = useRef<string | null>(null);
  const queueIdRef = useRef<string | null>(null);
  const refreshRequest = useRef(0);
  const initialPreparationAttempted = useRef(false);
  const preparationFailed = useRef(false);
  const [refreshPending, setRefreshPending] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const reportQueueEditing = useCallback((editing: boolean) => { editingRef.current = editing; setQueueEditing(editing); }, []);
  const [editorSnapshot, setEditorSnapshot] = useState<PickingWaveStoreSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [waves, setWaves] = useState<PickingWave[]>([]);
  const [drafts, setDrafts] = useState<VendorOrderDraft[]>([]);
  const [lines, setLines] = useState<VendorOrderDraftLine[]>([]);
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async (prepareMissingQueue = false, forceReplaceEditor = false) => {
    const request = ++refreshRequest.current;
    // One authoritative snapshot keeps queue identity and rows consistent. This read does
    // not mirror localStorage, so two open editors cannot trigger storage refresh loops.
    const { response, data } = await requestVendorJson("/api/wms/picking-waves", { cache: "no-store" });
    if (!response.ok || !data.ok || !data.snapshot) throw new Error(data.error || "최신 발주 목록을 읽지 못했습니다. 다시 확인해 주세요.");
    if (request !== refreshRequest.current) return;
    let snapshot = data.snapshot as PickingWaveStoreSnapshot;
    if (prepareMissingQueue && !initialPreparationAttempted.current) {
      const pendingDrafts = new Set(deriveVendorOrderDrafts(snapshot.vendorOrderDrafts, snapshot.vendorOrderLines).filter(draft => draft.status !== "sent" && draft.waveId !== snapshot.activeVendorQueueId).map(draft => draft.id));
      const hasPending = snapshot.vendorOrderLines.some(line => pendingDrafts.has(line.draftId) && !line.orderExclusion && !snapshot.deletedVendorLineIds[line.id] && !snapshot.vendorQueueConsumedLineIds?.[line.id] && line.shortageQuantity > 0);
      if (!snapshot.activeVendorQueueId || hasPending) {
        initialPreparationAttempted.current = true;
        try {
        const preparation = await requestVendorJson("/api/wms/vendor-orders/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const { response: preparedResponse, data: prepared } = preparation;
        if (!preparedResponse.ok || !prepared.success) { initialPreparationAttempted.current = false; throw new Error(prepared.error || "발주 목록을 준비하지 못했습니다. 다시 확인해 주세요."); }
        const { response: latestResponse, data: latest } = await requestVendorJson("/api/wms/picking-waves", { cache: "no-store" });
        if (!latestResponse.ok || !latest.ok || !latest.snapshot) throw new Error(latest.error || "준비된 발주대기를 읽지 못했습니다. 최신 목록을 다시 확인해 주세요.");
        if (request !== refreshRequest.current) return;
        snapshot = latest.snapshot as PickingWaveStoreSnapshot;
        preparationFailed.current = false;
        } catch (error) {
          initialPreparationAttempted.current = false;
          preparationFailed.current = true;
          if (!snapshot.activeVendorQueueId) throw error;
          // A failed legacy transfer must not hide the already usable common queue.
          setRefreshError(error instanceof Error ? error.message : "추가 발주 연결에 실패했습니다. 기존 발주는 계속 확인할 수 있습니다.");
        }
      }
    }
    const nextQueueId = snapshot.activeVendorQueueId || null;
    const loadedDrafts = deriveVendorOrderDrafts(snapshot.vendorOrderDrafts, snapshot.vendorOrderLines);
    const fingerprint = JSON.stringify({ queueId: nextQueueId,
      drafts: loadedDrafts.filter(draft => draft.waveId === nextQueueId).sort((a, b) => a.id.localeCompare(b.id)),
      lines: snapshot.vendorOrderLines.filter(line => line.waveId === nextQueueId).sort((a, b) => a.id.localeCompare(b.id)),
    });
    setWaves(snapshot.waves); setDrafts(loadedDrafts); setLines(snapshot.vendorOrderLines);
    if (nextQueueId && !preparationFailed.current) setRefreshError(null);
    if (queueFingerprint.current !== null && queueFingerprint.current !== fingerprint && !forceReplaceEditor && editingRef.current && nextQueueId !== queueIdRef.current) {
      setRefreshPending(true);
      return;
    }
    if (queueFingerprint.current !== fingerprint) {
      queueFingerprint.current = fingerprint;
      setQueueId(nextQueueId);
      queueIdRef.current = nextQueueId;
      setEditorSnapshot(snapshot);
    }
    setRefreshPending(false);
  }, []);

  useEffect(() => {
    let disposed = false;
    void reload(true).catch(error => { if (!disposed) setRefreshError(error instanceof Error ? error.message : "발주 목록을 읽지 못했습니다."); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; refreshRequest.current++; };
  }, [reload]);

  useEffect(() => {
    if (loading) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void reload().catch(error => setRefreshError(error instanceof Error ? error.message : "최신 발주 목록을 읽지 못했습니다.")); }, 150);
    };
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key.startsWith("noidb_vendor_order") || event.key.startsWith("noidb_picking")) refresh();
    };
    const poll = window.setInterval(refresh, 10000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("storage", onStorage);
    return () => { if (timer) clearTimeout(timer); window.clearInterval(poll); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("storage", onStorage); };
  }, [loading, reload]);

  useEffect(() => {
    if (refreshPending && !queueEditing) void reload().catch(error => setRefreshError(error instanceof Error ? error.message : "최신 발주 목록 확인 실패"));
  }, [refreshPending, queueEditing, reload]);


  const waveById = useMemo(() => new Map(waves.map(wave => [wave.id, wave])), [waves]);

  const rows = useMemo(() => {
    return drafts
      .filter(draft => draft.waveId !== queueId || Boolean(draft.archivedAt))
      .map(draft => {
        const draftLines = lines.filter(line => line.draftId === draft.id);
        const totalQuantity = draftLines.reduce((sum, line) => sum + line.shortageQuantity, 0);
        const wave = draft.waveId === MANUAL_VENDOR_WORKSPACE_ID ? null : waveById.get(draft.waveId);
        return { draft, lineCount: draftLines.length, totalQuantity, wave };
      })
      .filter(row => row.lineCount > 0) // 라인이 하나도 없는(부족분이 0으로 회귀한) 자동 초안은 숨긴다
      .sort((a, b) => b.draft.updatedAt.localeCompare(a.draft.updatedAt));
  }, [drafts, lines, waveById, queueId]);

  useEffect(() => {
    const visibleIds = new Set(rows.map(row => row.draft.id));
    setSelectedDraftIds(previous => {
      const retained = [...previous].filter(id => visibleIds.has(id));
      return retained.length === previous.size ? previous : new Set(retained);
    });
  }, [rows]);

  async function deleteDrafts(draftIds: string[]) {
    if (draftIds.length === 0 || deleting) return;
    if (draftIds.some(id => !rows.some(row => row.draft.id === id))) { setMessage("이전 발주 목록이 변경되었습니다. 삭제할 발주서를 다시 선택해 주세요."); return; }
    if (!window.confirm(`${draftIds.length}개 발주서를 삭제할까요? 삭제 후 상단 되돌리기로 복원할 수 있습니다.`)) return;
    const deletedDrafts = drafts.filter(draft => draftIds.includes(draft.id));
    const deletedLines = lines.filter(line => draftIds.includes(line.draftId));
    setDeleting(true);
    try {
      await Promise.all(draftIds.map(id => vendorOrderRepository.deleteDraft(id)));
      pushUndo("발주서 삭제", async () => {
        for (const draft of deletedDrafts) {
          const response = await fetch("/api/wms/picking-waves", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restoreVendorDraft", draft, lines: deletedLines.filter(line => line.draftId === draft.id) }) });
          const data = await response.json();
          if (!response.ok || !data.ok) throw new Error(data.error || "삭제한 발주서를 복원하지 못했습니다. 기존 이력은 유지했습니다.");
        }
        window.localStorage.setItem("noidb_vendor_order_queue_changed", new Date().toISOString());
        await reload(false, true);
      });
      setSelectedDraftIds(new Set());
      setMessage(`${draftIds.length}개 발주서를 삭제했습니다.`);
      await reload(false, true);
    } finally { setDeleting(false); }
  }

  if (loading) {
    return (
      <main style={pageStyle}>
        <p style={{ color: wmsColors.muted }}>불러오는 중...</p>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <h1 style={{ fontSize: "20px", margin: "0 0 4px" }}>거래처 발주관리</h1>
      <p>어디서 보낸 상품이든 이 목록에 추가됩니다. 거래처별로 수정하고 발주서를 보내세요.</p>
      <nav style={{ display: "flex", gap: "16px", marginBottom: "12px" }}><a href="/wms/vendor-orders/receiving">입고관리</a><a href="/wms/vendor-orders/status-requests">단종·해제 관리</a></nav>
      {message && <p role="status">{message}</p>}
      {refreshPending && <p role="alert" style={{ color: "#934633", fontSize: "13px", lineHeight: 1.6 }}>다른 화면에서 발주 목록이 변경되었습니다. 입력한 내용은 유지했습니다. 저장을 마친 뒤 최신 목록을 확인해 주세요.</p>}
      {refreshError && <p role="alert" style={{ color: "#934633", fontSize: "13px" }}>{refreshError}</p>}
      {(refreshPending || refreshError) && <button type="button" disabled={queueEditing} onClick={() => void reload(true, true).catch(error => setRefreshError(error instanceof Error ? error.message : "최신 목록 확인 실패"))} style={{ ...wmsGhostButton, minHeight: "44px" }}>최신 목록 다시 확인</button>}
      <VendorQueueEditingContext.Provider value={reportQueueEditing}>{queueId && <QueueEditor key={queueId} params={{ waveId: queueId }} sharedSnapshot={editorSnapshot} />}</VendorQueueEditingContext.Provider>
      <details><summary style={{ padding: "16px 0", cursor: "pointer" }}>이전 발주서 · 승인/전송 이력</summary>
      <p style={{ fontSize: "12px", color: wmsColors.muted, margin: "0 0 16px" }}>
        현재 발주대기는 위 통합 목록에서 수정합니다. 이전 미전송 발주도 같은 통합 목록으로 연결되며, 전송을 마친 발주서는 당시 이력을 확인합니다.
      </p>


      {rows.length === 0 ? (
        <p style={{ fontSize: "13px", color: wmsColors.muted }}>아직 거래처 발주서가 없습니다.</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
            <button onClick={() => setSelectedDraftIds(selectedDraftIds.size === rows.length ? new Set() : new Set(rows.map(row => row.draft.id)))} style={{ ...wmsGhostButton, flex: 1, minHeight: "40px", fontSize: "12px" }}>{selectedDraftIds.size === rows.length ? "전체해제" : "전체선택"}</button>
            <button disabled={selectedDraftIds.size === 0 || deleting} onClick={() => deleteDrafts(Array.from(selectedDraftIds))} style={{ ...wmsGhostButton, flex: 1.3, minHeight: "40px", fontSize: "12px", background: "#f4dfd9", color: "#934633", opacity: selectedDraftIds.size ? 1 : 0.5 }}>선택 일괄삭제 ({selectedDraftIds.size})</button>
          </div>
          {message && <p style={{ fontSize: "12px", color: wmsColors.greenDark }}>{message}</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {rows.map((row, index) => (
              <div key={row.draft.id} style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "16px", padding: "12px", background: index % 2 === 0 ? "#f7f4ef" : "#f1f5f2" }}>
                <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                  <input type="checkbox" checked={selectedDraftIds.has(row.draft.id)} onChange={event => setSelectedDraftIds(previous => { const next = new Set(previous); if (event.target.checked) next.add(row.draft.id); else next.delete(row.draft.id); return next; })} style={{ width: "23px", height: "23px", flexShrink: 0 }} />
                  <a href={row.draft.status === "sent" ? `/wms/picking/waves/${row.draft.waveId}/vendor-orders?history=1&draftId=${encodeURIComponent(row.draft.id)}` : "/wms/vendor-orders/manage"} style={{ flex: 1, minWidth: 0, textDecoration: "none", color: "inherit" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <strong style={{ fontSize: "14px" }}>{row.draft.vendorName}</strong>
                  <StatusBadge status={row.draft.status} />
                </div>
                <div style={{ fontSize: "11px", color: wmsColors.muted }}>
                  {row.draft.waveId === MANUAL_VENDOR_WORKSPACE_ID ? (
                    "웨이브 없음 (수동)"
                  ) : (
                    <>
                      웨이브 {row.draft.waveId}
                      {row.wave ? ` · ${PICKING_WAVE_STATUS_LABEL[row.wave.status]}` : " · 삭제된 웨이브"}
                    </>
                  )}
                </div>
                <div style={{ fontSize: "12px", color: wmsColors.ink, marginTop: "4px" }}>
                  {row.lineCount}종 · 총 {row.totalQuantity}개
                  {row.draft.vendorName === UNASSIGNED_VENDOR_NAME && " · 거래처 확인 필요"}
                </div>
                  </a>
                </div>
                <button disabled={deleting} onClick={() => deleteDrafts([row.draft.id])} style={{ width: "100%", minHeight: "34px", marginTop: "10px", border: 0, borderRadius: "10px", background: "#f4dfd9", color: "#934633", fontWeight: 800 }}>삭제</button>
              </div>
          ))}
          </div>
        </>
      )}
      </details>
    </main>
  );
}

function StatusBadge({ status }: { status: VendorOrderDraftStatus }) {
  const colorMap: Record<VendorOrderDraftStatus, { bg: string; text: string }> = {
    draft: { bg: wmsColors.surfaceBeige, text: wmsColors.muted },
    review: { bg: "#fff3e0", text: "#a6614e" },
    approved: { bg: wmsColors.greenSoft, text: wmsColors.greenDark },
    sent: { bg: wmsColors.green, text: "#ffffff" },
    resend_needed: { bg: wmsColors.warnSoft, text: wmsColors.warn },
  };
  const color = colorMap[status];
  return (
    <span style={{ fontSize: "11px", fontWeight: 700, padding: "3px 10px", borderRadius: "999px", background: color.bg, color: color.text }}>
      {VENDOR_ORDER_STATUS_LABEL[status]}
    </span>
  );
}

const pageStyle = {
  maxWidth: WMS_MOBILE_WIDTH,
  margin: "0 auto",
  padding: "12px 12px calc(12px + env(safe-area-inset-bottom))",
  fontFamily: "sans-serif",
  background: wmsColors.background,
  color: wmsColors.ink,
  minHeight: "100vh",
} as const;
