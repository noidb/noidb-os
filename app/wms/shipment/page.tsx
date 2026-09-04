"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePickingWaveRepository } from "@/lib/wms/picking-wave/context";
import { useShipmentRepository } from "@/lib/wms/shipment/context";
import { buildShipmentCandidates, previewShipmentSplit, type ShipmentCandidate } from "@/lib/wms/shipment/split";
import { canDeleteShipment } from "@/lib/wms/shipment/state";
import type { Shipment, ShipmentSplitPreview } from "@/lib/wms/shipment/types";
import { wmsColors, wmsGhostButton, wmsGreenDarkButton, wmsOuterCard, wmsPrimaryButton, wmsSecondaryButton, wmsWarnButton } from "@/lib/wms/ui-tokens";

const STATUS_LABEL: Record<Shipment["status"], string> = { draft: "생성됨", invoice_generated: "송장파일 생성", tracking_verified: "운송장 검증", upload_generated: "업로드파일 생성", output_generated: "출력세트 생성", dispatched: "출고 진행" };

export default function WmsShipmentPage() {
  const waveRepository = usePickingWaveRepository();
  const shipmentRepository = useShipmentRepository();
  const [candidates, setCandidates] = useState<ShipmentCandidate[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [splitSize, setSplitSize] = useState(200);
  const [preview, setPreview] = useState<ShipmentSplitPreview[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [waves, currentShipments] = await Promise.all([waveRepository.listWaves(), shipmentRepository.listShipments()]);
      const pairs = await Promise.all(waves.map(async wave => ({ wave, items: await waveRepository.listItems(wave.id), baskets: await waveRepository.listBaskets(wave.id) })));
      setShipments(currentShipments);
      setCandidates(buildShipmentCandidates(waves, new Map(pairs.map(pair => [pair.wave.id, pair.items])), new Map(pairs.map(pair => [pair.wave.id, pair.baskets])), currentShipments));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Shipment 데이터를 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, [shipmentRepository, waveRepository]);

  useEffect(() => { void refresh(); }, [refresh]);
  const eligible = useMemo(() => candidates.filter(candidate => !candidate.alreadyAssignedShipmentId && !candidate.sourceConflict && candidate.fulfillmentCenter && candidate.expectedDate), [candidates]);
  const selectedCandidates = useMemo(() => eligible.filter(candidate => selected.has(candidate.purchaseOrderNumber)), [eligible, selected]);
  const allSelected = eligible.length > 0 && eligible.every(candidate => selected.has(candidate.purchaseOrderNumber));
  function resetPreview() { setPreview(null); setError(null); }
  function toggle(po: string) { setSelected(previous => { const next = new Set(previous); next.has(po) ? next.delete(po) : next.add(po); return next; }); resetPreview(); }
  function toggleAll() { setSelected(allSelected ? new Set() : new Set(eligible.map(candidate => candidate.purchaseOrderNumber))); resetPreview(); }
  function makePreview() {
    try { if (!selectedCandidates.length) throw new Error("Shipment로 나눌 발주서를 선택해주세요."); setPreview(previewShipmentSplit(selectedCandidates, splitSize)); setError(null); }
    catch (reason) { setPreview(null); setError(reason instanceof Error ? reason.message : "분할 미리보기를 만들지 못했습니다."); }
  }
  async function createShipments() {
    if (!preview) return; setWorking(true); setError(null);
    try { await shipmentRepository.createFromPreviews(preview); setSelected(new Set()); setPreview(null); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Shipment 생성에 실패했습니다."); }
    finally { setWorking(false); }
  }
  async function renameShipment(shipment: Shipment) {
    const name = window.prompt("새 Shipment 이름", shipment.name); if (name === null || name.trim() === shipment.name) return;
    try { await shipmentRepository.renameShipment(shipment.id, name); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : "이름 변경에 실패했습니다."); }
  }
  async function deleteShipment(shipment: Shipment) {
    if (!window.confirm(`${shipment.id}를 삭제할까요? 포함 발주서는 Shipment 대상 목록으로 돌아옵니다.`)) return;
    try { await shipmentRepository.deleteShipment(shipment.id); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Shipment 삭제에 실패했습니다."); }
  }

  return <main style={{ maxWidth: "980px", margin: "0 auto", padding: "18px 14px 40px", fontFamily: "sans-serif", color: wmsColors.ink }}>
    <h1 style={{ fontSize: "24px", margin: "0 0 6px" }}>Shipment 분할</h1>
    <p style={{ margin: "0 0 16px", color: wmsColors.muted, fontSize: "13px", lineHeight: 1.55 }}>센터 전체 통합 피킹이 끝난 발주서만 선택하여 Shipment 단계에서 나눕니다. 피킹 데이터와 수량은 수정하지 않습니다.</p>
    {error && <div style={{ background: wmsColors.warnSoft, color: wmsColors.warnText, padding: "10px 12px", borderRadius: "10px", marginBottom: "12px", whiteSpace: "pre-wrap" }}>{error}</div>}

    <section style={{ ...wmsOuterCard, padding: "14px", marginBottom: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginBottom: "10px" }}><div><h2 style={{ fontSize: "17px", margin: 0 }}>Shipment 대상 발주서</h2><span style={{ fontSize: "12px", color: wmsColors.muted }}>선택 {selectedCandidates.length}건 / 선택 가능 {eligible.length}건</span></div><button type="button" onClick={toggleAll} disabled={!eligible.length} style={{ ...wmsSecondaryButton, minHeight: "40px", fontSize: "12px" }}>{allSelected ? "선택해제" : "전체선택"}</button></div>
      {loading ? <p>불러오는 중...</p> : candidates.length === 0 ? <p style={{ color: wmsColors.muted }}>피킹 완료된 발주서가 없습니다.</p> : <div style={{ display: "grid", gap: "8px" }}>{candidates.map(candidate => {
        const disabled = Boolean(candidate.alreadyAssignedShipmentId || candidate.sourceConflict || !candidate.fulfillmentCenter || !candidate.expectedDate);
        return <label key={`${candidate.sourceWaveId}-${candidate.purchaseOrderNumber}`} style={{ border: `1px solid ${disabled ? wmsColors.border : wmsColors.borderStrong}`, borderRadius: "10px", padding: "10px", display: "grid", gridTemplateColumns: "28px 1fr", gap: "8px", background: disabled ? wmsColors.surfaceBeige : "#fff", opacity: disabled ? .75 : 1 }}>
          <input type="checkbox" checked={!disabled && selected.has(candidate.purchaseOrderNumber)} disabled={disabled} onChange={() => toggle(candidate.purchaseOrderNumber)} style={{ width: "22px", height: "22px" }} />
          <span style={{ minWidth: 0 }}><strong style={{ display: "block", fontSize: "14px" }}>발주서 {candidate.purchaseOrderNumber}</strong><span style={{ display: "block", fontSize: "12px", color: wmsColors.muted, lineHeight: 1.55 }}>{candidate.fulfillmentCenter || "물류센터 없음"} · {candidate.expectedDate || "입고예정일 없음"} · SKU {candidate.skuCount}종 · 총 {candidate.totalQuantity}개</span><span style={{ display: "block", fontSize: "11px", color: candidate.alreadyAssignedShipmentId ? wmsColors.warnText : wmsColors.greenDark }}>피킹 완료 · {candidate.alreadyAssignedShipmentId ? `${candidate.alreadyAssignedShipmentId} 포함됨` : candidate.sourceConflict ? "동일 발주서가 완료 웨이브에 중복 존재" : "Shipment 미배정"}</span></span>
        </label>;
      })}</div>}
    </section>

    <section style={{ ...wmsOuterCard, padding: "14px", marginBottom: "16px" }}>
      <h2 style={{ fontSize: "17px", margin: "0 0 10px" }}>분할 미리보기</h2>
      <label style={{ display: "grid", gap: "5px", fontSize: "12px", fontWeight: 700, marginBottom: "10px" }}>Shipment당 발주서 수<input type="number" min={1} step={1} value={splitSize} onChange={event => { setSplitSize(Math.max(1, Math.floor(Number(event.target.value) || 1))); resetPreview(); }} style={{ minHeight: "44px", border: `1px solid ${wmsColors.borderStrong}`, borderRadius: "9px", padding: "0 12px", fontSize: "16px" }} /></label>
      <button type="button" onClick={makePreview} disabled={!selectedCandidates.length} style={{ ...wmsPrimaryButton, width: "100%", opacity: selectedCandidates.length ? 1 : .5 }}>선택 발주서 분할 미리보기</button>
      {preview && <div style={{ display: "grid", gap: "8px", marginTop: "12px" }}>{preview.map(item => <article key={item.sequence} style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "10px", padding: "10px", background: wmsColors.surface }}><strong>{item.suggestedName}</strong><div style={{ fontSize: "12px", color: wmsColors.muted, lineHeight: 1.6, marginTop: "4px" }}>발주서 {item.purchaseOrderCount}건 · SKU {item.skuCount}종 · 총 {item.totalQuantity}개<br />{item.fulfillmentCenter} · {item.expectedDate}<br />첫 발주번호 {item.firstPurchaseOrderNumber} · 마지막 발주번호 {item.lastPurchaseOrderNumber}</div></article>)}</div>}
      {preview && <button type="button" onClick={() => void createShipments()} disabled={working} style={{ ...wmsGreenDarkButton, width: "100%", marginTop: "12px", opacity: working ? .55 : 1 }}>{working ? "생성 중..." : `${preview.length}개 Shipment 생성 확정`}</button>}
    </section>

    <section style={{ ...wmsOuterCard, padding: "14px" }}><h2 style={{ fontSize: "17px", margin: "0 0 10px" }}>생성된 Shipment</h2>{shipments.length === 0 ? <p style={{ color: wmsColors.muted }}>아직 생성된 Shipment가 없습니다.</p> : <div style={{ display: "grid", gap: "10px" }}>{shipments.map(shipment => { const first = shipment.purchaseOrders[0]; return <article key={shipment.id} style={{ border: `1px solid ${wmsColors.border}`, borderRadius: "11px", padding: "11px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}><div><strong style={{ display: "block" }}>{shipment.name}</strong><span style={{ fontSize: "11px", color: wmsColors.muted }}>{shipment.id} · {STATUS_LABEL[shipment.status]}</span></div><button type="button" onClick={() => void renameShipment(shipment)} style={{ ...wmsGhostButton, minHeight: "34px", fontSize: "11px" }}>이름 수정</button></div>
      <p style={{ fontSize: "12px", color: wmsColors.muted, lineHeight: 1.55 }}>발주서 {shipment.purchaseOrders.length}건 · SKU {shipment.purchaseOrders.reduce((sum, order) => sum + order.skuCount, 0)}종 · 총 {shipment.purchaseOrders.reduce((sum, order) => sum + order.totalQuantity, 0)}개<br />{first?.fulfillmentCenter} · {first?.expectedDate}</p>
      <div style={{ display: "grid", gridTemplateColumns: canDeleteShipment(shipment) ? "1fr 1fr" : "1fr", gap: "8px" }}><Link href={`/wms/shipment/${shipment.id}`} style={{ ...wmsPrimaryButton, minHeight: "44px", display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>다음 단계</Link>{canDeleteShipment(shipment) && <button type="button" onClick={() => void deleteShipment(shipment)} style={{ ...wmsWarnButton, minHeight: "44px" }}>삭제</button>}</div>
    </article>; })}</div>}</section>
  </main>;
}
