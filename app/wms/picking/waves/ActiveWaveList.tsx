"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePickingWaveRepository } from "@/lib/wms/picking-wave/context";
import type { PickingWave } from "@/lib/wms/picking-wave/types";
import { summarizeShippingByDate, type ShippingDateSummary } from "@/lib/wms/picking-wave/wave-card-summary";
import { wmsColors } from "@/lib/wms/ui-tokens";
import { summarizeOutputGenerations } from "@/lib/wms/output-generation-progress";
import type { OutboundWorkSummary, WorkCenterOverview } from "@/lib/wms/work-center";

export interface WaveSummary {
  wave: PickingWave;
  skuCount: number;
  totalQuantity: number;
  completedSkuCount: number;
  shippingByDate: ShippingDateSummary[];
  outbound?: OutboundWorkSummary;
}

function formatKstDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || "";
  return `${part("month")}/${part("day")} ${part("hour")}:${part("minute")}`;
}

function formatKstFullDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}


export async function loadWaveSummaries(
  repository: ReturnType<typeof usePickingWaveRepository>,
  waves: PickingWave[]
): Promise<WaveSummary[]> {
  const response = await fetch("/api/wms/work-center", { cache: "no-store" });
  const result = await response.json();
  if (!response.ok || !result.overview) throw new Error("출고완료 상태를 불러오지 못했습니다. 다시 확인해 주세요.");
  const byId = new Map<string, OutboundWorkSummary>((result.overview as WorkCenterOverview).works.map(work => [work.id, work]));
  return Promise.all(waves.filter(wave => byId.has(wave.id)).map(async wave => {
    const outbound = byId.get(wave.id)!;
    const shippingByDate = outbound.shippingByDate || summarizeShippingByDate(wave, await repository.listItems(wave.id));
    return { wave, skuCount: outbound.skuCount, totalQuantity: outbound.totalQuantity, completedSkuCount: outbound.pickedSkuCount, shippingByDate, outbound };
  }));
}

function waveTitle(wave: PickingWave): string {
  return wave.displayName?.trim() || wave.id.trim() || `웨이브 ${formatKstDateTime(wave.createdAt)}`;
}

function workCenterDestination(wave: PickingWave): string {
  const hasDocuments = (wave.outputGenerations?.length || 0) > 0;
  return wave.status === "in_progress" && !hasDocuments
    ? `/wms/picking/waves/${encodeURIComponent(wave.id)}`
    : `/wms/picking/waves/${encodeURIComponent(wave.id)}/complete`;
}

function nextAction(wave: PickingWave): string {
  const generations = wave.outputGenerations || [];
  if (generations.length > 0) {
    const progress = summarizeOutputGenerations(generations, wave.sourcePurchaseOrderNumbers);
    if (progress.pendingPurchaseOrders > 0) return `남은 발주 ${progress.pendingPurchaseOrders}건 Shipment 계속하기`;
    return "Shipment 출력세트·재출력";
  }
  if (wave.status === "order_confirmed") return "송장출력용 파일";
  if (wave.status === "result_confirmed") return "발주확정 통합파일";
  if (wave.status === "completed") return "피킹 결과 확인";
  return "실제 피킹 계속하기";
}

function businessStatus(wave: PickingWave): string {
  const generations = wave.outputGenerations || [];
  if (generations.length > 0) {
    const progress = summarizeOutputGenerations(generations, wave.sourcePurchaseOrderNumbers);
    return `Shipment 발주 ${progress.completedPurchaseOrders}/${progress.purchaseOrderTotal}`;
  }
  if (wave.status === "order_confirmed") return "발주확정";
  if (wave.status === "result_confirmed") return "결과 확인완료";
  if (wave.status === "completed") return "피킹 검토";
  return "피킹 중";
}

function delayLabel(shippingByDate: ShippingDateSummary[]): string | null {
  const validDates = shippingByDate.map(item => item.expectedDate).filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value));
  if (!validDates.length) return null;
  const latest = [...validDates].sort().at(-1)!;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  if (latest >= today) return null;
  const days = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${latest}T00:00:00Z`)) / 86_400_000);
  return days <= 3 ? `출고 유예 ${days}일째` : `입고예정일 ${days}일 경과`;
}

export function WaveSummaryCard({
  summary,
  actions,
}: {
  summary: WaveSummary;
  actions?: ReactNode;
}) {
  const { wave, skuCount, totalQuantity, completedSkuCount, shippingByDate, outbound } = summary;
  const destination = outbound?.nextHref || workCenterDestination(wave);
  const progress = skuCount > 0 ? Math.round((completedSkuCount / skuCount) * 100) : 0;
  const generationProgress = outbound ? { total: wave.outputGenerations?.length || 0, completedPurchaseOrders: outbound.purchaseOrderCount - outbound.remainingShipmentPoCount, purchaseOrderTotal: outbound.purchaseOrderCount, pendingPurchaseOrders: outbound.remainingShipmentPoCount } : summarizeOutputGenerations(wave.outputGenerations || [], wave.sourcePurchaseOrderNumbers);

  return (
    <article className="wms-active-wave-card">
      <a className="wms-active-wave-main" href={destination}>
        <div className="wms-active-wave-heading">
          <div className="wms-active-wave-title">
            <strong>{waveTitle(wave)}</strong>
            <div className="wms-active-wave-time">
              <time dateTime={wave.updatedAt}>{formatKstDateTime(wave.updatedAt)}</time>
              <span>· 생성 {formatKstFullDateTime(wave.createdAt)}</span>
            </div>
          </div>
          <span className="wms-active-wave-status">{outbound?.fullyCompletedElsewhere ? "다른 작업에서 출고완료" : outbound?.completedAt ? "출고완료" : outbound?.state?.status === "archived" ? "보관" : outbound && generationProgress.total > 0 ? "Shipment 발주 " + generationProgress.completedPurchaseOrders + "/" + generationProgress.purchaseOrderTotal : businessStatus(wave)}</span>
        </div>
        {shippingByDate.length > 0 && <div className="wms-active-wave-shipping">
          {shippingByDate.map(group => <div className="wms-active-wave-shipping-group" key={group.expectedDate}>
            <div className="wms-active-wave-expected-date">{group.expectedDate === "입고예정일 미정" ? group.expectedDate : `입고예정일 ${group.expectedDate}`}</div>
            <div className="wms-active-wave-centers">
              {group.centers.map(center => <span key={center.fulfillmentCenter}>{center.fulfillmentCenter} {center.totalQuantity}개</span>)}
            </div>
          </div>)}
        </div>}
        <div className="wms-active-wave-metrics">
          <span>발주 {outbound?.purchaseOrderCount ?? wave.sourcePurchaseOrderNumbers.length}건</span>
          <span>SKU {skuCount}개</span>
          <span>총 수량 {totalQuantity}개</span>
          <span>진행 {completedSkuCount}/{skuCount} · {progress}%</span>
        </div>
        <div style={{ marginTop: "8px", display: "flex", justifyContent: "space-between", gap: "8px", fontSize: "12px", fontWeight: 800 }}>
          <span>다음 할 일: {outbound?.nextLabel || nextAction(wave)}</span>
          {(outbound ? outbound.delay : delayLabel(shippingByDate)) && <span style={{ color: wmsColors.warn }}>{outbound ? outbound.delay : delayLabel(shippingByDate)}</span>}
        </div>
        {generationProgress.total > 0 && <div style={{ marginTop: "4px", fontSize: "11px", color: wmsColors.muted }}>
          Shipment 발주 완료 {generationProgress.completedPurchaseOrders}/{generationProgress.purchaseOrderTotal}건 · 미처리 {generationProgress.pendingPurchaseOrders}건
        </div>}
        <div className="wms-active-wave-progress" aria-label={`진행률 ${progress}%`}>
          <span style={{ width: `${progress}%` }} />
        </div>
      </a>
      {actions && !outbound?.fullyCompletedElsewhere && <div className="wms-active-wave-actions">{actions}</div>}
    </article>
  );
}

export default function ActiveWaveList({ className }: { className?: string }) {
  const repository = usePickingWaveRepository();
  const [summaries, setSummaries] = useState<WaveSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const waves = (await repository.listWaves())
      .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
    const next = await loadWaveSummaries(repository, waves);
    setSummaries(next.filter(summary => !summary.outbound?.completedAt && summary.outbound?.state?.status !== "archived" && !summary.outbound?.fullyCompletedElsewhere));
    setError(null);
  }, [repository]);

  useEffect(() => {
    const load = () => { void refresh().catch(loadError => {
      setError(loadError instanceof Error ? loadError.message : "웨이브 목록을 불러오지 못했습니다.");
      setSummaries([]);
    }); };
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    load();
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.removeEventListener("focus", load); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh]);

  if (summaries === null) return <section className={className}><p style={{ color: wmsColors.muted, fontSize: "13px" }}>웨이브 목록을 불러오는 중...</p></section>;

  return (
    <section className={className} aria-labelledby="active-wave-heading">
      <div className="wms-active-wave-section-heading">
        <div>
          <h2 id="active-wave-heading">진행 중 출고작업</h2>
          <p>출고완료한 발주를 제외한 작업 {summaries.length}개</p>
        </div>
      </div>
      {error && <p role="alert" className="wms-active-wave-error">{error}</p>}
      {summaries.length === 0 ? (
        <div className="wms-active-wave-empty">진행 중인 출고작업이 없습니다.</div>
      ) : (
        <div className="wms-active-wave-list">
          {summaries.map(summary => (
            <WaveSummaryCard
              key={summary.wave.id}
              summary={summary}
              actions={(
                <>
                  <a href={summary.outbound?.nextHref || workCenterDestination(summary.wave)}>{summary.wave.status === "in_progress" ? "피킹 계속" : "계속하기"}</a>
                  {summary.wave.status === "in_progress" && <a href={`/wms/picking/waves/${encodeURIComponent(summary.wave.id)}/complete`} style={{ background: wmsColors.surfaceBeige, color: wmsColors.ink, border: `1px solid ${wmsColors.border}` }}>서류 작업</a>}
                </>
              )}
            />
          ))}
        </div>
      )}
    </section>
  );
}
