"use client";
import { useState, type CSSProperties } from "react";
import type { VendorOrderDraftLine } from "@/lib/wms/vendor-order/types";
import type { PickingWaveStoreSnapshot } from "@/lib/wms/picking-wave/shared-store-types";
import { targetVendorVersion, transferSentVendorLine, type SentVendorTransferInput } from "@/lib/wms/vendor-order/sent-vendor-transfer";
import { wmsGhostButton, wmsSecondaryButton, wmsSageButton } from "@/lib/wms/ui-tokens";
import VendorNameSelect from "./VendorNameSelect";

export default function SentVendorChangeButton({ line, options, onMoved, style }: { line: VendorOrderDraftLine; options: string[]; onMoved: (line: VendorOrderDraftLine, snapshot: PickingWaveStoreSnapshot) => void; style?: CSSProperties }) {
  const [open, setOpen] = useState(false);
  const [vendor, setVendor] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [preview, setPreview] = useState<{ input: SentVendorTransferInput; quantity: number } | null>(null);
  async function submit() {
    setBusy(true); setError("");
    try {
      if (!preview) {
        const response = await fetch("/api/wms/picking-waves", { cache: "no-store" }); const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "발주서를 확인하지 못했습니다.");
        const store: PickingWaveStoreSnapshot = data.snapshot;
        const input: SentVendorTransferInput = { lineId: line.id, vendorName: vendor.trim(), expectedUpdatedAt: line.updatedAt, operationId: crypto.randomUUID(), now: new Date().toISOString(), expectedQueueId: store.activeVendorQueueId || "", expectedTargetVersion: targetVendorVersion(store, vendor.trim()) };
        const plan = transferSentVendorLine(store, input);
        setPreview({ input, quantity: plan.vendorOrderLines.find(l => l.id === line.id)!.vendorTransfer!.quantity }); return;
      }
      const response = await fetch("/api/wms/picking-waves", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "transferSentVendorLine", ...preview.input }) }); const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "거래처 발주서를 이동하지 못했습니다.");
      onMoved(data.snapshot.vendorOrderLines.find((l: VendorOrderDraftLine) => l.id === line.id), data.snapshot); setOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : "저장하지 못했습니다."); setPreview(null); } finally { setBusy(false); }
  }
  return <>
    <button type="button" style={{ ...wmsSecondaryButton, width: "100%", minHeight: 48, fontSize: 13, ...style }} onClick={() => { setOpen(true); setPreview(null); setError(""); }}>거래처 수정</button>
    {open && <div style={{ position: "fixed", inset: 0, zIndex: 1100, background: "#0008", padding: 14, display: "grid", placeItems: "center" }}>
      <section role="dialog" aria-modal="true" aria-label="전송완료 거래처 수정" style={{ width: "100%", maxWidth: 440, maxHeight: "85dvh", overflowY: "auto", boxSizing: "border-box", padding: 18, borderRadius: 16, background: "white", display: "grid", gap: 12 }}>
        <strong>거래처 수정 · SKU {line.skuId}</strong>
        <p style={{ margin: 0, fontSize: 13 }}>변경할 거래처</p>
        <VendorNameSelect value={vendor} onChange={name => { setVendor(name); setPreview(null); }} options={options} disabled={busy} />
        <p style={{ margin: 0, fontSize: 13 }}>기존 초안에 추가합니다. 없으면 새 발주서를 만듭니다.</p>
        {preview && <p role="status">{line.vendorName} → {vendor.trim()}<br />미입고 {preview.quantity}개를 발주 초안으로 이동합니다.</p>}
        {error && <p role="alert" style={{ color: "#b42318" }}>{error}</p>}
        <button type="button" disabled={busy || !vendor.trim() || vendor.trim() === line.vendorName} style={wmsSageButton} onClick={() => void submit()}>{busy ? "확인 중…" : preview ? "확인 · 발주서 이동" : "이동 수량 확인"}</button>
        <button type="button" disabled={busy} style={wmsGhostButton} onClick={() => setOpen(false)}>취소</button>
      </section>
    </div>}
  </>;
}
