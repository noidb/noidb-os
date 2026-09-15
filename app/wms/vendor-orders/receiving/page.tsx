"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { PickingWaveStoreSnapshot } from "@/lib/wms/picking-wave/shared-store-types";
import { vendorLineClassification } from "@/lib/wms/vendor-order/receiving-state";
import { orderVendorDrafts } from "@/lib/wms/vendor-order/order-list";
const Editor = dynamic(() => import("../../picking/waves/[waveId]/vendor-orders/VendorOrderEditor"));
export default function ReceivingPage() {
  const [snapshot,setSnapshot] = useState<PickingWaveStoreSnapshot | null>(null), [error,setError] = useState("");
  const [selected,setSelected] = useState(""), [showHistory,setShowHistory] = useState(false);
  async function reload() {
    try { const response = await fetch("/api/wms/picking-waves", { cache: "no-store" }), data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "결과 조회 실패");
      setSnapshot(data.snapshot); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "조회 실패"); }
  }
  useEffect(() => { void reload(); }, []);
  const drafts = snapshot?.vendorOrderDrafts.filter(d => d.status === "sent" && !snapshot.deletedVendorDraftIds[d.id]) || [];
  const lineState = (id: string) => (snapshot?.vendorOrderLines || []).filter(l => l.draftId === id && !snapshot?.deletedVendorLineIds[l.id] && !snapshot?.vendorQueueConsumedLineIds?.[l.id] && l.shortageQuantity > 0 && vendorLineClassification(l) !== "resolved");
  const labels = new Map(orderVendorDrafts(drafts.map(draft => ({ id: draft.id, vendorName: draft.vendorName, draft }))).map(draft => [draft.id, draft.label]));
  const selectedDraft = drafts.find(d => d.id === selected);
  return <main style={{ margin: "0 auto", padding: 20, maxWidth: 1100 }}><h1>거래처 답변 · 입고결과 처리</h1>
    <p>전송한 발주서를 열고 ‘발주서수정’을 눌러 단종·거래처수정·쿠팡 재발주·입고지연을 처리하세요.</p>
    <nav><a href="/wms/vendor-orders">과거청산</a> · <a href="/wms/vendor-orders/manage">거래처 발주</a> · <a href="/wms/inbound/reorder">쿠팡 미납 재발주</a> · <a href="/wms/vendor-orders#shortage-review">최초 분류 입고지연</a></nav>
    {error && <p role="alert">{error}</p>}
    <button onClick={() => void reload()}>저장된 처리결과 새로고침</button> <label><input type="checkbox" checked={showHistory} onChange={e => setShowHistory(e.target.checked)} />분류완료 이력 포함</label>
    {drafts.filter(d => showHistory || lineState(d.id).length).map(d => <button key={d.id} onClick={() => setSelected(d.id)} style={{ display: "block", margin: "10px 0", padding: 14, width: "100%", textAlign: "left" }}>{labels.get(d.id)} · {new Date(d.sentAt || d.createdAt).toLocaleDateString("ko-KR")} · 결과대기 {lineState(d.id).length}라인 / 입고지연 {lineState(d.id).filter(l => vendorLineClassification(l) === "delayed").length}라인</button>)}
    {selectedDraft && <Editor key={selectedDraft.id} params={{ waveId: selectedDraft.waveId }} historyView historyDraftId={selectedDraft.id} />}
  </main>;
}
