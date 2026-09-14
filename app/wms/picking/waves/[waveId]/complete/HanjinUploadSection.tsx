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
    return cached?.preview?.canGenerate && Date.now() - Number(cached.savedAt || 0) < PREVIEW_SESSION_TTL_MS ? cached.preview : null;
  } catch { return null; }
}

function writeSessionPreview(key: string, preview: ShipmentOutputPreview) {
  try { sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), preview })); } catch { /* 메모리 캐시만 사용 */ }
}

export default function HanjinUploadSection({ baskets, items, generations, onGenerated }: Props) {
  const allPoNumbers = useMemo(() => [...new Set(baskets.map(basket => basket.purchaseOrderNumber).filter(Boolean))], [baskets]);
  const basketByPo = useMemo(() => new Map(baskets.map(basket => [basket.purchaseOrderNumber, basket])), [baskets]);
  const metricsByPo = useMemo(() => collectPoMetrics(items), [items]);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const previousGroups = useRef<string[][] | null>(null);
  const [invoiceGroups, setInvoiceGroups] = useState<string[][] | null>(null);
  const [selected, setSelectedState] = useState<Set<string>>(new Set());
  const [openCenters, setOpenCenters] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<ShipmentOutputPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewRefresh, setPreviewRefresh] = useState(0);
  const lastPreviewAttempt = useRef(0);
  const previewCacheRef = useRef(new Map<string, ShipmentOutputPreview>());
  const [stateHydrated, setStateHydrated] = useState(false);
  const persistenceKey = baskets[0]?.waveId ? `noidb:wms:hanjin-selection:${baskets[0].waveId}` : "";

  useEffect(() => {
    if (!persistenceKey) return;
    try {
      const stored = JSON.parse(sessionStorage.getItem(persistenceKey) || "null") as { selected?: string[]; openCenters?: string[]; invoiceGroups?: string[][] } | null;
      const validPoNumbers = new Set(allPoNumbers);
      const restoredSelection = Array.isArray(stored?.selected)
        ? stored.selected.filter(po => validPoNumbers.has(po))
        : allPoNumbers;
      setSelectedState(new Set(restoredSelection));
      const restoredGroups = stored?.invoiceGroups;
      setInvoiceGroups(Array.isArray(restoredGroups) && restoredGroups.every(group => Array.isArray(group) && group.length > 0) && samePoSet(restoredGroups.flat(), restoredSelection) ? restoredGroups : null);
      setOpenCenters(new Set(stored?.openCenters || []));
    } catch {
      setSelected(new Set(allPoNumbers));
    } finally {
      setStateHydrated(true);
    }
  }, [allPoNumbers, persistenceKey]);
  useEffect(() => {
    if (!persistenceKey || !stateHydrated) return;
    sessionStorage.setItem(persistenceKey, JSON.stringify({ selected: [...selected], openCenters: [...openCenters], invoiceGroups }));
  }, [openCenters, persistenceKey, selected, stateHydrated, invoiceGroups]);
  const selectedPoNumbers = useMemo(() => allPoNumbers.filter(po => selected.has(po)), [allPoNumbers, selected]);
  const selectedKey = [...selectedPoNumbers].sort().join("|");
  const selectionFingerprint = JSON.stringify(["250-balanced-v1", selectedKey, invoiceGroups]);
  function setSelected(value: Set<string> | ((current: Set<string>) => Set<string>)) {
    setInvoiceGroups(null);
    setSelectedState(value);
  }

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
    if (cached?.canGenerate && previewRefresh === 0) { setPreview(cached); setPreviewLoading(false); return; }
    const sessionCached = readSessionPreview(sessionKey);
    if (sessionCached && previewRefresh === 0) {
      previewCacheRef.current.set(selectionFingerprint, sessionCached);
      setPreview(sessionCached);
      setPreviewLoading(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setPreview(null);
    setPreviewLoading(true);
    lastPreviewAttempt.current = Date.now();
    setError(null);
    // 여러 체크박스를 연속 조작할 때 중간 선택마다 무거운 원본 인덱스를 다시 만들지 않는다.
    const timer = window.setTimeout(() => {
      fetch("/api/wms/hanjin-upload/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ waveId: baskets[0]?.waveId || items[0]?.waveId, purchaseOrderNumbers: selectedPoNumbers, invoiceGroups: invoiceGroups ?? undefined }), signal: controller.signal })
        .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "완전성 검사 실패"); return data.preview as ShipmentOutputPreview; })
        .then(nextPreview => {
          if (!active) return;
          // Unresolved addresses must be checked again after recovery, never reused as a cached failure.
          if (nextPreview.canGenerate) {
            previewCacheRef.current.set(selectionFingerprint, nextPreview);
            writeSessionPreview(sessionKey, nextPreview);
          } else {
            previewCacheRef.current.delete(selectionFingerprint);
            try { sessionStorage.removeItem(sessionKey); } catch { /* Storage may be unavailable. */ }
          }
          setPreview(nextPreview);
        })
        .catch(cause => { if (active && !(cause instanceof DOMException && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : "송장 완전성 검사에 실패했습니다."); })
        .finally(() => { if (active) setPreviewLoading(false); });
    }, 120);
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [selectedPoNumbers, selectionFingerprint, invoiceGroups, previewRefresh]);

  useEffect(() => {
    const retryWhenBack = () => {
      if (document.visibilityState === "visible" && !previewLoading &&
          (error || preview?.missingPostalCodeCenters?.length) && Date.now() - lastPreviewAttempt.current > 30_000) {
        setPreviewRefresh(value => value + 1);
      }
    };
    window.addEventListener("focus", retryWhenBack);
    document.addEventListener("visibilitychange", retryWhenBack);
    return () => {
      window.removeEventListener("focus", retryWhenBack);
      document.removeEventListener("visibilitychange", retryWhenBack);
    };
  }, [error, preview, previewLoading]);

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
    if (generating || previewLoading || !preview?.canGenerate || selectedPoNumbers.length === 0) return;
    if (generations.some(g => !g.supersededByGenerationId && g.purchaseOrderNumbers.some(po => selected.has(po)) && g.purchaseOrderNumbers.some(po => !selected.has(po)))) { setError("기존 출력 대상의 일부 발주만 겹칩니다. 기존 대상 전체를 선택하거나 겹치지 않는 발주를 선택해 주세요."); return; }
    const exact = generations.find(generation => samePoSet(generation.purchaseOrderNumbers, selectedPoNumbers));
    const overlap = generations.find(generation => !generation.supersededByGenerationId && !samePoSet(generation.purchaseOrderNumbers, selectedPoNumbers) && generation.purchaseOrderNumbers.some(po => selected.has(po)));
    if (overlap && !window.confirm("기존 출력 대상과 발주가 겹칩니다. 이전 기록을 보존하고 이번 송장파일 대상으로 Shipment와 출력세트를 새로 연결하시겠습니까?")) return;
    const downloadTarget = reserveDownloadTarget();
    setGenerating(true); setError(null); setResultMessage(null);
    try {
      const response = await fetch("/api/wms/hanjin-upload/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ waveId: baskets[0]?.waveId || items[0]?.waveId, purchaseOrderNumbers: selectedPoNumbers, invoiceGroups: preview.shippingGroups.map(group => group.purchaseOrderNumbers) }) });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || "한진택배 업로드파일 생성에 실패했습니다."); }
      const addedSet = new Set(decodeURIComponent(response.headers.get("X-Added-Po-Numbers") || "").split(",").filter(Boolean));
      if (addedSet.size !== selectedPoNumbers.length || selectedPoNumbers.some(po => !addedSet.has(po))) throw new Error("생성 결과의 발주번호 집합이 요청과 일치하지 않아 다운로드를 차단했습니다.");
      const disposition = response.headers.get("Content-Disposition") || "";
      const fileNameMatch = disposition.match(/filename\*=UTF-8''(.+)$/);
      const fileName = fileNameMatch ? decodeURIComponent(fileNameMatch[1]) : "한진택배_업로드.xlsx";
      const driveSaved = response.headers.get("X-NOIDB-Drive-Saved") === "true";
      const driveWarning = decodeURIComponent(response.headers.get("X-NOIDB-Drive-Save-Warning") || "");
      downloadBlobPreservingPage(await response.blob(), fileName, downloadTarget);
      await onGenerated?.({ purchaseOrderNumbers: selectedPoNumbers, preview, fileName });
      const baseMessage = exact ? `동일한 발주 ${selectedPoNumbers.length}건 기준으로 다시 생성했습니다.` : `새 출력 묶음: 발주 ${selectedPoNumbers.length}건 · 송장 ${preview.shippingGroupCount}행`;
      setResultMessage(`${baseMessage}${driveSaved ? " · Drive 자동저장 완료" : driveWarning ? ` · ${driveWarning}` : ""}`);
    } catch (cause) { closeReservedDownloadTarget(downloadTarget); setError(cause instanceof Error ? cause.message : "한진택배 업로드파일 생성 중 오류가 발생했습니다."); }
    finally { setGenerating(false); }
  }

  if (!allPoNumbers.length) return null;
  const exactGeneration = generations.some(generation => samePoSet(generation.purchaseOrderNumbers, selectedPoNumbers));

  return <div>
    <div style={{ padding: "10px", marginBottom: "9px", borderRadius: "8px", background: preview?.canGenerate ? "#f0f7f3" : "#fff4f1", fontSize: "11px", lineHeight: 1.65 }}>
      <strong>선택 {selectedPoNumbers.length}/{allPoNumbers.length}</strong>
      {preview ? ` · 센터 ${preview.fulfillmentCenterCount} · 예상 송장 ${preview.shippingGroupCount} · SKU ${selectedMetrics.skuCount} · 수량 ${selectedMetrics.quantity}` : ` · 센터 ${new Set(selectedPoNumbers.map(po => basketByPo.get(po)?.fulfillmentCenter || "센터 미확인")).size} · SKU ${selectedMetrics.skuCount} · 수량 ${selectedMetrics.quantity}`}<br />
      <span style={{ color: preview?.canGenerate ? wmsColors.greenDark : wmsColors.warnText }}>{preview?.canGenerate ? "송장 생성 준비 완료" : preview ? "송장 생성 전 확인이 필요합니다" : "발주서·센터 주소·우편번호 자동 확인 중…"}</span>
      {preview?.blockingReasons.length ? <div style={{ color: "#b33f35" }}>{preview.blockingReasons.join(" · ")}</div> : null}
      {preview?.destinationResolutions?.filter(result => result.status !== "approved").map(result => (
        <div key={result.fulfillmentCenterName + result.sourceAddress} style={{ marginTop: "6px" }}>
          <strong>{result.fulfillmentCenterName} · 우편번호 자동 확인 필요</strong><br />
          {result.sourceAddress}<br />{result.reason}
        </div>
      ))}
      {(error || preview && !preview.canGenerate) && <button type="button" disabled={previewLoading} onClick={() => setPreviewRefresh(value => value + 1)} style={{ ...wmsGhostButton, marginTop: "8px" }}>주소·우편번호 다시 자동 확인</button>}
    </div>
    {preview?.shippingGroups?.length ? <details open={groupsOpen} onToggle={event => setGroupsOpen(event.currentTarget.open)} style={{ marginBottom: "9px", border: `1px solid ${wmsColors.border}`, borderRadius: "9px", background: "#fff" }}>
      <summary style={{ padding: "10px", cursor: "pointer", fontSize: "12px", fontWeight: 800 }}>
        자동 송장 묶음 {preview.shippingGroups.length}개 · 발주서 단위 최대 250개 · 직접 변경 가능
      </summary>
      <div style={{ display: "grid", gap: "6px", padding: "0 9px 9px" }}>
        <button type="button" disabled={generating} onClick={() => setInvoiceGroups(null)} style={wmsGhostButton}>250개 자동 추천으로 되돌리기</button>
        {preview.shippingGroups.map((group, index) => <div key={`${group.fulfillmentCenterName}-${group.expectedArrivalDate}-${index}`} style={{ padding: "8px", borderRadius: "8px", background: wmsColors.surfaceBeige, fontSize: "11px", lineHeight: 1.55 }}>
          <strong>묶음 {index + 1} · {group.fulfillmentCenterName} · 수량 {group.totalQuantity}개</strong><br />
          <span style={{ color: wmsColors.muted }}>{group.expectedArrivalDate} · 발주 {group.purchaseOrderNumbers.length}건</span>
          {group.purchaseOrderNumbers.map(po => <label key={po} style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginTop:6}}><span style={{flex:1,minWidth:130}}>발주 {po} · {metricsByPo.get(po)?.quantity || 0}개</span><select aria-label={`발주 ${po} 송장 묶음`} value={index} disabled={generating} style={{minHeight:40,maxWidth:'100%'}} onChange={event => {
            previousGroups.current=invoiceGroups;
            const next=preview.shippingGroups.map(g=>[...g.purchaseOrderNumbers]);
            next[index]=next[index].filter(value=>value!==po);
            const target=Number(event.target.value); if(target===next.length) next.push([po]); else next[target].push(po);
            setInvoiceGroups(next.filter(g=>g.length));
          }}>{preview.shippingGroups.map((target,i)=>target.fulfillmentCenterName===group.fulfillmentCenterName && target.expectedArrivalDate===group.expectedArrivalDate ? <option key={i} value={i}>송장 {i+1} · {target.totalQuantity}개</option> : null)}<option value={preview.shippingGroups.length}>새 송장으로 분리</option></select></label>)}
        </div>)}
      </div>
    </details> : null}
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
    {invoiceGroups && !preview && !previewLoading && <button type="button" onClick={() => setInvoiceGroups(previousGroups.current)} style={wmsGhostButton}>마지막 변경 취소</button>}
    {invoiceGroups && !preview && <button type="button" onClick={() => setInvoiceGroups(null)} style={wmsGhostButton}>250개 자동 추천으로 되돌리기</button>}
    {error && <p style={{ fontSize: "11px", color: "#c0392b", marginBottom: "8px" }}>{error}</p>}
    {resultMessage && <p style={{ fontSize: "11px", color: wmsColors.greenDark, marginBottom: "8px" }}>{resultMessage}</p>}
    <button onClick={handleGenerate} disabled={generating || previewLoading || !preview?.canGenerate || selectedPoNumbers.length === 0} style={{ ...wmsPrimaryButton, width: "100%", opacity: generating || previewLoading || !preview?.canGenerate ? 0.6 : 1 }}>{generating ? "생성 중..." : previewLoading ? "원본 검증 중..." : exactGeneration ? "동일 선택 송장파일 다시 생성" : "선택 발주 송장파일 생성"}</button>
  </div>;
}
