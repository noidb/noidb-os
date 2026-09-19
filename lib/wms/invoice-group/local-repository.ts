import type { InvoiceGroup } from "./types";
import type { InvoiceGroupRepository } from "./repository";

/** localStorage 기반 임시 저장소. lib/wms/vendor-order/local-repository.ts와 동일한 패턴. */

export const INVOICE_GROUP_LOCAL_STORAGE_KEY = "noidb_invoice_groups";
export const INVOICE_GROUP_EXCLUDED_PO_LOCAL_STORAGE_KEY = "noidb_invoice_group_excluded_po_numbers";

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readList(): InvoiceGroup[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(INVOICE_GROUP_LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as InvoiceGroup[]) : [];
  } catch {
    return [];
  }
}

function writeList(list: InvoiceGroup[]): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(INVOICE_GROUP_LOCAL_STORAGE_KEY, JSON.stringify(list));
}

export function readLocalInvoiceGroupSnapshot(): InvoiceGroup[] {
  return readList();
}

export function replaceLocalInvoiceGroupSnapshot(groups: InvoiceGroup[]): void {
  writeList(groups);
}

function readExcludedPoNumbers(): string[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(INVOICE_GROUP_EXCLUDED_PO_LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export function replaceLocalExcludedPoNumbers(purchaseOrderNumbers: string[]): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(INVOICE_GROUP_EXCLUDED_PO_LOCAL_STORAGE_KEY, JSON.stringify(purchaseOrderNumbers));
}

export class LocalInvoiceGroupRepository implements InvoiceGroupRepository {
  async list(): Promise<InvoiceGroup[]> {
    return readList();
  }

  async get(id: string): Promise<InvoiceGroup | null> {
    return readList().find(group => group.id === id) || null;
  }

  async save(group: InvoiceGroup): Promise<void> {
    const list = readList();
    const index = list.findIndex(item => item.id === group.id);
    if (index >= 0) list[index] = group;
    else list.push(group);
    writeList(list);
  }

  async delete(id: string): Promise<void> {
    writeList(readList().filter(item => item.id !== id));
  }

  async listExcludedPurchaseOrderNumbers(): Promise<string[]> {
    return readExcludedPoNumbers();
  }

  async excludePurchaseOrders(purchaseOrderNumbers: string[]): Promise<void> {
    replaceLocalExcludedPoNumbers([...new Set([...readExcludedPoNumbers(), ...purchaseOrderNumbers])]);
  }
}
