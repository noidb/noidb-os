"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConfirmedFileLinkGroup, ConfirmedFileLinkCandidate } from "@/lib/wms/po-confirm-file-link";
import { wmsColors, wmsPrimaryButton, wmsSecondaryButton } from "@/lib/wms/ui-tokens";

export default function ConfirmedFileLinkRecovery({ waveId, onBlockedChange }: { waveId: string; onBlockedChange: (blocked: boolean) => void }) {
  const [groups, setGroups] = useState<ConfirmedFileLinkGroup[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const check = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/wms/po-confirm/file-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", waveId }), signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "확정파일을 확인하지 못했습니다.");
    setGroups(data.groups || []);
    onBlockedChange(Boolean(data.groups?.length));
  }, [waveId, onBlockedChange]);
  useEffect(() => {
    setGroups([]); setError(""); setMessage("");
    onBlockedChange(true);
    const controller = new AbortController();
    void check(controller.signal).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "확정파일을 확인하지 못했습니다."); });
    return () => controller.abort();
  }, [check, onBlockedChange]);

  async function connect(candidate: ConfirmedFileLinkCandidate) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/wms/po-confirm/file-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "connect", waveId, token: candidate.token, confirmed: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "확정파일을 연결하지 못했습니다.");
      const remaining = groups.filter(group => !group.candidates.some(item => item.token === candidate.token));
      setGroups(remaining); onBlockedChange(remaining.length > 0);
      setMessage(`발주 ${data.purchaseOrderCount}건의 확정파일 연결을 복구했습니다. 아래에서 Shipment를 생성하세요.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "확정파일 연결에 실패했습니다."); }
    finally { setBusy(false); }
  }

  if (!groups.length && !error && !message) return null;
  return <section aria-label="발주확정 파일 연결" style={{ marginBottom: 12, padding: 12, border: `1px solid ${wmsColors.border}`, borderRadius: 10, background: wmsColors.surfaceBeige, fontSize: 12, overflowWrap: "anywhere" }}>
    {message && <p role="status" style={{ margin: 0, color: wmsColors.greenDark }}>{message}</p>}
    {groups.map(group => <div key={group.previousFileName}>
      <strong>이전 확정파일 연결 확인 · 발주 {group.purchaseOrderNumbers.length}건</strong>
      <p>저장된 이름의 파일이 없어 같은 발주·SKU·바코드·원수량·센터·입고일의 완성파일을 찾았습니다. 수량을 확인하고 한 번만 연결해 주세요.</p>
      {!group.candidates.length && <p>모든 항목이 일치하는 파일이 없습니다. 1단계에서 확정파일을 다시 생성하거나 완성파일 폴더를 확인해 주세요.</p>}
      {group.candidates.map(candidate => <div key={candidate.token} style={{ marginTop: 10, padding: 10, background: wmsColors.surface, borderRadius: 8 }}>
        <p style={{ margin: "0 0 6px" }}>{candidate.fileName}</p>
        <strong>발주 {candidate.purchaseOrderCount}건 · {candidate.rowCount}행 · 확정 {candidate.totalConfirmedQuantity}개</strong>
        {candidate.quantityChanges.length ? <details style={{ marginTop: 8 }}><summary>발주수량과 다른 항목 {candidate.quantityChanges.length}건 보기</summary>{candidate.quantityChanges.map(row => <p key={`${row.poNumber}:${row.skuId}`}>발주 {row.poNumber} · SKU {row.skuId}: {row.ordered} → {row.confirmed}개</p>)}</details> : <p>모든 확정수량이 발주수량과 같습니다.</p>}
        <p>이전 연결 기록은 백업됩니다. 수량·피킹·쿠팡 확정상태는 변경하지 않습니다.</p>
        <button type="button" disabled={busy} onClick={() => void connect(candidate)} style={{ ...wmsPrimaryButton, width: "100%" }}>{busy ? "연결 확인 중..." : "이 수량 확인 · 확정파일 연결 복구"}</button>
      </div>)}
    </div>)}
    {error && <><p role="alert">{error}</p><button type="button" disabled={busy} style={wmsSecondaryButton} onClick={() => { setError(""); void check().catch(cause => setError(cause.message)); }}>다시 확인</button></>}
  </section>;
}
