import type { InvoiceGroup } from "./types";

/**
 * 발주묶음 공용 저장소의 스냅샷/변경 타입. lib/wms/picking-wave/shared-store-types.ts와 같은
 * 패턴(schemaVersion/revision/updatedAt + 낙관적 동시성)이지만, 웨이브·거래처발주·창고 데이터는
 * 전혀 섞지 않는다 — 이 저장소는 발주묶음 하나만 다룬다.
 */
export interface InvoiceGroupStoreSnapshot {
  schemaVersion: 1;
  revision: number;
  updatedAt: string;
  groups: InvoiceGroup[];
  deletedGroupIds: Record<string, string>;
  /**
   * 시스템 도입(2026-09-18) 이전에 실물로는 이미 전부 끝난(쉽먼트마감+입고결과처리 완료) 발주서를
   * "완전 삭제"할 때 쓰는 영구 제외 목록(PO번호 → 제외 시각). 예외적인 1회성 과거 데이터 정리
   * 용도다 — 정상 흐름에서는 그룹을 만들고 입고결과처리 화면에서 완료 확인 후 그 그룹을
   * InvoiceGroupRepository.delete()로 지우는 것이 맞다. 그룹을 만들었다가 곧바로 지우는 방식은
   * Supplier Hub 원본에 그 PO가 남아 있는 한 다음 조회에서 "신규"로 다시 나타나 버려서 쓸 수
   * 없다 — 그래서 그룹과 별개로 PO 번호 자체를 영구 제외한다.
   */
  excludedPurchaseOrderNumbers: Record<string, string>;
}

export function emptyInvoiceGroupStoreSnapshot(): InvoiceGroupStoreSnapshot {
  return { schemaVersion: 1, revision: 0, updatedAt: new Date(0).toISOString(), groups: [], deletedGroupIds: {}, excludedPurchaseOrderNumbers: {} };
}

export type InvoiceGroupStoreMutation =
  | { action: "save"; group: InvoiceGroup }
  | { action: "delete"; id: string; deletedAt: string }
  | { action: "excludePurchaseOrders"; purchaseOrderNumbers: string[]; excludedAt: string };

export function isInvoiceGroupStoreMutation(value: unknown): value is InvoiceGroupStoreMutation {
  if (!value || typeof value !== "object" || !("action" in value)) return false;
  const candidate = value as { action?: unknown };
  if (candidate.action === "save") return typeof (value as { group?: unknown }).group === "object";
  if (candidate.action === "delete") {
    const v = value as { id?: unknown; deletedAt?: unknown };
    return typeof v.id === "string" && typeof v.deletedAt === "string";
  }
  if (candidate.action === "excludePurchaseOrders") {
    const v = value as { purchaseOrderNumbers?: unknown; excludedAt?: unknown };
    return Array.isArray(v.purchaseOrderNumbers) && v.purchaseOrderNumbers.every(po => typeof po === "string") && typeof v.excludedAt === "string";
  }
  return false;
}
