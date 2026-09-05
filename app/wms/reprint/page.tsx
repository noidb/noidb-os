"use client";

import { FormEvent, useState } from "react";
import { closeReservedDownloadTarget, downloadBlobPreservingPage, reserveDownloadTarget } from "@/lib/wms/download-client";
import { wmsColors, wmsOuterCard, wmsPrimaryButton, wmsSecondaryButton } from "@/lib/wms/ui-tokens";

interface BarcodeSearchResult {
  purchaseOrderNumber: string;
  skuId: string;
  barcode: string;
  productName: string;
  optionName: string;
  fulfillmentCenter: string;
  expectedDate: string;
}

export default function WmsReprintCenterPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BarcodeSearchResult[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Record<string, BarcodeSearchResult>>({});
  const [searching, setSearching] = useState(false);
  const [generatingKey, setGeneratingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search(event: FormEvent) {
    event.preventDefault();
    setSearching(true);
    setError(null);
    try {
      const response = await fetch(`/api/wms/reprint/barcode?q=${encodeURIComponent(query.trim())}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "검색하지 못했습니다.");
      const nextResults = (data.results || []) as BarcodeSearchResult[];
      setResults(nextResults);
      setSelected(previous => {
        const next = { ...previous };
        for (const result of nextResults) next[`${result.purchaseOrderNumber}:${result.skuId}`] = result;
        return next;
      });
    } catch (cause) {
      setResults([]);
      setError(cause instanceof Error ? cause.message : "검색하지 못했습니다.");
    } finally {
      setSearching(false);
    }
  }

  async function generateSelected() {
    const items = Object.entries(selected).map(([key, result]) => ({
      purchaseOrderNumber: result.purchaseOrderNumber,
      skuId: result.skuId,
      quantity: Math.max(1, Math.min(1000, Math.floor(quantities[key] || 1))),
    }));
    if (!items.length) return;
    const target = reserveDownloadTarget();
    setGeneratingKey("__batch__");
    setError(null);
    try {
      const response = await fetch("/api/wms/reprint/barcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "선택 바코드 파일을 만들지 못했습니다.");
      }
      const disposition = response.headers.get("Content-Disposition") || "";
      const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1];
      const total = items.reduce((sum, item) => sum + item.quantity, 0);
      downloadBlobPreservingPage(await response.blob(), encoded ? decodeURIComponent(encoded) : `바코드선택재출력_${items.length}종_${total}장.xlsx`, target);
    } catch (cause) {
      closeReservedDownloadTarget(target);
      setError(cause instanceof Error ? cause.message : "선택 바코드 파일을 만들지 못했습니다.");
    } finally {
      setGeneratingKey(null);
    }
  }

  const selectedEntries = Object.entries(selected);
  const selectedQuantity = selectedEntries.reduce((sum, [key]) => sum + Math.max(1, Math.min(1000, Math.floor(quantities[key] || 1))), 0);

  async function generate(result: BarcodeSearchResult) {
    const key = `${result.purchaseOrderNumber}:${result.skuId}`;
    const quantity = Math.max(1, Math.min(1000, Math.floor(quantities[key] || 1)));
    const target = reserveDownloadTarget();
    setGeneratingKey(key);
    setError(null);
    try {
      const response = await fetch("/api/wms/reprint/barcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchaseOrderNumber: result.purchaseOrderNumber, skuId: result.skuId, quantity }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "바코드 재출력 파일을 만들지 못했습니다.");
      }
      const disposition = response.headers.get("Content-Disposition") || "";
      const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1];
      const fileName = encoded ? decodeURIComponent(encoded) : `바코드재출력_${result.skuId}_${quantity}장.xlsx`;
      downloadBlobPreservingPage(await response.blob(), fileName, target);
    } catch (cause) {
      closeReservedDownloadTarget(target);
      setError(cause instanceof Error ? cause.message : "바코드 재출력 파일을 만들지 못했습니다.");
    } finally {
      setGeneratingKey(null);
    }
  }

  return <main className="shell wms-work-center-shell" style={{ fontFamily: "sans-serif", color: wmsColors.ink, paddingBottom: "40px" }}>
    <div style={{ margin: "18px 0 14px" }}>
      <p className="eyebrow">WAREHOUSE REPRINT</p>
      <h1 style={{ margin: "4px 0 6px", fontSize: "28px" }}>재출력센터</h1>
      <p style={{ margin: 0, color: wmsColors.muted, fontSize: "13px" }}>SKU·바코드·발주번호·상품명으로 찾아 BarTender용 바코드를 바로 다시 만듭니다.</p>
    </div>

    <form onSubmit={search} style={{ ...wmsOuterCard, padding: "14px", display: "grid", gap: "8px" }}>
      <label style={{ fontSize: "12px", fontWeight: 800 }}>바코드 검색 · 여러 SKU를 Excel에서 복사해 한꺼번에 붙여넣을 수 있어요</label>
      <textarea value={query} onChange={event => setQuery(event.target.value)} placeholder={"SKU ID, 바코드, 발주번호, 상품명\n여러 개는 줄바꿈으로 붙여넣기"} rows={3} style={{ width: "100%", minHeight: "76px", resize: "vertical", boxSizing: "border-box", border: `1px solid ${wmsColors.borderStrong}`, borderRadius: "10px", padding: "10px 12px", fontSize: "16px" }} />
      <button type="submit" disabled={searching || query.trim().length < 2} style={{ ...wmsPrimaryButton, width: "100%", minHeight: "48px", opacity: searching || query.trim().length < 2 ? .55 : 1 }}>{searching ? "찾는 중..." : "찾기"}</button>
    </form>

    {error && <p role="alert" style={{ margin: "10px 0", padding: "10px", borderRadius: "9px", background: wmsColors.warnSoft, color: wmsColors.warnText, fontSize: "12px", whiteSpace: "pre-wrap" }}>{error}</p>}
    {selectedEntries.length > 0 && <section style={{ ...wmsOuterCard, marginTop: "12px", padding: "12px", display: "grid", gap: "8px" }}>
      <strong style={{ fontSize: "14px" }}>재출력 목록 · {selectedEntries.length}종 · 총 {selectedQuantity}장</strong>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
        <button type="button" onClick={() => setSelected({})} disabled={generatingKey !== null} style={{ ...wmsSecondaryButton, minHeight: "46px" }}>목록 비우기</button>
        <button type="button" onClick={() => void generateSelected()} disabled={generatingKey !== null} style={{ ...wmsPrimaryButton, minHeight: "46px", opacity: generatingKey !== null ? .55 : 1 }}>{generatingKey === "__batch__" ? "한 파일 생성 중..." : "선택 바코드 한 파일로 재출력"}</button>
      </div>
    </section>}
    {!searching && results.length === 0 && query.trim().length >= 2 && !error && <p style={{ color: wmsColors.muted, fontSize: "13px" }}>검색 결과가 없습니다.</p>}
    <section style={{ display: "grid", gap: "9px", marginTop: "12px" }}>
      {results.map(result => {
        const key = `${result.purchaseOrderNumber}:${result.skuId}`;
        const quantity = quantities[key] || 1;
        return <article key={key} style={{ ...wmsOuterCard, padding: "12px" }}>
          <label style={{ display: "flex", gap: "9px", alignItems: "flex-start" }}><input type="checkbox" checked={Boolean(selected[key])} onChange={event => setSelected(previous => { const next = { ...previous }; if (event.target.checked) next[key] = result; else delete next[key]; return next; })} style={{ width: "20px", height: "20px", marginTop: "1px" }} /><strong style={{ display: "block", fontSize: "14px", lineHeight: 1.45 }}>{result.productName}</strong></label>
          <div style={{ marginTop: "5px", color: wmsColors.muted, fontSize: "12px", lineHeight: 1.6 }}>옵션 · {result.optionName || "옵션 없음"}<br />SKU {result.skuId} · 바코드 {result.barcode}<br />발주 {result.purchaseOrderNumber} · {result.fulfillmentCenter} · {result.expectedDate}</div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(92px, 120px) 1fr", gap: "8px", marginTop: "10px" }}>
            <label style={{ display: "grid", gap: "4px", fontSize: "11px", fontWeight: 800 }}>출력 장수<input type="number" min={1} max={1000} value={quantity} onChange={event => setQuantities(previous => ({ ...previous, [key]: Math.max(1, Math.min(1000, Math.floor(Number(event.target.value) || 1))) }))} style={{ minHeight: "44px", width: "100%", boxSizing: "border-box", border: `1px solid ${wmsColors.borderStrong}`, borderRadius: "9px", padding: "0 10px", fontSize: "16px" }} /></label>
            <button type="button" onClick={() => void generate(result)} disabled={generatingKey !== null} style={{ ...wmsSecondaryButton, width: "100%", minHeight: "44px", alignSelf: "end", opacity: generatingKey !== null ? .55 : 1 }}>{generatingKey === key ? "생성 중..." : quantity === 1 ? "바코드 1장 재출력" : `바코드 ${quantity}장 재출력`}</button>
          </div>
        </article>;
      })}
    </section>
  </main>;
}
