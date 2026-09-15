"use client";
import { useState } from "react";
import type { VendorOrderDraftLine } from "@/lib/wms/vendor-order/types";
import type { PickingWaveStoreSnapshot } from "@/lib/wms/picking-wave/shared-store-types";
import { targetVendorVersion, transferSentVendorLine, type SentVendorTransferInput } from "@/lib/wms/vendor-order/sent-vendor-transfer";
import { requestVendorJson } from "@/lib/wms/vendor-order/request-json";
import { wmsGhostButton, wmsSecondaryButton, wmsSageButton } from "@/lib/wms/ui-tokens";
import VendorNameSelect from "./VendorNameSelect";

export default function SentVendorChangeButton({ line, options, onMoved }: { line: VendorOrderDraftLine; options: string[]; onMoved: (line: VendorOrderDraftLine) => void }) {
  const [open, setOpen] = useState(false), [mode, setMode] = useState<"move" | "catalog">("move");
  const [vendor, setVendor] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<{ input: SentVendorTransferInput; quantity: number } | null>(null);
  async function submit() {
    setBusy(true); setError("");
    try {
      if (mode === "catalog") {
        const { response, data } = await requestVendorJson("/api/wms/product-catalog/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skuId: line.skuId, vendorName: vendor.trim() }) });
        if (!response.ok || !data.success || !data.updatedFields?.includes("vendorName")) throw new Error(data.error || "제품DB 거래처 저장 결과를 확인하지 못했습니다.");
        setMessage(`제품DB 거래처를 ${vendor.trim()}로 정정했습니다.`); setOpen(false); return;
      }
      if (!preview) {
        const { response, data } = await requestVendorJson("/api/wms/picking-waves", { cache: "no-store" });
        if (!response.ok || !data.ok) throw new Error(data.error || "발주서를 확인하지 못했습니다.");
        const store: PickingWaveStoreSnapshot = data.snapshot;
        const input: SentVendorTransferInput = { lineId: line.id, vendorName: vendor.trim(), expectedUpdatedAt: line.updatedAt, operationId: crypto.randomUUID(), now: new Date().toISOString(), expectedQueueId: store.activeVendorQueueId || "", expectedTargetVersion: targetVendorVersion(store, vendor.trim()) };
        const plan = transferSentVendorLine(store, input);
        setPreview({ input, quantity: plan.vendorOrderLines.find(l => l.id === line.id)!.vendorTransfer!.quantity }); return;
      }
      const { response, data } = await requestVendorJson("/api/wms/picking-waves", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "transferSentVendorLine", ...preview.input }) });
      if (!response.ok || !data.ok) throw new Error(data.error || "거래처 발주서를 이동하지 못했습니다.");
      onMoved(data.snapshot.vendorOrderLines.find((l: VendorOrderDraftLine) => l.id === line.id)); setOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : "저장하지 못했습니다."); setPreview(null); } finally { setBusy(false); }
  }
  return <>
    <button type="button" style={{ ...wmsSecondaryButton, minHeight: 44 }} onClick={() => { setOpen(true); setPreview(null); setError(""); }}>거래처 수정</button>
    {message && <p role="status">{message}</p>}
    {open && <div style={{ position: "fixed", inset: 0, zIndex: 1100, background: "#0008", padding: 14, display: "grid", placeItems: "center" }}>
      <section role="dialog" aria-modal="true" aria-label="전송완료 거래처 수정" style={{ width: "100%", maxWidth: 440, maxHeight: "85dvh", overflowY: "auto", boxSizing: "border-box", padding: 18, borderRadius: 16, background: "white", display: "grid", gap: 12 }}>
        <strong>거래처 수정 · SKU {line.skuId}</strong>
        <label><input type="radio" name={`vendor-mode-${line.id}`} checked={mode === "move"} disabled={busy} onChange={() => { setMode("move"); setPreview(null); }} /> 이번 발주를 다른 거래처로 이동</label>
        <label><input type="radio" name={`vendor-mode-${line.id}`} checked={mode === "catalog"} disabled={busy} onChange={() => { setMode("catalog"); setPreview(null); }} /> 제품DB 거래처만 정정</label>
        <p style={{ margin: 0, fontSize: 13 }}>{mode === "move" ? "일시 품절일 때 사용하세요. 미입고 수량을 다른 거래처의 발주 초안으로 옮기고 기존 거래처 목록에서 제외합니다. 제품DB 거래처는 유지됩니다." : "등록 오류일 때 사용하세요. 이 SKU의 제품DB 거래처를 정정합니다. 이번에 전송한 발주서는 이동하지 않습니다."}</p>
        <VendorNameSelect value={vendor} onChange={name => { setVendor(name); setPreview(null); }} options={options} disabled={busy} />
        {preview && <p role="status">{line.vendorName} → {vendor.trim()}<br />미입고 {preview.quantity}개를 발주 초안으로 이동합니다.</p>}
        {mode === "catalog" && vendor.trim() && <p>SKU {line.skuId}의 제품DB 거래처를 ‘{vendor.trim()}’로 저장합니다.</p>}
        {error && <p role="alert" style={{ color: "#b42318" }}>{error}</p>}
        <button type="button" disabled={busy || !vendor.trim() || (mode === "move" && vendor.trim() === line.vendorName)} style={wmsSageButton} onClick={() => void submit()}>{busy ? "확인 중…" : mode === "catalog" ? "확인 · 제품DB 거래처 정정" : preview ? "확인 · 발주서 이동" : "이동 수량 확인"}</button>
        <button type="button" disabled={busy} style={wmsGhostButton} onClick={() => setOpen(false)}>취소</button>
      </section>
    </div>}
  </>;
}
