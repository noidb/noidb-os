"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { downloadBlobPreservingPage } from "@/lib/wms/download-client";
import { resolveDisplayNameAndOption } from "@/lib/wms/display-name";
import { LEGACY_REPRINT_KEY, REPRINT_SESSION_KEY, mergeReprintItems, reprintKey, restoreReprintSession, type BarcodeSearchResult, type ReprintItem } from "@/lib/wms/reprint-selection";
import { wmsColors, wmsOuterCard, wmsPrimaryButton, wmsSecondaryButton } from "@/lib/wms/ui-tokens";

export default function WmsReprintCenterPage() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ReprintItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState<"search" | "photo" | "save" | null>(null);
  const [photoProgress, setPhotoProgress] = useState("");
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photoSummary, setPhotoSummary] = useState<string[]>([]);
  const [removed, setRemoved] = useState<ReprintItem[] | null>(null);
  const itemsRef = useRef(items);
  const operationRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const queryRef = useRef<HTMLTextAreaElement>(null);
  const photoAbort = useRef<AbortController | null>(null);
  useEffect(() => () => photoAbort.current?.abort(), []);

  useEffect(() => {
    try {
      const restored = restoreReprintSession(sessionStorage.getItem(REPRINT_SESSION_KEY) ?? sessionStorage.getItem(LEGACY_REPRINT_KEY));
      itemsRef.current = restored.items;
      setItems(restored.items);
      setQuery(restored.query);
    } catch { /* The current tab remains usable without storage. */ }
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try { sessionStorage.setItem(REPRINT_SESSION_KEY, JSON.stringify({ query, items })); } catch { /* Preserve in-memory list. */ }
  }, [query, items, hydrated]);
  function updateItems(next: ReprintItem[]) { itemsRef.current = next; setItems(next); }

  async function findAndAdd(rawQuery: string, exact = false) {
    const response = await fetch("/api/wms/reprint/barcode?q=" + encodeURIComponent(rawQuery.trim()) + (exact ? "&exact=1" : ""), { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "검색하지 못했습니다.");
    const results = (data.results || []) as BarcodeSearchResult[];
    const known = new Set(itemsRef.current.map(reprintKey));
    const added = results.filter(item => !known.has(reprintKey(item))).length;
    updateItems(mergeReprintItems(itemsRef.current, results));
    setMessage(results.length ? "검색 " + results.length + "종 · 새로 추가 " + added + "종 · 기존 장수 유지" : "검색 결과가 없습니다.");
    if (data.unmatchedTerms?.length) setError("찾지 못한 번호: " + data.unmatchedTerms.join(", ") + ". 기존 목록은 그대로입니다.");
  }
  async function search(event: FormEvent) {
    event.preventDefault();
    if (operationRef.current) return;
    operationRef.current = true; setBusy("search"); setError(null); setMessage(null);
    try { await findAndAdd(query); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "검색하지 못했습니다."); }
    finally { operationRef.current = false; setBusy(null); queryRef.current?.focus({ preventScroll: true }); }
  }
  async function readPhotos(files: File[]) {
    if (operationRef.current) return;
    const photos = files.filter(file => file.type.startsWith("image/") || /\.(jpe?g|png|webp|bmp)$/i.test(file.name));
    if (!photos.length) { setError("JPG·PNG 사진을 끌어다 놓아 주세요."); return; }
    if (photos.length > 20 || photos.some(file => file.size > 25 * 1024 * 1024)) { setError("사진은 한 번에 20장까지, 한 장당 25MB 이하로 넣어 주세요."); return; }
    operationRef.current = true; setBusy("photo"); setError(null); setMessage(null); setPhotoSummary([]);
    const controller = new AbortController(); photoAbort.current = controller;
    const summaries: string[] = [];
    const barcodes = new Set<string>();
    try {
      const { readPhotoBarcodes } = await import("@/lib/wms/barcode-photo-client");
      for (let index = 0; index < photos.length; index++) {
        const file = photos[index];
        setPhotoProgress((index + 1) + "/" + photos.length + "장 분석 중");
        try {
          const result = await readPhotoBarcodes(file, percent => setPhotoProgress((index + 1) + "/" + photos.length + "장 · " + percent + "%"), controller.signal);
          result.barcodes.forEach(barcode => barcodes.add(barcode));
          summaries.push(file.name + ": " + result.barcodes.length + "개 인식" + (result.warning ? " · " + result.warning : result.barcodes.length ? "" : " · 더 가까운 사진 필요"));
        } catch (cause) { summaries.push(file.name + ": " + (cause instanceof Error ? cause.message : "인식 실패")); }
        setPhotoSummary([...summaries]);
        if (controller.signal.aborted) break;
      }
      if (!barcodes.size) throw new Error(controller.signal.aborted ? "사진 읽기를 중단했습니다. 기존 재출력 목록은 그대로입니다." : "읽힌 바코드가 없습니다. 라벨을 가까이 찍은 사진을 추가해 주세요. 기존 목록은 남아 있습니다.");
      const joined = [...barcodes].join("\n"); setQuery(joined);
      await findAndAdd(joined, true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "사진을 읽지 못했습니다."); }
    finally { photoAbort.current = null; operationRef.current = false; setBusy(null); setPhotoProgress(""); }
  }
  async function generateSelected() {
    const snapshot = itemsRef.current.filter(item => item.checked);
    if (!snapshot.length || operationRef.current) return;
    operationRef.current = true; setBusy("save"); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/wms/reprint/barcode", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: snapshot.map(item => ({ purchaseOrderNumber: item.purchaseOrderNumber, skuId: item.skuId, quantity: item.quantity })) }) });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || "재출력 파일을 만들지 못했습니다."); }
      const encoded = (response.headers.get("Content-Disposition") || "").match(/filename\*=UTF-8''([^;]+)/)?.[1];
      const total = snapshot.reduce((sum, item) => sum + item.quantity, 0);
      downloadBlobPreservingPage(await response.blob(), encoded ? decodeURIComponent(encoded) : "바코드선택재출력.xlsx");
      setMessage(snapshot.length + "종 · 총 " + total + "장 다운로드를 시작했습니다. BarTender에서 이 파일을 선택하세요. 목록은 다시 저장할 수 있도록 유지됩니다.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "재출력 파일을 만들지 못했습니다."); }
    finally { operationRef.current = false; setBusy(null); }
  }
  const selected = items.filter(item => item.checked);
  const total = selected.reduce((sum, item) => sum + item.quantity, 0);
  const disabled = !!busy || !hydrated;

  return <main className="shell reprint-center" style={{ color: wmsColors.ink, paddingTop: 16, paddingBottom: 150 }}>
    <div style={{ marginBottom: 16 }}><p className="eyebrow">WAREHOUSE REPRINT</p><h1 style={{ margin: "4px 0 8px", fontSize: 28 }}>바코드 일괄 재출력</h1><p className="note">사진이나 번호로 모으고, 필요한 상품만 골라 한 파일로 저장하세요.</p></div>
    <section style={{ ...wmsOuterCard, padding: 14 }} className="collect">
      <strong>1. 바코드 모으기</strong>
      <button type="button" aria-disabled={disabled} className={"photo" + (dragging ? " dragging" : "")}
        onClick={() => { if (!disabled) fileRef.current?.click(); }}
        onDragEnter={event => { event.preventDefault(); if (!disabled) setDragging(true); }}
        onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = disabled ? "none" : "copy"; }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={event => { event.preventDefault(); setDragging(false); if (!disabled) void readPhotos(Array.from(event.dataTransfer.files)); }}>
        <strong>{busy === "photo" ? "사진 읽는 중 · " + photoProgress : dragging ? "여기에 놓으세요" : "사진을 여기로 드래그앤드롭"}</strong>
        <span>또는 눌러서 여러 사진 선택 · PC·모바일 지원</span>
      </button>
      {busy === "photo" && <button type="button" style={wmsSecondaryButton} onClick={() => photoAbort.current?.abort()}>사진 읽기 중단</button>}
      <input ref={fileRef} type="file" aria-label="바코드 사진 선택" accept="image/*" multiple disabled={disabled} hidden onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; void readPhotos(files); }} />
      <p className="note">사진은 이 기기에서 분석합니다. 인식 개수를 확인하고, 부족하면 가까이 찍은 사진을 더 넣으세요. 중복은 한 번만 담습니다.</p>
      {!!photoSummary.length && <ul className="photo-results">{photoSummary.map((line, index) => <li key={index}>{line}</li>)}</ul>}
      <form onSubmit={search}><label htmlFor="barcode-query">바코드 전체·뒷자리, SKU 또는 발주번호</label>
        <textarea ref={queryRef} id="barcode-query" value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} placeholder={"예: 90009\n40002\n55002\n여러 번호를 줄바꿈해서 넣어도 됩니다."} rows={4} />
        <button type="submit" disabled={disabled || query.trim().length < 2} style={wmsPrimaryButton}>{busy === "search" ? "찾는 중…" : "찾아서 목록에 추가"}</button>
      </form>
    </section>
    {message && <p role="status" className="message">{message}</p>}
    {error && <p role="alert" className="error">{error}</p>}
    <section style={{ ...wmsOuterCard, marginTop: 12, padding: 12 }}>
      <div className="list-heading"><strong>2. 재출력 목록 {items.length}종 · 선택 {selected.length}종</strong>
        <div className="selection-actions">
          <button type="button" disabled={disabled || !items.length} onClick={() => updateItems(itemsRef.current.map(item => ({ ...item, checked: true })))} style={wmsSecondaryButton}>전체선택</button>
          <button type="button" disabled={disabled || !selected.length} onClick={() => updateItems(itemsRef.current.map(item => ({ ...item, checked: false })))} style={wmsSecondaryButton}>전체해제</button>
          <button type="button" disabled={disabled || !items.length} onClick={() => { setRemoved(itemsRef.current); updateItems([]); }} style={wmsSecondaryButton}>목록 비우기</button>
        </div>
      </div>
      <p className="note">전체해제는 체크만 해제합니다. 목록과 장수는 그대로 남습니다.</p>
      {removed && <button type="button" disabled={disabled} style={wmsSecondaryButton} onClick={() => { try { const merged = mergeReprintItems(itemsRef.current, removed); updateItems(merged.map(item => removed.find(old => reprintKey(old) === reprintKey(item)) || item)); setRemoved(null); } catch (cause) { setError(String(cause)); } }}>방금 지운 목록 복원</button>}
      {!items.length && <p className="empty">{hydrated ? "찾은 상품이 여기에 쌓입니다." : "이전 목록을 불러오는 중…"}</p>}
      {items.map((item, index) => {
        const display = resolveDisplayNameAndOption(item.productName, item.optionName);
        return <article key={reprintKey(item)} className="item">
          <input aria-label={item.barcode + " 선택"} type="checkbox" checked={item.checked} disabled={disabled} onChange={event => updateItems(itemsRef.current.map(entry => reprintKey(entry) === reprintKey(item) ? { ...entry, checked: event.target.checked } : entry))} />
          <div className="details"><strong>{index + 1}. {item.barcode}</strong><span>{display.name}</span>{display.option && <b>옵션 · {display.option}</b>}<small>SKU {item.skuId} · {item.fulfillmentCenter} · {item.expectedDate}</small></div>
          <label className="quantity">장수<input aria-label={item.barcode + " 출력 장수"} type="number" min={1} max={1000} disabled={disabled} value={item.quantity} onChange={event => { const quantity = Math.max(1, Math.min(1000, Math.floor(Number(event.target.value) || 1))); updateItems(itemsRef.current.map(entry => reprintKey(entry) === reprintKey(item) ? { ...entry, quantity } : entry)); }} /></label>
          <button type="button" aria-label={item.barcode + " 목록에서 삭제"} disabled={disabled} onClick={() => { setRemoved([item]); updateItems(itemsRef.current.filter(entry => reprintKey(entry) !== reprintKey(item))); }} style={wmsSecondaryButton}>×</button>
        </article>;
      })}
    </section>
    <div className="save-bar"><div><strong>선택 {selected.length}종 · 총 {total}장</strong><button type="button" disabled={disabled || !selected.length} onClick={() => void generateSelected()} style={wmsPrimaryButton}>{busy === "save" ? "한 파일 생성 중…" : "선택 바코드 한 파일로 저장"}</button></div></div>
    <style jsx>{`
      .collect, form { display:grid;gap:10px }
      .note { margin:6px 0;color:#726b62;font-size:12px;line-height:1.6 }
      form label { font-size:12px;font-weight:800 }
      textarea { width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #c9beb0;border-radius:10px;font-size:16px;resize:vertical }
      .photo { display:grid;gap:6px;padding:16px;min-height:88px;text-align:center;border:2px dashed #c9beb0!important;border-radius:12px;background:#faf8f4;color:#252a27;cursor:pointer }
      .photo span { font-size:12px;color:#726b62 }.photo.dragging { background:#e5eee7 }
      .photo-results { padding-left:18px;margin:0;font-size:12px;overflow-wrap:anywhere }
      .message,.error { padding:10px;border-radius:9px;font-size:13px;line-height:1.6;overflow-wrap:anywhere }
      .message { color:#42604a;background:#e5eee7 }.error { color:#9a471f;background:#fff0e7 }
      .list-heading { display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap }.list-heading strong { font-size:15px }
      .selection-actions { display:flex;gap:6px;flex-wrap:wrap }.selection-actions button { min-height:42px!important;padding:0 10px!important;font-size:12px!important }
      .item { margin-top:8px;border:1px solid #ded6cd;border-radius:10px;padding:10px;display:grid;grid-template-columns:24px minmax(0,1fr) 64px 38px;gap:8px;align-items:center }
      .item > input { width:20px;height:20px;accent-color:#617e6c }.details { min-width:0;overflow-wrap:anywhere;display:grid;gap:4px;font-size:12px }.details strong { font-size:13px }.details small { color:#726b62;font-size:10px }
      .item button { min-height:38px!important;padding:0!important }.quantity { display:grid;gap:4px;font-size:10px;font-weight:800 }.quantity input { min-height:40px;width:100%;box-sizing:border-box;border:1px solid #c9beb0;border-radius:8px;padding:0 6px;font-size:16px }
      .empty { text-align:center;color:#726b62;font-size:13px;padding:18px 0 }
      .save-bar { position:fixed;z-index:20;left:0;right:0;bottom:0;padding:10px max(12px,env(safe-area-inset-right)) calc(10px + env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left));background:rgba(248,246,241,.97);border-top:1px solid #c9beb0 }
      .save-bar > div { max-width:1072px;margin:auto;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:8px;align-items:center }.save-bar strong { font-size:13px;text-align:center }.save-bar button { width:100%;min-height:50px!important }
      button:disabled,button[aria-disabled="true"] { opacity:.5;cursor:default }
      @media(max-width:480px) { .save-bar > div { grid-template-columns:minmax(0,1fr) }.item { grid-template-columns:22px minmax(0,1fr) 56px 32px;gap:5px;padding:8px } }
    `}</style>
  </main>;
}
