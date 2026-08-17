"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { WarehouseRepository } from "./repository";
import { LocalWarehouseRepository } from "./local-repository";

/**
 * 창고 설정/위치 등록 화면들이 공유하는 저장소 컨텍스트.
 * 화면은 이 훅으로 받은 WarehouseRepository 인터페이스만 사용하고,
 * localStorage 등 구체적인 저장 방식에는 직접 의존하지 않는다.
 */
const WarehouseRepositoryContext = createContext<WarehouseRepository | null>(null);

export function WarehouseRepositoryProvider({ children }: { children: ReactNode }) {
  const repository = useMemo<WarehouseRepository>(() => new LocalWarehouseRepository(), []);
  return <WarehouseRepositoryContext.Provider value={repository}>{children}</WarehouseRepositoryContext.Provider>;
}

export function useWarehouseRepository(): WarehouseRepository {
  const repository = useContext(WarehouseRepositoryContext);
  if (!repository) throw new Error("useWarehouseRepository must be used within WarehouseRepositoryProvider");
  return repository;
}
