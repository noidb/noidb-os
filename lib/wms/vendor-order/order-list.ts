import type { VendorOrderDraft } from "./types";

/** Display-only ordering; draft IDs, vendor names and sent records stay unchanged. */
export function orderVendorDrafts<T extends { id: string; vendorName: string; draft?: VendorOrderDraft }>(entries: T[]): (T & { label: string })[] {
  const counts = new Map<string, number>();
  entries.forEach(entry => counts.set(entry.vendorName, (counts.get(entry.vendorName) || 0) + 1));
  const sequence = new Map<string, number>();
  const time = (entry: T) => entry.draft?.sentAt || entry.draft?.createdAt || "9999";
  return [...entries].sort((a, b) => a.vendorName.localeCompare(b.vendorName, "ko", { numeric: true }) ||
    Number(!a.draft?.sentAt) - Number(!b.draft?.sentAt) || time(a).localeCompare(time(b)) || a.id.localeCompare(b.id))
    .map(entry => {
      const index = (sequence.get(entry.vendorName) || 0) + 1;
      sequence.set(entry.vendorName, index);
      return { ...entry, label: (counts.get(entry.vendorName) || 0) > 1 ? `${entry.vendorName}-${index}` : entry.vendorName };
    });
}
