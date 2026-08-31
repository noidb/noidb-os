"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { VendorOrderRepository } from "./repository";
import { SharedVendorOrderRepository } from "./shared-repository";

const VendorOrderContext = createContext<VendorOrderRepository | null>(null);

export function VendorOrderRepositoryProvider({ children }: { children: ReactNode }) {
  const repository = useMemo<VendorOrderRepository>(() => new SharedVendorOrderRepository(), []);
  return <VendorOrderContext.Provider value={repository}>{children}</VendorOrderContext.Provider>;
}

export function useVendorOrderRepository(): VendorOrderRepository {
  const ctx = useContext(VendorOrderContext);
  if (!ctx) throw new Error("useVendorOrderRepository must be used within VendorOrderRepositoryProvider");
  return ctx;
}
