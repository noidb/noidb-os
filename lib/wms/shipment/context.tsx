"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { SharedShipmentRepository } from "./shared-repository";
import type { ShipmentRepository } from "./repository";

const ShipmentRepositoryContext = createContext<ShipmentRepository | null>(null);

export function ShipmentRepositoryProvider({ children }: { children: ReactNode }) {
  const repository = useMemo<ShipmentRepository>(() => new SharedShipmentRepository(), []);
  return <ShipmentRepositoryContext.Provider value={repository}>{children}</ShipmentRepositoryContext.Provider>;
}
export function useShipmentRepository(): ShipmentRepository {
  const repository = useContext(ShipmentRepositoryContext);
  if (!repository) throw new Error("useShipmentRepository must be used within ShipmentRepositoryProvider");
  return repository;
}
