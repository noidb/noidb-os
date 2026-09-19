import type { VendorOrderDraft } from "./types";

/** Display-only ordering; draft IDs, vendor names and sent records stay unchanged. */
export function orderVendorDrafts<T extends { id: string; vendorName: string; draft?: VendorOrderDraft }>(entries: T[], labelEntries: readonly T[] = entries): (T & { label: string })[] {
  const sequence = new Map<string, number>();
  const time = (entry: T) => entry.draft?.sentAt || entry.draft?.createdAt || "9999";
  const compare = (a: T, b: T) => a.vendorName.localeCompare(b.vendorName, "ko", { numeric: true }) ||
    Number(!a.draft?.sentAt) - Number(!b.draft?.sentAt) || time(a).localeCompare(time(b)) || a.id.localeCompare(b.id);
  const labels = new Map([...labelEntries].sort(compare).map(entry => {
      const index = (sequence.get(entry.vendorName) || 0) + 1;
      sequence.set(entry.vendorName, index);
      return [entry.id, index === 1 ? entry.vendorName : `${entry.vendorName}-${index - 1}`];
    }));
  return [...entries].sort(compare).map(entry => ({ ...entry, label: labels.get(entry.id) || entry.vendorName }));
}
