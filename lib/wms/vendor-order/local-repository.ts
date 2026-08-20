import type { VendorOrderDraft, VendorOrderDraftLine } from "./types";
import type { VendorOrderRepository } from "./repository";

/** localStorage 기반 임시 저장소. lib/wms/picking-wave/local-repository.ts와 동일한 패턴. */

const KEYS = {
  drafts: "noidb_vendor_order_drafts",
  lines: "noidb_vendor_order_lines",
} as const;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readList<T>(key: string): T[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeList<T>(key: string, list: T[]): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(key, JSON.stringify(list));
}

export class LocalVendorOrderRepository implements VendorOrderRepository {
  async listDrafts(waveId: string): Promise<VendorOrderDraft[]> {
    return readList<VendorOrderDraft>(KEYS.drafts).filter(draft => draft.waveId === waveId);
  }

  async saveDraft(draft: VendorOrderDraft): Promise<void> {
    const list = readList<VendorOrderDraft>(KEYS.drafts);
    const index = list.findIndex(item => item.id === draft.id);
    if (index >= 0) list[index] = draft;
    else list.push(draft);
    writeList(KEYS.drafts, list);
  }

  async listLines(waveId: string): Promise<VendorOrderDraftLine[]> {
    return readList<VendorOrderDraftLine>(KEYS.lines).filter(line => line.waveId === waveId);
  }

  async saveLine(line: VendorOrderDraftLine): Promise<void> {
    const list = readList<VendorOrderDraftLine>(KEYS.lines);
    const index = list.findIndex(item => item.id === line.id);
    if (index >= 0) list[index] = line;
    else list.push(line);
    writeList(KEYS.lines, list);
  }

  async deleteLine(lineId: string): Promise<void> {
    const list = readList<VendorOrderDraftLine>(KEYS.lines).filter(item => item.id !== lineId);
    writeList(KEYS.lines, list);
  }

  async listAllDrafts(): Promise<VendorOrderDraft[]> {
    return readList<VendorOrderDraft>(KEYS.drafts);
  }

  async listAllLines(): Promise<VendorOrderDraftLine[]> {
    return readList<VendorOrderDraftLine>(KEYS.lines);
  }
}
