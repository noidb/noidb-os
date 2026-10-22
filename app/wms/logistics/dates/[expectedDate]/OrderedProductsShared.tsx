"use client";

import { useEffect, useState } from "react";
import { WMS_MOBILE_WIDTH, wmsColors } from "@/lib/wms/ui-tokens";

/**
 * 발주제품보기 공용 부품 (2026-10-15 사용자 요청).
 * SKU별 총수량(sku-summary)과 쉽먼트별 SKU리스트(sku-list)를 한 화면처럼 오가며 보고,
 * 어느 쪽에서든 "발주 담기"로 같은 목록에 담아 한 번에 거래처발주로 보낸다.
 * 담는 단위는 SKU이고, 수량은 그 날짜 전체 출고수량(SKU별 총수량)이다.
 */

export type PickedSku = { skuId: string; quantity: number };

export function useOutboundPicks(expectedDate: string) {
  const storageKey = `noidb_outbound_vendor_pick_v2_${expectedDate}`;
  const [picked, setPicked] = useState<Record<string, PickedSku>>({});
  useEffect(() => {
    try { const raw = localStorage.getItem(storageKey); if (raw) setPicked(JSON.parse(raw)); } catch { /* 없으면 빈 목록 */ }
  }, [storageKey]);
  function save(next: Record<string, PickedSku>) {
    setPicked(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* 저장 실패해도 화면 선택은 유지 */ }
  }
  function toggle(skuId: string, quantity: number) {
    const next = { ...picked };
    if (next[skuId]) delete next[skuId];
    else next[skuId] = { skuId, quantity };
    save(next);
  }
  return { picked, toggle, clear: () => save({}) };
}

/** 위쪽 보기 전환: SKU별 총수량 ↔ 쉽먼트별 SKU리스트. 검색어를 그대로 넘긴다. */
export function OrderedProductsSwitch({ expectedDate, current, query }: { expectedDate: string; current: "summary" | "shipments"; query: string }) {
  const href = (path: string) => `/wms/logistics/dates/${encodeURIComponent(expectedDate)}/${path}${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""}`;
  const item = (active: boolean) => ({ textDecoration: "none", fontSize: "13px", opacity: active ? 1 : 0.75 });
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", margin: "8px 0 10px" }}>
      <a href={href("sku-summary")} aria-current={current === "summary" ? "page" : undefined} className={current === "summary" ? "softSageButton" : "softApricotButton"} style={item(current === "summary")}>SKU별 총수량</a>
      <a href={href("sku-list")} aria-current={current === "shipments" ? "page" : undefined} className={current === "shipments" ? "softSageButton" : "softApricotButton"} style={item(current === "shipments")}>쉽먼트별 SKU리스트</a>
    </div>
  );
}

/** 주소의 ?q= 검색어(보기 전환 때 넘어온 값). */
export function initialQueryFromUrl(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("q") || "";
}

export function PickButton({ picked, onClick }: { picked: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={picked ? "softPinkButton" : "softBeigeButton"} style={{ minHeight: "32px", padding: "4px 10px", fontSize: "12px", whiteSpace: "nowrap" }}>
      {picked ? "담음 ✓" : "발주 담기"}
    </button>
  );
}

/** 화면 아래 고정 바: 담은 SKU를 한 번에 거래처발주로 보낸다. */
export function PickBar({ expectedDate, picks }: { expectedDate: string; picks: ReturnType<typeof useOutboundPicks> }) {
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const count = Object.keys(picks.picked).length;
  async function send() {
    if (sending || !count) return;
    setSending(true); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/wms/vendor-orders/add-from-outbound", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedDate, items: Object.values(picks.picked) }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "거래처발주로 보내지 못했습니다.");
      const notes = [
        data.vendors?.length ? `거래처 ${data.vendors.join(", ")}` : "",
        data.alreadyQueued ? `이미 발주대기에 있던 ${data.alreadyQueued}개는 수량 그대로 둠` : "",
        data.unassigned?.length ? `거래처 미지정 ${data.unassigned.length}개(제품DB 거래처 확인)` : "",
        data.skipped?.length ? `못 넣은 SKU ${data.skipped.join(", ")}` : "",
      ].filter(Boolean).join(" · ");
      setMessage(`SKU ${data.placed.length}개를 거래처발주에 넣었습니다.${notes ? ` ${notes}` : ""}`);
      picks.clear();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "거래처발주로 보내지 못했습니다.");
    } finally { setSending(false); }
  }
  if (!count && !message && !error) return null;
  return (
    <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 5, background: "#fff", borderTop: "1px solid #e5dace", padding: "10px 12px calc(10px + env(safe-area-inset-bottom))" }}>
      <div style={{ maxWidth: WMS_MOBILE_WIDTH, margin: "0 auto" }}>
        {error && <p style={{ margin: "0 0 6px", color: "#b33f35", fontSize: "12px" }}>{error}</p>}
        {message && <p style={{ margin: "0 0 6px", color: wmsColors.greenDark, fontSize: "12px" }}>{message} <a href="/wms/vendor-orders/manage" style={{ color: wmsColors.slateDark, fontWeight: 700 }}>거래처 발주서 열기 →</a></p>}
        {count > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "8px" }}>
            <button type="button" className="softApricotButton" disabled={sending} onClick={picks.clear}>담은 것 비우기</button>
            <button type="button" className="softInkButton" disabled={sending} onClick={() => void send()}>{sending ? "보내는 중…" : `담은 ${count}개 SKU 거래처발주`}</button>
          </div>
        )}
      </div>
    </div>
  );
}

const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;

/** 두 보기에서 똑같이 쓰는 상품 정보 줄(이름·옵션 / SKU·번호 / 바코드 / 매입가). 상품명을 누르면 제품링크가 열린다. */
export function ProductInfo({ name, option, skuId, warehouseNumber, barcode, priceMin, priceMax, productLink, extra }: {
  name: string; option?: string; skuId: string; warehouseNumber?: string; barcode: string; priceMin?: number; priceMax?: number; productLink?: string; extra?: React.ReactNode;
}) {
  const price = priceMax ? (priceMin && priceMin !== priceMax ? `${priceMin.toLocaleString("ko-KR")}~${won(priceMax)}` : won(priceMax)) : "";
  return (
    <div style={{ minWidth: 0 }}>
      {/* 2026-10-22: 제품링크 줄 대신 상품명을 누르면 제품 페이지가 열린다. */}
      {productLink
        ? <a href={productLink} target="_blank" rel="noreferrer" title="제품링크 열기" style={{ display: "block", fontSize: "13px", fontWeight: 700, lineHeight: 1.35, color: "inherit", textDecoration: "underline", textDecorationColor: "#c7b9a8", textUnderlineOffset: "3px" }}>{name}{option ? ` · ${option}` : ""}</a>
        : <div style={{ fontSize: "13px", fontWeight: 700, lineHeight: 1.35 }}>{name}{option ? ` · ${option}` : ""}</div>}
      <div style={{ fontSize: "12px", color: wmsColors.muted, marginTop: "3px", lineHeight: 1.45 }}>SKU {skuId || "-"}{warehouseNumber ? ` · 번호 ${warehouseNumber}` : ""}</div>
      {extra ? <div style={{ fontSize: "12px", color: wmsColors.muted, lineHeight: 1.45, whiteSpace: "nowrap" }}>{extra}</div> : null}
      <div style={{ fontSize: "12px", fontFamily: "monospace", marginTop: "2px", lineHeight: 1.45, overflowWrap: "anywhere" }}>{barcode}</div>
      {price && <div style={{ fontSize: "12px", fontWeight: 700, marginTop: "2px" }}>매입가 {price}</div>}
    </div>
  );
}
