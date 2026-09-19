import type { InvoiceGroup } from "./types";
import type { InvoiceGroupRepository } from "./repository";
import { LocalInvoiceGroupRepository, replaceLocalExcludedPoNumbers, replaceLocalInvoiceGroupSnapshot } from "./local-repository";
import type { InvoiceGroupStoreMutation, InvoiceGroupStoreSnapshot } from "./shared-store-types";

/**
 * 서버 저장소 + 로컬 미러 조합 클라이언트 저장소. lib/wms/vendor-order/shared-repository.ts와
 * 같은 패턴이지만, 이 저장소는 처음부터 독립 저장소로 태어났기 때문에(마이그레이션 대상 구
 * localStorage 데이터가 없음) 마이그레이션 단계 없이 훨씬 단순하다.
 */

async function requestSnapshot(mutation?: InvoiceGroupStoreMutation): Promise<InvoiceGroupStoreSnapshot> {
  const response = await fetch("/api/wms/invoice-groups", mutation ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mutation), cache: "no-store",
  } : { cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok || !result.snapshot) throw new Error(result.error || `발주묶음 저장 실패(HTTP ${response.status})`);
  return result.snapshot;
}

export class SharedInvoiceGroupRepository implements InvoiceGroupRepository {
  private readonly local = new LocalInvoiceGroupRepository();

  private async refresh(): Promise<InvoiceGroupStoreSnapshot> {
    const snapshot = await requestSnapshot();
    replaceLocalInvoiceGroupSnapshot(snapshot.groups);
    replaceLocalExcludedPoNumbers(Object.keys(snapshot.excludedPurchaseOrderNumbers));
    return snapshot;
  }

  async list(): Promise<InvoiceGroup[]> {
    try { return (await this.refresh()).groups; } catch { return this.local.list(); }
  }

  async get(id: string): Promise<InvoiceGroup | null> {
    try { return (await this.refresh()).groups.find(group => group.id === id) || null; } catch { return this.local.get(id); }
  }

  async save(group: InvoiceGroup): Promise<void> {
    const snapshot = await requestSnapshot({ action: "save", group });
    replaceLocalInvoiceGroupSnapshot(snapshot.groups);
  }

  async delete(id: string): Promise<void> {
    await this.local.delete(id);
    const snapshot = await requestSnapshot({ action: "delete", id, deletedAt: new Date().toISOString() });
    replaceLocalInvoiceGroupSnapshot(snapshot.groups);
  }

  async listExcludedPurchaseOrderNumbers(): Promise<string[]> {
    try { return Object.keys((await this.refresh()).excludedPurchaseOrderNumbers); } catch { return this.local.listExcludedPurchaseOrderNumbers(); }
  }

  async excludePurchaseOrders(purchaseOrderNumbers: string[]): Promise<void> {
    await this.local.excludePurchaseOrders(purchaseOrderNumbers);
    const snapshot = await requestSnapshot({ action: "excludePurchaseOrders", purchaseOrderNumbers, excludedAt: new Date().toISOString() });
    replaceLocalExcludedPoNumbers(Object.keys(snapshot.excludedPurchaseOrderNumbers));
  }
}
