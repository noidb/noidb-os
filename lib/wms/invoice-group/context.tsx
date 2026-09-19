"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { InvoiceGroupRepository } from "./repository";
import { SharedInvoiceGroupRepository } from "./shared-repository";
import { FixtureInvoiceGroupRepository } from "./fixture-repository";

const InvoiceGroupContext = createContext<{ repository: InvoiceGroupRepository; ready: boolean; fixture: boolean } | null>(null);

export function InvoiceGroupRepositoryProvider({ children }: { children: ReactNode }) {
  const [fixture, setFixture] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setFixture(process.env.NODE_ENV === "development" && new URLSearchParams(window.location.search).get("logisticsFixture") === "1");
    setReady(true);
  }, []);
  const repository = useMemo<InvoiceGroupRepository>(() => fixture ? new FixtureInvoiceGroupRepository() : new SharedInvoiceGroupRepository(), [fixture]);
  return <InvoiceGroupContext.Provider value={{ repository, ready, fixture }}>{children}</InvoiceGroupContext.Provider>;
}

export function useInvoiceGroupRepository(): InvoiceGroupRepository {
  const ctx = useContext(InvoiceGroupContext);
  if (!ctx) throw new Error("useInvoiceGroupRepository must be used within InvoiceGroupRepositoryProvider");
  return ctx.repository;
}

export function useInvoiceGroupRepositoryState(): { repository: InvoiceGroupRepository; ready: boolean; fixture: boolean } {
  const ctx = useContext(InvoiceGroupContext);
  if (!ctx) throw new Error("useInvoiceGroupRepositoryState must be used within InvoiceGroupRepositoryProvider");
  return ctx;
}
