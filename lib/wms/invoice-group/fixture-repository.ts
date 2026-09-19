import type { InvoiceGroupRepository } from "./repository";
import type { InvoiceGroup } from "./types";

/** Development-only browser memory used by the logistics flow preview. */
export class FixtureInvoiceGroupRepository implements InvoiceGroupRepository {
  private groups: InvoiceGroup[];
  private excluded = new Set<string>();
  private readonly key = "noidb_logistics_fixture_groups_v1";
  constructor() {
    try { this.groups = JSON.parse(window.sessionStorage.getItem(this.key) || "[]") as InvoiceGroup[]; }
    catch { this.groups = []; }
  }
  private persist() { window.sessionStorage.setItem(this.key, JSON.stringify(this.groups)); }
  async list() { return structuredClone(this.groups); }
  async get(id: string) { return structuredClone(this.groups.find(group => group.id === id) || null); }
  async save(group: InvoiceGroup) {
    const index = this.groups.findIndex(item => item.id === group.id);
    if (index >= 0) this.groups[index] = structuredClone(group); else this.groups.push(structuredClone(group));
    this.persist();
  }
  async delete(id: string) { this.groups = this.groups.filter(group => group.id !== id); this.persist(); }
  async listExcludedPurchaseOrderNumbers() { return [...this.excluded]; }
  async excludePurchaseOrders(purchaseOrderNumbers: string[]) { for (const po of purchaseOrderNumbers) this.excluded.add(po); }
}
