"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePickingWaveRepository } from "@/lib/wms/picking-wave/context";
import type { PickingWave, PickingWaveItem } from "@/lib/wms/picking-wave/types";
import { summarizeShippingByDate, type ShippingDateSummary } from "@/lib/wms/picking-wave/wave-card-summary";
import { wmsColors } from "@/lib/wms/ui-tokens";

export interface WaveSummary {
  wave: PickingWave;
  skuCount: number;
  totalQuantity: number;
  completedSkuCount: number;
  shippingByDate: ShippingDateSummary[];
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

function summarizeWave(wave: PickingWave, items: PickingWaveItem[]): WaveSummary {
  return {
    wave,
    skuCount: items.length,
    totalQuantity: items.reduce((sum, item) => sum + item.totalQuantity, 0),
    completedSkuCount: items.filter(item => item.status !== "pending").length,
    shippingByDate: summarizeShippingByDate(wave, items),
  };
}

export async function loadWaveSummaries(
  repository: ReturnType<typeof usePickingWaveRepository>,
  waves: PickingWave[]
): Promise<WaveSummary[]> {
  return Promise.all(waves.map(async wave => summarizeWave(wave, await repository.listItems(wave.id))));
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
  if (generations.some(generation => generation.status === "shipment_generated")) return "Shipment 출력세트·재출력";
  if (generations.length > 0) return "운송장 확인·Shipment 파일";
  if (wave.status === "order_confirmed") return "송장출력용 파일";
  if (wave.status === "result_confirmed") return "발주확정 통합파일";
  if (wave.status === "completed") return "피킹 결과 확인";
  return "실제 피킹 계속하기";
}

function businessStatus(wave: PickingWave): string {
  const generations = wave.outputGenerations || [];
  if (generations.some(generation => generation.status === "shipment_generated")) return "Shipment 진행";
  if (generations.length > 0) return "송장 진행";
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
  const { wave, skuCount, totalQuantity, completedSkuCount, shippingByDate } = summary;
  const progress = skuCount > 0 ? Math.round((completedSkuCount / skuCount) * 100) : 0;

  return (
    <article className="wms-active-wave-card">
      <a className="wms-active-wave-main" href={workCenterDestination(wave)}>
        <div className="wms-active-wave-heading">
          <div className="wms-active-wave-title">
            <strong>{waveTitle(wave)}</strong>
            <div className="wms-active-wave-time">
              <time dateTime={wave.updatedAt}>{formatKstDateTime(wave.updatedAt)}</time>
              <span>· 생성 {formatKstFullDateTime(wave.createdAt)}</span>
            </div>
          </div>
          <span className="wms-active-wave-status">{businessStatus(wave)}</span>
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
          <span>발주 {wave.sourcePurchaseOrderNumbers.length}건</span>
          <span>SKU {skuCount}개</span>
          <span>총 수량 {totalQuantity}개</span>
          <span>진행 {completedSkuCount}/{skuCount} · {progress}%</span>
        </div>
        <div style={{ marginTop: "8px", display: "flex", justifyContent: "space-between", gap: "8px", fontSize: "12px", fontWeight: 800 }}>
          <span>다음 할 일: {nextAction(wave)}</span>
          {delayLabel(shippingByDate) && <span style={{ color: wmsColors.warn }}>{delayLabel(shippingByDate)}</span>}
        </div>
        <div className="wms-active-wave-progress" aria-label={`진행률 ${progress}%`}>
          <span style={{ width: `${progress}%` }} />
        </div>
      </a>
      {actions && <div className="wms-active-wave-actions">{actions}</div>}
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
    setSummaries(next);
  }, [repository]);

  useEffect(() => {
    refresh().catch(loadError => {
      setError(loadError instanceof Error ? loadError.message : "웨이브 목록을 불러오지 못했습니다.");
      setSummaries([]);
    });
  }, [refresh]);

  if (summaries === null) return <section className={className}><p style={{ color: wmsColors.muted, fontSize: "13px" }}>웨이브 목록을 불러오는 중...</p></section>;

  return (
    <section className={className} aria-labelledby="active-wave-heading">
      <div className="wms-active-wave-section-heading">
        <div>
          <h2 id="active-wave-heading">진행 중 출고작업</h2>
          <p>입고예정일과 관계없이 저장된 작업 {summaries.length}개</p>
        </div>
      </div>
      {error && <p role="alert" className="wms-active-wave-error">{error}</p>}
      {summaries.length === 0 ? (
        <div className="wms-active-wave-empty">저장된 웨이브가 없습니다.</div>
      ) : (
        <div className="wms-active-wave-list">
          {summaries.map(summary => (
            <WaveSummaryCard
              key={summary.wave.id}
              summary={summary}
              actions={(
                <>
                  <a href={workCenterDestination(summary.wave)}>계속하기</a>
                </>
              )}
            />
          ))}
        </div>
      )}
    </section>
  );
}
