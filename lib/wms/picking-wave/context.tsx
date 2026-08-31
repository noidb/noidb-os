"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { PickingWaveRepository } from "./repository";
import { SharedPickingWaveRepository } from "./shared-repository";
import type { StockLevelProvider } from "./stock-level";
import { UnavailableStockLevelProvider } from "./stock-level";

/**
 * 통합 피킹(웨이브) 화면들이 공유하는 저장소/현재고 조회 컨텍스트.
 * 화면은 이 훅으로 받은 인터페이스만 사용하고, localStorage 등 구체적인 구현에는 직접 의존하지 않는다.
 */
interface PickingWaveContextValue {
  repository: PickingWaveRepository;
  stockLevelProvider: StockLevelProvider;
}

const PickingWaveContext = createContext<PickingWaveContextValue | null>(null);

export function PickingWaveRepositoryProvider({ children }: { children: ReactNode }) {
  const value = useMemo<PickingWaveContextValue>(
    () => ({
      repository: new SharedPickingWaveRepository(),
      stockLevelProvider: new UnavailableStockLevelProvider(),
    }),
    []
  );
  return <PickingWaveContext.Provider value={value}>{children}</PickingWaveContext.Provider>;
}

export function usePickingWaveRepository(): PickingWaveRepository {
  const ctx = useContext(PickingWaveContext);
  if (!ctx) throw new Error("usePickingWaveRepository must be used within PickingWaveRepositoryProvider");
  return ctx.repository;
}

export function useStockLevelProvider(): StockLevelProvider {
  const ctx = useContext(PickingWaveContext);
  if (!ctx) throw new Error("useStockLevelProvider must be used within PickingWaveRepositoryProvider");
  return ctx.stockLevelProvider;
}
