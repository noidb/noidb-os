"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
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

interface SelectedBarcode extends BarcodeSearchResult {
  quantity: number;
}

interface BarcodeDetectorResult { rawValue: string }
interface BarcodeDetectorInstance { detect(source: ImageBitmap): Promise<BarcodeDetectorResult[]> }
interface BarcodeDetectorConstructor {
  new(options?: { formats?: string[] }): BarcodeDetectorInstance;
  getSupportedFormats?: () => Promise<string[]>;
}

const SELECTION_STORAGE_KEY = "noidb_wms_reprint_selection_v1";

function resultKey(result: Pick<BarcodeSearchResult, "skuId" | "barcode">) {
  return `${result.skuId}:${result.barcode}`;
}

function loadSavedSelection(): SelectedBarcode[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.sessionStorage.getItem(SELECTION_STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value.slice(0, 200) : [];
  } catch {
    return [];
  }
}

export default function WmsReprintCenterPage() {
  const [query, setQuery] = useState("");
  const [lastResults, setLastResults] = useState<BarcodeSearchResult[]>([]);
  const [selected, setSelected] = useState<SelectedBarcode[]>(loadSavedSelection);
  const [searching, setSearching] = useState(false);
  const [readingPhoto, setReadingPhoto] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    window.sessionStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(selected));
  }, [selected]);

  function addAll(results: BarcodeSearchResult[]) {
    setSelected(previous => {
      const known = new Set(previous.map(resultKey));
      const additions = results.filter(result => !known.has(resultKey(result))).map(result => ({ ...result, quantity: 1 }));
      return [...previous, ...additions].slice(0, 200);
    });
  }

  async function findAndAdd(rawQuery: string) {
    const trimmed = rawQuery.trim();
    if (trimmed.length < 2) return;
    setSearching(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/wms/reprint/barcode?q=${encodeURIComponent(trimmed)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "검색하지 못했습니다.");
      const results = (data.results || []) as BarcodeSearchResult[];
      setLastResults(results);
      addAll(results);
      setMessage(results.length ? `검색 결과 ${results.length}개를 모두 선택했습니다.` : "검색 결과가 없습니다.");
      if (results.length === 1) setQuery("");
      window.requestAnimationFrame(() => queryRef.current?.focus());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "검색하지 못했습니다.");
    } finally {
      setSearching(false);
    }
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    await findAndAdd(query);
  }

  async function readPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setReadingPhoto(true);
    setError(null);
    try {
      const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
      if (!Detector) throw new Error("이 브라우저는 사진 바코드 자동읽기를 지원하지 않습니다. 아래 입력칸에 바코드 여러 개를 줄바꿈해 붙여넣어 주세요.");
      const supported = await Detector.getSupportedFormats?.();
      const preferred = ["code_128", "ean_13", "ean_8", "data_matrix", "qr_code"].filter(format => !supported || supported.includes(format));
      const detector = new Detector(preferred.length ? { formats: preferred } : undefined);
      const bitmap = await createImageBitmap(file);
      const detected = await detector.detect(bitmap);
      bitmap.close();
      const barcodes = [...new Set(detected.map(item => item.rawValue.trim()).filter(Boolean))];
      if (!barcodes.length) throw new Error("사진에서 바코드를 읽지 못했습니다. 더 가까이 찍거나 아래 입력칸에 바코드 뒷자리들을 줄바꿈해 입력해 주세요.");
      const joined = barcodes.join("\n");
      setQuery(joined);
      await findAndAdd(joined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "사진에서 바코드를 읽지 못했습니다.");
    } finally {
      setReadingPhoto(false);
    }
  }

  async function generateSelected() {
    if (!selected.length) return;
    const target = reserveDownloadTarget();
    setGenerating(true);
    setError(null);
    try {
      const response = await fetch("/api/wms/reprint/barcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: selected.map(item => ({ purchaseOrderNumber: item.purchaseOrderNumber, skuId: item.skuId, quantity: item.quantity })) }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "재출력 파일을 만들지 못했습니다.");
      }
      const disposition = response.headers.get("Content-Disposition") || "";
      const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1];
      const total = selected.reduce((sum, item) => sum + item.quantity, 0);
      downloadBlobPreservingPage(await response.blob(), encoded ? decodeURIComponent(encoded) : `바코드선택재출력_${selected.length}종_${total}장.xlsx`, target);
      setMessage(`${selected.length}종 · 총 ${total}장을 XLSX 한 파일로 저장했습니다.`);
    } catch (cause) {
      closeReservedDownloadTarget(target);
      setError(cause instanceof Error ? cause.message : "재출력 파일을 만들지 못했습니다.");
    } finally {
      setGenerating(false);
    }
  }

  const totalQuantity = selected.reduce((sum, item) => sum + item.quantity, 0);

  return <main className="shell wms-work-center-shell" style={{ fontFamily: "sans-serif", color: wmsColors.ink, paddingBottom: selected.length ? "120px" : "40px" }}>
    <div style={{ margin: "18px 0 14px" }}>
      <p className="eyebrow">WAREHOUSE REPRINT</p>
      <h1 style={{ margin: "4px 0 6px", fontSize: "28px" }}>바코드 일괄 재출력</h1>
      <p style={{ margin: 0, color: wmsColors.muted, fontSize: "13px", lineHeight: 1.6 }}>필요한 바코드를 계속 모은 뒤 마지막에 XLSX 한 파일만 저장합니다.</p>
    </div>

    <section style={{ ...wmsOuterCard, padding: "14px", display: "grid", gap: "10px" }}>
      <strong style={{ fontSize: "15px" }}>1. 바코드 모으기</strong>
      <label htmlFor="barcode-photo" style={{ ...wmsSecondaryButton, minHeight: "46px", display: "flex", alignItems: "center", justifyContent: "center", cursor: readingPhoto ? "wait" : "pointer", boxSizing: "border-box" }}>
        {readingPhoto ? "사진에서 읽는 중..." : "📷 사진에서 바코드 한꺼번에 찾기"}
      </label>
      <input id="barcode-photo" type="file" accept="image/*" capture="environment" onChange={event => void readPhoto(event)} disabled={readingPhoto || searching} style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }} />
      <form onSubmit={search} style={{ display: "grid", gap: "8px" }}>
        <label htmlFor="barcode-query" style={{ fontSize: "12px", fontWeight: 800 }}>또는 바코드 전체·뒷자리 여러 개 입력</label>
        <textarea ref={queryRef} id="barcode-query" value={query} onChange={event => setQuery(event.target.value)} placeholder={"예: 90009\n40002\n55002\n\n한 개씩 입력해도 기존 목록에 계속 쌓입니다."} rows={5} style={{ width: "100%", minHeight: "116px", resize: "vertical", boxSizing: "border-box", border: `1px solid ${wmsColors.borderStrong}`, borderRadius: "10px", padding: "10px 12px", fontSize: "16px" }} />
        <button type="submit" disabled={searching || query.trim().length < 2} style={{ ...wmsPrimaryButton, width: "100%", minHeight: "48px", opacity: searching || query.trim().length < 2 ? .55 : 1 }}>{searching ? "목록에 추가 중..." : "찾아서 모두 선택"}</button>
      </form>
      <p style={{ margin: 0, color: wmsColors.muted, fontSize: "12px", lineHeight: 1.6 }}>검색된 결과는 처음부터 모두 선택됩니다. 다른 바코드를 다시 검색해도 기존 목록은 사라지지 않습니다.</p>
    </section>

    {message ? <p role="status" style={{ margin: "10px 0", padding: "10px", borderRadius: "9px", background: wmsColors.greenSoft, color: wmsColors.greenDark, fontSize: "13px", fontWeight: 700 }}>{message}</p> : null}
    {error ? <p role="alert" style={{ margin: "10px 0", padding: "10px", borderRadius: "9px", background: wmsColors.warnSoft, color: wmsColors.warnText, fontSize: "12px", whiteSpace: "pre-wrap" }}>{error}</p> : null}

    <section style={{ ...wmsOuterCard, marginTop: "12px", padding: "12px", display: "grid", gap: "9px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
        <strong style={{ fontSize: "15px" }}>2. 재출력 목록 · {selected.length}종 · 총 {totalQuantity}장</strong>
        <div style={{ display: "flex", gap: "6px" }}>
          <button type="button" onClick={() => addAll(lastResults)} disabled={!lastResults.length || generating} style={{ ...wmsSecondaryButton, minHeight: "38px", padding: "0 12px" }}>전체선택</button>
          <button type="button" onClick={() => setSelected([])} disabled={!selected.length || generating} style={{ ...wmsSecondaryButton, minHeight: "38px", padding: "0 12px" }}>전체해제</button>
        </div>
      </div>
      {!selected.length ? <p style={{ margin: "8px 0", color: wmsColors.muted, fontSize: "13px", textAlign: "center" }}>위에서 바코드를 찾으면 검색 결과가 여기에 모두 선택됩니다.</p> : null}
      {selected.map((item, index) => <article key={resultKey(item)} style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "10px", padding: "10px", display: "grid", gridTemplateColumns: "minmax(0, 1fr) 76px 42px", gap: "8px", alignItems: "center" }}>
        <div style={{ minWidth: 0 }}>
          <strong style={{ display: "block", fontSize: "13px" }}>{index + 1}. {item.barcode}</strong>
          <span style={{ display: "block", marginTop: "3px", color: wmsColors.muted, fontSize: "11px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.productName} · {item.optionName || "옵션 없음"}</span>
        </div>
        <label style={{ display: "grid", gap: "3px", fontSize: "10px", fontWeight: 800 }}>장수<input aria-label={`${item.barcode} 출력 장수`} type="number" min={1} max={1000} value={item.quantity} onChange={event => {
          const quantity = Math.max(1, Math.min(1000, Math.floor(Number(event.target.value) || 1)));
          setSelected(previous => previous.map(entry => resultKey(entry) === resultKey(item) ? { ...entry, quantity } : entry));
        }} style={{ minHeight: "38px", width: "100%", boxSizing: "border-box", border: `1px solid ${wmsColors.borderStrong}`, borderRadius: "8px", padding: "0 8px", fontSize: "15px" }} /></label>
        <button type="button" aria-label={`${item.barcode} 목록에서 삭제`} onClick={() => setSelected(previous => previous.filter(entry => resultKey(entry) !== resultKey(item)))} style={{ ...wmsSecondaryButton, minHeight: "38px", padding: 0 }}>×</button>
      </article>)}
    </section>

    {selected.length ? <div style={{ position: "fixed", zIndex: 20, left: 0, right: 0, bottom: 0, padding: "10px max(12px, env(safe-area-inset-right)) calc(10px + env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left))", background: "rgba(248, 246, 241, .96)", borderTop: `1px solid ${wmsColors.borderStrong}`, backdropFilter: "blur(8px)" }}>
      <div style={{ width: "min(100%, 1068px)", margin: "0 auto", display: "grid", gridTemplateColumns: "minmax(130px, .55fr) minmax(190px, 1fr)", gap: "8px", alignItems: "center" }}>
        <strong style={{ fontSize: "13px", textAlign: "center" }}>{selected.length}종 · 총 {totalQuantity}장</strong>
        <button type="button" onClick={() => void generateSelected()} disabled={generating} style={{ ...wmsPrimaryButton, width: "100%", minHeight: "50px", opacity: generating ? .55 : 1 }}>{generating ? "한 파일 생성 중..." : "전체 바코드 XLSX 한 파일로 저장"}</button>
      </div>
    </div> : null}
  </main>;
}
