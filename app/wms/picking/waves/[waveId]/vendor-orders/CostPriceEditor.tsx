"use client";

import { useState } from "react";
import { calculateReceivingCost } from "@/lib/wms/receiving-cost";
import { wmsColors } from "@/lib/wms/ui-tokens";

/**
 * 발주결과처리 카드: 제품DB 원가(부가세 포함)를 보여주고, 입고 영수증 단가가 다를 때만 고친다.
 * 영수증 단가(부가세 별도)를 넣으면 부가세 10%를 더한 원가를 미리 보여주고, 확인을 누를 때만 제품DB 원가를 바꾼다.
 * 기본은 같은 모델(모델명/품번)의 SKU를 모두 같은 최신 원가로 한 번에 바꾼다(2026-10-21).
 * 옵션마다 단가가 다른 모델은 '해당 옵션 단가만 수정'을 누를 때만 이 SKU 하나만 바꾼다(2026-10-27).
 * 원가 아래에 최근 쿠팡 공급가와 마진(공급가-원가)을 보여준다(2026-10-27). 둘 다 부가세 포함.
 * 입고수량은 다루지 않는다(2026-10-07 사용자 요청). 거래처에 보내는 발주서 카드에는 나오지 않는다.
 */
export default function CostPriceEditor({ skuId, currentCost, supplyPrice = "", onSaved }: { skuId: string; currentCost: string; supplyPrice?: string; onSaved: (cost: string, skuIds: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState<"" | "model" | "option">("");
  const [message, setMessage] = useState("");
  const current = Number(String(currentCost || "").replace(/[^\d.]/g, "")) || 0;
  const typed = Number(price.replace(/[^\d]/g, ""));
  const next = typed > 0 ? calculateReceivingCost(typed) : null;
  const supply = Number(String(supplyPrice || "").replace(/[^\d.]/g, "")) || 0;
  const same = next !== null && next.costVatIncluded === current;

  async function save(scope: "model" | "option") {
    if (!next || same || busy) return;
    const sameModel = scope === "model";
    setBusy(scope);
    setMessage("");
    try {
      const response = await fetch("/api/wms/product-catalog/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skuId, costVatIncluded: String(next.costVatIncluded), sameModel }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || "제품DB 원가를 저장하지 못했습니다.");
      const skuIds: string[] = sameModel && Array.isArray(data.skuIds) && data.skuIds.length ? data.skuIds : [skuId];
      const skipped: string[] = Array.isArray(data.skippedFormulaSkuIds) ? data.skippedFormulaSkuIds : [];
      onSaved(String(next.costVatIncluded), skuIds);
      setMessage(`원가를 ${next.costVatIncluded.toLocaleString()}원으로 바꿨습니다.${!sameModel ? " (이 옵션만)" : skuIds.length > 1 ? ` (같은 모델 ${skuIds.length}개 SKU)` : ""}${skipped.length ? ` 수식 칸이라 못 바꾼 SKU: ${skipped.join(", ")}` : ""}`);
      setPrice("");
      setOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "제품DB 원가를 저장하지 못했습니다.");
    } finally {
      setBusy("");
    }
  }

  const tones = {
    sage: { border: "#b9cbbc", background: "#e3ede6", color: "#3f574b" },
    sand: { border: "#c7b9a8", background: "#e9ddcf", color: "#4b4744" },
    apricot: { border: "#d8d3cc", background: "#f4f1ec", color: "#4b4744" },
  } as const;
  const button = (tone: keyof typeof tones): React.CSSProperties => ({
    minHeight: 34, padding: "0 8px", borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: busy ? "wait" : "pointer", lineHeight: 1.25,
    border: `1px solid ${tones[tone].border}`, background: tones[tone].background, color: tones[tone].color,
  });
  return (
    <div style={{ marginTop: 10, padding: "8px 10px", border: `1px solid ${wmsColors.border}`, borderRadius: 8, display: "grid", gap: 6, fontSize: 12 }}>
      {/* 원가 · 쿠팡 공급가 · 마진을 세 칸으로 나눠 한눈에 보이게(2026-10-27). 마진은 빨간색 굵은 글씨. */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
        <div style={{ display: "grid", gap: 2, padding: "6px 8px", borderRadius: 8, background: "#f4f1ec" }}>
          <span style={{ color: wmsColors.muted, fontSize: 11 }}>원가 (부가세 포함)</span>
          <b style={{ color: wmsColors.ink, fontSize: 16 }}>{current ? `${current.toLocaleString()}원` : "미입력"}</b>
        </div>
        <div style={{ display: "grid", gap: 2, padding: "6px 8px", borderRadius: 8, background: "#f4f1ec" }}>
          <span style={{ color: wmsColors.muted, fontSize: 11 }}>쿠팡 공급가</span>
          <b style={{ color: wmsColors.ink, fontSize: 16 }}>{supply ? `${supply.toLocaleString()}원` : "미입력"}</b>
        </div>
        <div style={{ display: "grid", gap: 2, padding: "6px 8px", borderRadius: 8, background: "#f2dfd8" }}>
          <span style={{ color: "#a33b2e", fontSize: 11, fontWeight: 800 }}>마진</span>
          <b style={{ color: "#c0392b", fontSize: 20, fontWeight: 900 }}>{supply > 0 && current > 0 ? `${supply - current < 0 ? "−" : ""}${Math.abs(supply - current).toLocaleString()}원` : "-"}</b>
        </div>
      </div>
      {!open && <button type="button" onClick={() => { setOpen(true); setMessage(""); }} style={{ ...button("sand"), width: "100%" }}>원가 수정</button>}
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
          <button type="button" disabled={!next || same || Boolean(busy)} onClick={() => void save("model")} style={{ ...button("sage"), opacity: !next || same ? .55 : 1 }}>{busy === "model" ? "저장 중…" : "같은 모델 원가 모두 저장"}</button>
          <button type="button" disabled={!next || same || Boolean(busy)} onClick={() => void save("option")} style={{ ...button("apricot"), opacity: !next || same ? .55 : 1 }}>{busy === "option" ? "저장 중…" : "해당 옵션 단가만 수정"}</button>
          <button type="button" disabled={Boolean(busy)} onClick={() => { setOpen(false); setPrice(""); }} style={button("sand")}>취소</button>
        </div>
      </>}
      {message && <span role="status" style={{ color: message.startsWith("원가를") ? wmsColors.greenDark : "#7f4032" }}>{message}</span>}
    </div>
  );
}
