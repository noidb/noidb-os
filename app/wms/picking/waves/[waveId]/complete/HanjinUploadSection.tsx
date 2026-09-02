"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BasketAssignment, PickingWaveItem, ShipmentOutputGeneration } from "@/lib/wms/picking-wave/types";
import { wmsColors, wmsGhostButton, wmsPrimaryButton } from "@/lib/wms/ui-tokens";
import type { ShipmentOutputPreview } from "@/lib/wms/shipment-output-context";
import { closeReservedDownloadTarget, downloadBlobPreservingPage, reserveDownloadTarget } from "@/lib/wms/download-client";

export interface HanjinGenerationResult { purchaseOrderNumbers: string[]; preview: ShipmentOutputPreview; fileName: string; }

interface Props {
  baskets: BasketAssignment[];
  items: PickingWaveItem[];
  generations: ShipmentOutputGeneration[];
  onGenerated?: (result: HanjinGenerationResult) => Promise<void> | void;
}

function collectPoMetrics(items: PickingWaveItem[]) {
  const result = new Map<string, { skuIds: Set<string>; quantity: number }>();
  for (const item of items) for (const source of item.sources) {
    const metric = result.get(source.purchaseOrderNumber) || { skuIds: new Set<string>(), quantity: 0 };
    metric.skuIds.add(item.productCode);
    metric.quantity += source.requestedQuantity;
    result.set(source.purchaseOrderNumber, metric);
  }
  return result;
}

function samePoSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every(value => rightSet.has(value));
}

const PREVIEW_SESSION_TTL_MS = 5 * 60 * 1000;

function readSessionPreview(key: string): ShipmentOutputPreview | null {
  try {
    const cached = JSON.parse(sessionStorage.getItem(key) || "null") as { savedAt?: number; preview?: ShipmentOutputPreview } | null;
    return cached?.preview && Date.now() - Number(cached.savedAt || 0) < PREVIEW_SESSION_TTL_MS ? cached.preview : null;
  } catch { return null; }
}

function writeSessionPreview(key: string, preview: ShipmentOutputPreview) {
  try { sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), preview })); } catch { /* 메모리 캐시만 사용 */ }
}

export default function HanjinUploadSection({ baskets, items, generations, onGenerated }: Props) {
  const allPoNumbers = useMemo(() => [...new Set(baskets.map(basket => basket.purchaseOrderNumber).filter(Boolean))], [baskets]);
  const basketByPo = useMemo(() => new Map(baskets.map(basket => [basket.purchaseOrderNumber, basket])), [baskets]);
  const metricsByPo = useMemo(() => collectPoMetrics(items), [items]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openCenters, setOpenCenters] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<ShipmentOutputPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewCacheRef = useRef(new Map<string, ShipmentOutputPreview>());
  const [stateHydrated, setStateHydrated] = useState(false);
  const persistenceKey = baskets[0]?.waveId ? `noidb:wms:hanjin-selection:${baskets[0].waveId}` : "";

  useEffect(() => {
    if (!persistenceKey) return;
    try {
      const stored = JSON.parse(sessionStorage.getItem(persistenceKey) || "null") as { selected?: string[]; openCenters?: string[] } | null;
      const validPoNumbers = new Set(allPoNumbers);
      const restoredSelection = Array.isArray(stored?.selected)
        ? stored.selected.filter(po => validPoNumbers.has(po))
        : allPoNumbers;
      setSelected(new Set(restoredSelection));
      setOpenCenters(new Set(stored?.openCenters || []));
    } catch {
      setSelected(new Set(allPoNumbers));
    } finally {
      setStateHydrated(true);
    }
  }, [allPoNumbers, persistenceKey]);
  useEffect(() => {
    if (!persistenceKey || !stateHydrated) return;
    sessionStorage.setItem(persistenceKey, JSON.stringify({ selected: [...selected], openCenters: [...openCenters] }));
  }, [openCenters, persistenceKey, selected, stateHydrated]);
  const selectedPoNumbers = useMemo(() => allPoNumbers.filter(po => selected.has(po)), [allPoNumbers, selected]);
  const selectionFingerprint = useMemo(() => [...selectedPoNumbers].sort().join("|"), [selectedPoNumbers]);

  const centerGroups = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const po of allPoNumbers) {
      const center = basketByPo.get(po)?.fulfillmentCenter?.trim() || "센터 미확인";
      if (!groups.has(center)) groups.set(center, []);
      groups.get(center)!.push(po);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "ko"));
  }, [allPoNumbers, basketByPo]);

  useEffect(() => {
    if (!selectedPoNumbers.length) { setPreview(null); setPreviewLoading(false); return; }
    const sessionKey = `noidb:wms:hanjin-preview:${selectionFingerprint}`;
    const cached = previewCacheRef.current.get(selectionFingerprint);
    if (cached) { setPreview(cached); setPreviewLoading(false); return; }
    const sessionCached = readSessionPreview(sessionKey);
    if (sessionCached) {
      previewCacheRef.current.set(selectionFingerprint, sessionCached);
      setPreview(sessionCached);
      setPreviewLoading(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setPreview(null);
    setPreviewLoading(true);
    setError(null);
    // 여러 체크박스를 연속 조작할 때 중간 선택마다 무거운 원본 인덱스를 다시 만들지 않는다.
    const timer = window.setTimeout(() => {
      fetch("/api/wms/hanjin-upload/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ purchaseOrderNumbers: selectedPoNumbers }), signal: controller.signal })
        .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "완전성 검사 실패"); return data.preview as ShipmentOutputPreview; })
        .then(nextPreview => { previewCacheRef.current.set(selectionFingerprint, nextPreview); writeSessionPreview(sessionKey, nextPreview); if (active) setPreview(nextPreview); })
        .catch(cause => { if (active && !(cause instanceof DOMException && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : "송장 완전성 검사에 실패했습니다."); })
        .finally(() => { if (active) setPreviewLoading(false); });
    }, 120);
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [selectedPoNumbers, selectionFingerprint]);

  const selectedMetrics = useMemo(() => {
    const skuIds = new Set<string>(); let quantity = 0;
    for (const po of selectedPoNumbers) { const metric = metricsByPo.get(po); metric?.skuIds.forEach(sku => skuIds.add(sku)); quantity += metric?.quantity || 0; }
    return { skuCount: skuIds.size, quantity };
  }, [metricsByPo, selectedPoNumbers]);

  function toggleOne(po: string) {
    setSelected(current => { const next = new Set(current); if (next.has(po)) next.delete(po); else next.add(po); return next; });
  }

  function toggleCenter(centerPoNumbers: string[]) {
    setSelected(current => {
      const next = new Set(current);
      const allSelected = centerPoNumbers.every(po => next.has(po));
      for (const po of centerPoNumbers) allSelected ? next.delete(po) : next.add(po);
      return next;
    });
  }

  async function handleGenerate() {
    if (!preview?.canGenerate || selectedPoNumbers.length === 0) return;
    const exact = generations.find(generation => samePoSet(generation.purchaseOrderNumbers, selectedPoNumbers));
    const overlap = generations.find(generation => !samePoSet(generation.purchaseOrderNumbers, selectedPoNumbers) && generation.purchaseOrderNumbers.some(po => selected.has(po)));
    if (overlap && !window.confirm("이전에 만든 다른 출력 묶음과 일부 발주가 겹칩니다. 새 묶음으로 계속 생성하시겠습니까?")) return;
    const downloadTarget = reserveDownloadTarget();
    setGenerating(true); setError(null); setResultMessage(null);
    try {
      const response = await fetch("/api/wms/hanjin-upload/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ purchaseOrderNumbers: selectedPoNumbers }) });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || "한진택배 업로드파일 생성에 실패했습니다."); }
      const addedSet = new Set(decodeURIComponent(response.headers.get("X-Added-Po-Numbers") || "").split(",").filter(Boolean));
      if (addedSet.size !== selectedPoNumbers.length || selectedPoNumbers.some(po => !addedSet.has(po))) throw new Error("생성 결과의 발주번호 집합이 요청과 일치하지 않아 다운로드를 차단했습니다.");
      const disposition = response.headers.get("Content-Disposition") || "";
      const fileNameMatch = disposition.match(/filename\*=UTF-8''(.+)$/);
      const fileName = fileNameMatch ? decodeURIComponent(fileNameMatch[1]) : "한진택배_업로드.xlsx";
      downloadBlobPreservingPage(await response.blob(), fileName, downloadTarget);
      await onGenerated?.({ purchaseOrderNumbers: selectedPoNumbers, preview, fileName });
      setResultMessage(exact ? `동일한 발주 ${selectedPoNumbers.length}건 기준으로 다시 생성했습니다.` : `새 출력 묶음: 발주 ${selectedPoNumbers.length}건 · 송장 ${preview.shippingGroupCount}행`);
    } catch (cause) { closeReservedDownloadTarget(downloadTarget); setError(cause instanceof Error ? cause.message : "한진택배 업로드파일 생성 중 오류가 발생했습니다."); }
    finally { setGenerating(false); }
  }

  if (!allPoNumbers.length) return null;
  const exactGeneration = generations.some(generation => samePoSet(generation.purchaseOrderNumbers, selectedPoNumbers));

  return <div>
    <div style={{ padding: "10px", marginBottom: "9px", borderRadius: "8px", background: preview?.canGenerate ? "#f0f7f3" : "#fff4f1", fontSize: "11px", lineHeight: 1.65 }}>
      <strong>선택 {selectedPoNumbers.length}/{allPoNumbers.length}</strong>
      {preview ? ` · 센터 ${preview.fulfillmentCenterCount} · 예상 송장 ${preview.shippingGroupCount} · SKU ${selectedMetrics.skuCount} · 수량 ${selectedMetrics.quantity}` : ` · 센터 ${new Set(selectedPoNumbers.map(po => basketByPo.get(po)?.fulfillmentCenter || "센터 미확인")).size} · SKU ${selectedMetrics.skuCount} · 수량 ${selectedMetrics.quantity}`}<br />
      <span style={{ color: preview?.canGenerate ? wmsColors.greenDark : wmsColors.warnText }}>{preview?.canGenerate ? "Source-of-Truth 검증 완료" : preview ? "생성 차단" : "선택 발주 원본 검증 중"}</span>
      {preview?.blockingReasons.length ? <div style={{ color: "#b33f35" }}>{preview.blockingReasons.join(" · ")}</div> : null}
    </div>
    <div style={{ display: "flex", gap: "7px", marginBottom: "8px" }}>
      <button type="button" onClick={() => setSelected(new Set(allPoNumbers))} style={{ ...wmsGhostButton, flex: 1, minHeight: "38px" }}>전체선택</button>
      <button type="button" onClick={() => setSelected(new Set())} style={{ ...wmsGhostButton, flex: 1, minHeight: "38px" }}>전체해제</button>
    </div>
    <div style={{ display: "grid", gap: "7px", marginBottom: "10px" }}>
      {centerGroups.map(([center, poNumbers]) => {
        const open = openCenters.has(center);
        const centerSkuIds = new Set<string>(); let centerQuantity = 0;
        for (const po of poNumbers) { const metric = metricsByPo.get(po); metric?.skuIds.forEach(sku => centerSkuIds.add(sku)); centerQuantity += metric?.quantity || 0; }
        const selectedCount = poNumbers.filter(po => selected.has(po)).length;
        return <section key={center} style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "9px", overflow: "hidden", background: "#fff" }}>
          <button type="button" onClick={() => setOpenCenters(current => { const next = new Set(current); next.has(center) ? next.delete(center) : next.add(center); return next; })} aria-expanded={open} style={{ width: "100%", border: 0, padding: "10px", background: wmsColors.surfaceBeige, display: "flex", alignItems: "center", gap: "8px", textAlign: "left", cursor: "pointer" }}>
            <span style={{ flex: 1, minWidth: 0 }}><strong style={{ display: "block", fontSize: "13px" }}>{center}</strong><span style={{ fontSize: "11px", color: wmsColors.muted }}>발주 {poNumbers.length}건 · SKU {centerSkuIds.size} · 총수량 {centerQuantity} · 선택 {selectedCount}</span></span><span>{open ? "▲" : "▼"}</span>
          </button>
          {open && <div>
            <button type="button" onClick={() => toggleCenter(poNumbers)} style={{ ...wmsGhostButton, width: "calc(100% - 16px)", margin: "8px", minHeight: "34px", fontSize: "11px" }}>{selectedCount === poNumbers.length ? "센터 전체해제" : "센터 전체선택"}</button>
            {poNumbers.map(po => { const metric = metricsByPo.get(po); return <label key={po} style={{ display: "flex", gap: "9px", alignItems: "center", minHeight: "48px", padding: "6px 9px", borderTop: `1px solid ${wmsColors.border}`, cursor: "pointer" }}>
              <input type="checkbox" checked={selected.has(po)} onChange={() => toggleOne(po)} style={{ width: "20px", height: "20px", flexShrink: 0 }} />
              <span style={{ minWidth: 0, flex: 1 }}><strong style={{ display: "block", fontSize: "12px" }}>발주서 {po}</strong><span style={{ color: wmsColors.muted, fontSize: "11px" }}>SKU {metric?.skuIds.size || 0} · 수량 {metric?.quantity || 0}</span></span>
            </label>; })}
          </div>}
        </section>;
      })}
    </div>
    {error && <p style={{ fontSize: "11px", color: "#c0392b", marginBottom: "8px" }}>{error}</p>}
    {resultMessage && <p style={{ fontSize: "11px", color: wmsColors.greenDark, marginBottom: "8px" }}>{resultMessage}</p>}
    <button onClick={handleGenerate} disabled={generating || previewLoading || !preview?.canGenerate || selectedPoNumbers.length === 0} style={{ ...wmsPrimaryButton, width: "100%", opacity: generating || previewLoading || !preview?.canGenerate ? 0.6 : 1 }}>{generating ? "생성 중..." : previewLoading ? "원본 검증 중..." : exactGeneration ? "동일 선택 송장파일 다시 생성" : "선택 발주 송장파일 생성"}</button>
  </div>;
}
