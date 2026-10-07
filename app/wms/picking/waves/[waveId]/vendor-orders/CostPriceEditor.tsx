"use client";

import { useState } from "react";
import { calculateReceivingCost } from "@/lib/wms/receiving-cost";
import { wmsColors } from "@/lib/wms/ui-tokens";

/**
 * 발주결과처리 카드: 제품DB 원가(부가세 포함)를 보여주고, 입고 영수증 단가가 다를 때만 고친다.
 * 영수증 단가(부가세 별도)를 넣으면 부가세 10%를 더한 원가를 미리 보여주고, 확인을 누를 때만 제품DB 원가 1칸을 바꾼다.
 * 입고수량은 다루지 않는다(2026-10-07 사용자 요청). 거래처에 보내는 발주서 카드에는 나오지 않는다.
 */
export default function CostPriceEditor({ skuId, currentCost, onSaved }: { skuId: string; currentCost: string; onSaved: (cost: string) => void }) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const current = Number(String(currentCost || "").replace(/[^\d.]/g, "")) || 0;
  const typed = Number(price.replace(/[^\d]/g, ""));
  const next = typed > 0 ? calculateReceivingCost(typed) : null;
  const same = next !== null && next.costVatIncluded === current;

  async function save() {
    if (!next || same || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/wms/product-catalog/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skuId, costVatIncluded: String(next.costVatIncluded) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || "제품DB 원가를 저장하지 못했습니다.");
      onSaved(String(next.costVatIncluded));
      setMessage(`원가를 ${next.costVatIncluded.toLocaleString()}원으로 바꿨습니다.`);
      setPrice("");
      setOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "제품DB 원가를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const button = (tone: "sand" | "sage"): React.CSSProperties => ({
    minHeight: 34, padding: "0 12px", borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: busy ? "wait" : "pointer",
    border: `1px solid ${tone === "sage" ? "#b9cbbc" : "#c7b9a8"}`, background: tone === "sage" ? "#e3ede6" : "#e9ddcf", color: tone === "sage" ? "#3f574b" : "#4b4744",
  });
  return (
    <div style={{ marginTop: 10, padding: "8px 10px", border: `1px solid ${wmsColors.border}`, borderRadius: 8, display: "grid", gap: 6, fontSize: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span style={{ color: wmsColors.muted }}>제품DB 원가(부가세 포함) <b style={{ color: wmsColors.ink, fontSize: 14 }}>{current ? `${current.toLocaleString()}원` : "미입력"}</b></span>
        {!open && <button type="button" onClick={() => { setOpen(true); setMessage(""); }} style={button("sand")}>원가 수정</button>}
      </div>
      {open && <>
        <label style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span>영수증 단가(부가세 별도)</span>
          <input type="number" min={0} inputMode="numeric" value={price} onChange={event => setPrice(event.target.value)} aria-label="영수증 단가 부가세 별도"
            style={{ width: 110, minHeight: 34, border: `1px solid ${wmsColors.border}`, borderRadius: 8, padding: "0 8px", fontSize: 14 }} />
          <span>원</span>
        </label>
        {next && <span style={{ color: same ? wmsColors.muted : wmsColors.ink }}>
          {same ? "지금 원가와 같습니다. 바꿀 필요가 없어요." : `원가 ${current ? current.toLocaleString() : "미입력"} → ${next.costVatIncluded.toLocaleString()}원 (단가 ${next.unitPriceExVat.toLocaleString()} + 부가세 ${next.vat.toLocaleString()})`}
        </span>}
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" disabled={!next || same || busy} onClick={() => void save()} style={{ ...button("sage"), opacity: !next || same ? .55 : 1 }}>{busy ? "저장 중…" : "확인 · 원가 저장"}</button>
          <button type="button" disabled={busy} onClick={() => { setOpen(false); setPrice(""); }} style={button("sand")}>취소</button>
        </div>
      </>}
      {message && <span role="status" style={{ color: message.startsWith("원가를") ? wmsColors.greenDark : "#7f4032" }}>{message}</span>}
    </div>
  );
}
