"use client";

import { useState } from "react";
import { VENDOR_ORDER_DISCARD_REASONS, vendorOrderDiscardBlockReason, type VendorOrderDiscardReason } from "@/lib/wms/vendor-order/discard-order";
import { VENDOR_ORDER_STATUS_LABEL, type VendorOrderDraft, type VendorOrderDraftLine } from "@/lib/wms/vendor-order/types";
import { requestVendorJson } from "@/lib/wms/vendor-order/request-json";
import { wmsColors, wmsGhostButton, wmsWarnButton } from "@/lib/wms/ui-tokens";

export default function DeleteVendorOrderButton({ draft, label, disabled, onDeleted }: { draft: VendorOrderDraft; label: string; disabled: boolean; onDeleted: (draftId: string) => void }) {
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<{ draft: VendorOrderDraft; lines: VendorOrderDraftLine[] } | null>(null);
  const [reason, setReason] = useState<VendorOrderDiscardReason>("잘못 생성");
  const blocked = target ? vendorOrderDiscardBlockReason(target.lines) : null;
  async function show() {
    setOpen(true); setLoading(true); setError(null); setTarget(null); setReason("잘못 생성");
    try {
      const result = await requestVendorJson("/api/wms/picking-waves", { cache: "no-store" });
      if (!result.response.ok || !result.data.ok || !result.data.snapshot) throw new Error(result.data.error || "발주서를 확인하지 못했습니다.");
      const current = result.data.snapshot.vendorOrderDrafts.find((row: VendorOrderDraft) => row.id === draft.id);
      if (!current) throw new Error("이미 삭제되었거나 변경된 발주서입니다. 최신 목록을 확인해 주세요.");
      setTarget({ draft: current, lines: result.data.snapshot.vendorOrderLines.filter((line: VendorOrderDraftLine) => line.draftId === draft.id) });
    } catch (e) { setError(e instanceof Error ? e.message : "발주서 확인 실패"); }
    finally { setLoading(false); }
  }
  async function remove() {
    if (!target || blocked || saving || disabled) return;
    setSaving(true); setError(null);
    try {
      const result = await requestVendorJson("/api/wms/picking-waves", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "discardVendorOrder", draftId: target.draft.id, expectedUpdatedAt: target.draft.updatedAt, expectedUpdatedAtByLineId: Object.fromEntries(target.lines.map(line => [line.id, line.updatedAt])), reason, deletedAt: new Date().toISOString() }) }, 45000);
      if (!result.response.ok || !result.data.ok) throw new Error(result.data.error || "발주서를 삭제하지 못했습니다.");
      setOpen(false); onDeleted(target.draft.id);
    } catch (e) { setError(e instanceof Error ? e.message : "발주서 삭제 실패"); }
    finally { setSaving(false); }
  }
  return <>
    <button type="button" disabled={disabled || loading || saving} onClick={() => void show()} style={{ ...wmsWarnButton, minHeight: "36px", padding: "0 10px", fontSize: "12px" }}>발주서 삭제</button>
    {open && <div style={{ position: "fixed", inset: 0, background: "rgba(37,37,37,.6)", zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", padding: "12px" }}>
      <section role="dialog" aria-modal="true" aria-label="발주서 삭제 확인" style={{ width: "100%", maxWidth: "420px", maxHeight: "85dvh", overflowY: "auto", boxSizing: "border-box", background: "white", borderRadius: "14px", padding: "18px", color: wmsColors.ink }}>
        <h3 style={{ margin: "0 0 10px" }}>발주서 삭제</h3>
        <strong>{label}</strong>
        {loading && <p>삭제할 발주서를 확인하고 있습니다…</p>}
        {target && <>
          <p>{VENDOR_ORDER_STATUS_LABEL[target.draft.status]} · 상품 {target.lines.length}개 · 발주수량 {target.lines.reduce((sum, line) => sum + line.shortageQuantity, 0)}개</p>
          <ul style={{ maxHeight: "180px", overflowY: "auto", paddingLeft: "20px", fontSize: "12px", lineHeight: 1.6 }}>{target.lines.map(line => <li key={line.id}>SKU {line.skuId} · {line.productName} · {line.shortageQuantity}개</li>)}</ul>
          <label style={{ display: "grid", gap: "6px", fontSize: "13px" }}>삭제 사유<select value={reason} onChange={event => setReason(event.target.value as VendorOrderDiscardReason)} disabled={saving} style={{ minHeight: "44px", fontSize: "16px" }}>{VENDOR_ORDER_DISCARD_REASONS.map(value => <option key={value}>{value}</option>)}</select></label>
          <p style={{ fontSize: "12px", lineHeight: 1.6 }}>이 발주서와 포함 상품을 목록에서 삭제하고, 원본과 삭제 사유를 이력으로 보관합니다.</p>
          {target.draft.status === "sent" && <p style={{ fontSize: "12px", color: wmsColors.warn }}>이미 거래처에 전달한 주문의 취소 연락은 별도로 해야 합니다.</p>}
        </>}
        {(error || blocked) && <p role="alert" style={{ color: wmsColors.warn, fontSize: "13px" }}>{error || blocked}</p>}
        <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
          <button type="button" disabled={saving} onClick={() => setOpen(false)} style={{ ...wmsGhostButton, flex: 1 }}>취소</button>
          <button type="button" disabled={disabled || loading || saving || !target || Boolean(blocked)} onClick={() => void remove()} style={{ ...wmsWarnButton, flex: 1 }}>{saving ? "삭제 중…" : "이 발주서 삭제"}</button>
        </div>
      </section>
    </div>}
  </>;
}
