"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReceivingDelaySummary } from "./receiving-delay";

export interface ReceivingDelayInput {
  skuId: string;
  modelSku?: string;
  productName: string;
  optionLabel: string;
  vendorName: string;
  purchaseOrderNumber: string;
  operator: string;
  delayed: boolean;
  memo: string;
  expectedLastActionAt: string | null;
}

/** Temporary UI state only. The existing shared receiving-delay history remains authoritative. */
export function useReceivingDelays() {
  const [summaries, setSummaries] = useState<Map<string, ReceivingDelaySummary>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const version = useRef(0);
  const refresh = useCallback(async () => {
    if (savingRef.current) return;
    const requestVersion = ++version.current;
    setLoading(true);
    try {
      const response = await fetch("/api/wms/vendor-order-actions?scope=delays", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.delaySummaries)) throw new Error("입고지연 이력을 불러오지 못했습니다. 다시 확인해 주세요.");
      if (requestVersion !== version.current) return;
      setSummaries(new Map(data.delaySummaries.map((summary: ReceivingDelaySummary) => [summary.skuId, summary])));
      setError(null);
    } catch (reason) {
      if (requestVersion === version.current) setError(reason instanceof Error ? reason.message : "입고지연 이력을 불러오지 못했습니다.");
    } finally { if (requestVersion === version.current) setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => { version.current += 1; window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh]);

  const save = useCallback(async (input: ReceivingDelayInput) => {
    if (savingRef.current) throw new Error("입고지연을 저장하고 있습니다. 잠시 기다려 주세요.");
    savingRef.current = true; version.current += 1; setSaving(true);
    try {
      const response = await fetch("/api/wms/vendor-order-actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delay", ...input }) });
      const data = await response.json();
      if (!response.ok || !data.success || !data.summary) throw new Error(data.error || "입고지연 저장 결과를 확인하지 못했습니다. 다시 시도해 주세요.");
      const summary = data.summary as ReceivingDelaySummary;
      setSummaries(previous => new Map(previous).set(summary.skuId, summary));
      setError(null);
      return summary;
    } finally { savingRef.current = false; setSaving(false); setLoading(false); }
  }, []);
  return { summaries, loading, error, saving, refresh, save };
}
