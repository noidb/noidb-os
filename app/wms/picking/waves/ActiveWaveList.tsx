"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePickingWaveRepository } from "@/lib/wms/picking-wave/context";
import type { PickingWave, PickingWaveItem } from "@/lib/wms/picking-wave/types";
import { summarizeShippingByDate, type ShippingDateSummary } from "@/lib/wms/picking-wave/wave-card-summary";
import { wmsColors, wmsGhostButton } from "@/lib/wms/ui-tokens";

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

function businessStatus(wave: PickingWave): "진행중" | "발주확정" {
  return wave.status === "order_confirmed" ? "발주확정" : "진행중";
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
      <a className="wms-active-wave-main" href={wave.status === "order_confirmed" ? `/wms/picking/waves/${encodeURIComponent(wave.id)}/complete` : `/wms/picking/waves/${encodeURIComponent(wave.id)}`}>
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
          <span>SKU {skuCount}개</span>
          <span>총 수량 {totalQuantity}개</span>
          <span>진행 {completedSkuCount}/{skuCount} · {progress}%</span>
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
  const [deletingWaveId, setDeletingWaveId] = useState<string | null>(null);

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

  async function deleteWave(wave: PickingWave) {
    const confirmed = window.confirm("이 웨이브를 삭제하시겠습니까? 진행 중인 피킹 작업만 삭제되며 원본 발주서는 삭제되지 않습니다.");
    if (!confirmed) return;
    setDeletingWaveId(wave.id);
    setError(null);
    try {
      await repository.deleteWave(wave.id);
      setSummaries(previous => previous?.filter(summary => summary.wave.id !== wave.id) ?? []);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "웨이브 삭제에 실패했습니다.");
    } finally {
      setDeletingWaveId(null);
    }
  }

  if (summaries === null) return <section className={className}><p style={{ color: wmsColors.muted, fontSize: "13px" }}>웨이브 목록을 불러오는 중...</p></section>;

  return (
    <section className={className} aria-labelledby="active-wave-heading">
      <div className="wms-active-wave-section-heading">
        <div>
          <h2 id="active-wave-heading">웨이브 목록</h2>
          <p>진행중·발주확정 포함 {summaries.length}개</p>
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
                  <a href={summary.wave.status === "order_confirmed" ? `/wms/picking/waves/${encodeURIComponent(summary.wave.id)}/complete` : `/wms/picking/waves/${encodeURIComponent(summary.wave.id)}`}>열기</a>
                  {summary.wave.status === "in_progress" && <button
                    type="button"
                    disabled={deletingWaveId === summary.wave.id}
                    onClick={() => deleteWave(summary.wave)}
                    style={{ ...wmsGhostButton, color: "#a4382f" }}
                  >
                    {deletingWaveId === summary.wave.id ? "삭제 중..." : "삭제"}
                  </button>}
                </>
              )}
            />
          ))}
        </div>
      )}
    </section>
  );
}
