"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { VendorQueueEditingContext } from "@/lib/wms/vendor-order/queue-editing-context";
import { requestVendorJson } from "@/lib/wms/vendor-order/request-json";
const QueueEditor = dynamic(() => import("../../picking/waves/[waveId]/vendor-orders/VendorOrderEditor"), { loading: () => <p>발주서를 불러오는 중…</p> });
import { deriveVendorOrderDrafts } from "@/lib/wms/vendor-order/derive-drafts";
import type { PickingWaveStoreSnapshot } from "@/lib/wms/picking-wave/shared-store-types";
import { WMS_MOBILE_WIDTH, wmsColors, wmsGhostButton } from "@/lib/wms/ui-tokens";

/** Current vendor orders share one editor; previous sent orders remain available as history. */
export default function VendorOrderManageListPage() {

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
      drafts: loadedDrafts.sort((a, b) => a.id.localeCompare(b.id)),
      lines: [...snapshot.vendorOrderLines].sort((a, b) => a.id.localeCompare(b.id)),
    });
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
      {refreshPending && <p role="alert" style={{ color: "#934633", fontSize: "13px", lineHeight: 1.6 }}>다른 화면에서 발주 목록이 변경되었습니다. 입력한 내용은 유지했습니다. 저장을 마친 뒤 최신 목록을 확인해 주세요.</p>}
      {refreshError && <p role="alert" style={{ color: "#934633", fontSize: "13px" }}>{refreshError}</p>}
      {(refreshPending || refreshError) && <button type="button" disabled={queueEditing} onClick={() => void reload(true, true).catch(error => setRefreshError(error instanceof Error ? error.message : "최신 목록 확인 실패"))} style={{ ...wmsGhostButton, minHeight: "44px" }}>최신 목록 다시 확인</button>}
      <VendorQueueEditingContext.Provider value={reportQueueEditing}>{queueId && <QueueEditor key={queueId} params={{ waveId: queueId }} sharedSnapshot={editorSnapshot} />}</VendorQueueEditingContext.Provider>

    </main>
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
