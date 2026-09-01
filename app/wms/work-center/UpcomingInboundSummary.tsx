"use client";

import { useEffect, useState } from "react";
import type { UpcomingInboundDateSummary } from "@/lib/wms/supplier-hub-orders";

export default function UpcomingInboundSummary() {
  const [summaries, setSummaries] = useState<UpcomingInboundDateSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    fetch("/api/wms/supplier-hub-orders", { cache: "no-store" })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "입고예정 물량을 불러오지 못했습니다.");
        if (active) setSummaries(data.upcomingInboundSummary ?? []);
      })
      .catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : "입고예정 물량을 불러오지 못했습니다.");
      });
    return () => { active = false; };
  }, []);

  function toggleDate(expectedDate: string) {
    setExpandedDates(current => {
      const next = new Set(current);
      if (next.has(expectedDate)) next.delete(expectedDate);
      else next.add(expectedDate);
      return next;
    });
  }

  return (
    <section className="wms-upcoming-inbound" aria-labelledby="wms-upcoming-inbound-title">
      <h2 id="wms-upcoming-inbound-title">입고예정 물량</h2>
      {error ? (
        <p className="wms-upcoming-inbound-message">{error}</p>
      ) : summaries === null ? (
        <p className="wms-upcoming-inbound-message">불러오는 중...</p>
      ) : summaries.length === 0 ? (
        <p className="wms-upcoming-inbound-message">현재 예정된 입고 물량이 없습니다.</p>
      ) : (
        <div className="wms-upcoming-inbound-list">
          {summaries.map(summary => {
            const expanded = expandedDates.has(summary.expectedDate);
            return (
              <article className="wms-upcoming-inbound-row" key={summary.expectedDate}>
                <button
                  type="button"
                  className="wms-upcoming-inbound-toggle"
                  aria-expanded={expanded}
                  onClick={() => toggleDate(summary.expectedDate)}
                >
                  <strong>{summary.expectedDate}</strong>
                  <span>총 SKU {summary.totalSkuTypes}종 · 총수량 {summary.totalQuantity}개</span>
                  <span className="wms-upcoming-inbound-arrow" aria-hidden="true">{expanded ? "▲" : "▼"}</span>
                </button>
                {expanded && (
                  <div className="wms-upcoming-inbound-centers">
                    {summary.centers.map(center => (
                      <div key={center.fulfillmentCenter}>
                        <strong>{center.fulfillmentCenter}</strong>
                        <span>SKU {center.totalSkuTypes}종 · 총수량 {center.totalQuantity}개</span>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
