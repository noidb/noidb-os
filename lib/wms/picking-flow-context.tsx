"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { PickingOption, WorkBatch } from "./picking-sample-data";

/**
 * Sprint 2 피킹 흐름 상태를 /wms/* 페이지 간에 공유하기 위한 클라이언트 전용 컨텍스트.
 * 브라우저 메모리에만 존재하며, 구글시트/서버로 저장되지 않는다 (Sprint 2 범위 밖).
 */

export type PickingStatus = "pending" | "full" | "partial" | "notfound";

export interface PickingProgressEntry {
  pickedQty: number;
  status: PickingStatus;
}

export interface VendorShortageItem {
  skuId: string;
  productName: string;
  optionLabel: string;
  orderedQty: number;
  pickedQty: number;
  shortageQty: number;
}

export interface VendorShortageGroup {
  vendorName: string;
  items: VendorShortageItem[];
}

interface WmsPickingFlowValue {
  activeBatch: WorkBatch | null;
  progress: Record<string, PickingProgressEntry>;
  vendorShortageSummary: VendorShortageGroup[] | null;
  startPicking: (batch: WorkBatch) => void;
  markFull: (option: PickingOption) => void;
  markPartial: (option: PickingOption, pickedQty: number) => void;
  markNotFound: (option: PickingOption) => void;
  finishPickingAndGroupShortage: () => VendorShortageGroup[];
  resetFlow: () => void;
}

const WmsPickingFlowContext = createContext<WmsPickingFlowValue | null>(null);

export function WmsPickingFlowProvider({ children }: { children: ReactNode }) {
  const [activeBatch, setActiveBatch] = useState<WorkBatch | null>(null);
  const [progress, setProgress] = useState<Record<string, PickingProgressEntry>>({});
  const [vendorShortageSummary, setVendorShortageSummary] = useState<VendorShortageGroup[] | null>(null);

  const startPicking = useCallback((batch: WorkBatch) => {
    const initial: Record<string, PickingProgressEntry> = {};
    for (const box of batch.boxes) {
      for (const model of box.models) {
        for (const option of model.options) {
          initial[option.skuId] = { pickedQty: 0, status: "pending" };
        }
      }
    }
    setActiveBatch(batch);
    setProgress(initial);
    setVendorShortageSummary(null);
  }, []);

  const markFull = useCallback((option: PickingOption) => {
    setProgress(prev => ({ ...prev, [option.skuId]: { pickedQty: option.orderedQty, status: "full" } }));
  }, []);

  const markPartial = useCallback((option: PickingOption, pickedQty: number) => {
    const clamped = Math.max(0, Math.min(pickedQty, option.orderedQty));
    setProgress(prev => ({
      ...prev,
      [option.skuId]: { pickedQty: clamped, status: clamped >= option.orderedQty ? "full" : "partial" },
    }));
  }, []);

  const markNotFound = useCallback((option: PickingOption) => {
    setProgress(prev => ({ ...prev, [option.skuId]: { pickedQty: 0, status: "notfound" } }));
  }, []);

  const finishPickingAndGroupShortage = useCallback((): VendorShortageGroup[] => {
    if (!activeBatch) return [];
    const groups = new Map<string, VendorShortageItem[]>();
    for (const box of activeBatch.boxes) {
      for (const model of box.models) {
        for (const option of model.options) {
          const entry = progress[option.skuId];
          const pickedQty = entry?.pickedQty ?? 0;
          const shortageQty = Math.max(0, option.orderedQty - pickedQty);
          if (shortageQty <= 0) continue;
          const list = groups.get(option.vendorName) || [];
          list.push({
            skuId: option.skuId,
            productName: option.productName,
            optionLabel: option.optionLabel,
            orderedQty: option.orderedQty,
            pickedQty,
            shortageQty,
          });
          groups.set(option.vendorName, list);
        }
      }
    }
    const result = [...groups.entries()].map(([vendorName, items]) => ({ vendorName, items }));
    setVendorShortageSummary(result);
    return result;
  }, [activeBatch, progress]);

  const resetFlow = useCallback(() => {
    setActiveBatch(null);
    setProgress({});
    setVendorShortageSummary(null);
  }, []);

  const value = useMemo<WmsPickingFlowValue>(
    () => ({
      activeBatch,
      progress,
      vendorShortageSummary,
      startPicking,
      markFull,
      markPartial,
      markNotFound,
      finishPickingAndGroupShortage,
      resetFlow,
    }),
    [
      activeBatch,
      progress,
      vendorShortageSummary,
      startPicking,
      markFull,
      markPartial,
      markNotFound,
      finishPickingAndGroupShortage,
      resetFlow,
    ]
  );

  return <WmsPickingFlowContext.Provider value={value}>{children}</WmsPickingFlowContext.Provider>;
}

export function useWmsPickingFlow(): WmsPickingFlowValue {
  const ctx = useContext(WmsPickingFlowContext);
  if (!ctx) throw new Error("useWmsPickingFlow must be used within WmsPickingFlowProvider");
  return ctx;
}
