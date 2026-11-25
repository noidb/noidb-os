import type { InvoiceGroup } from "./types";

/**
 * 발주묶음 저장소 인터페이스. 화면은 이 인터페이스에만 의존한다
 * (lib/wms/vendor-order/repository.ts와 동일한 패턴). 실제 저장 방식(localStorage/서버 등)은
 * 구현체 교체만으로 바뀔 수 있다. 웨이브 저장소(picking-wave)와는 완전히 별개다.
 */
export interface InvoiceGroupRepository {
  list(): Promise<InvoiceGroup[]>;
  get(id: string): Promise<InvoiceGroup | null>;
  save(group: InvoiceGroup): Promise<void>;
  /** 여러 묶음을 한 번에 저장(서버 저장 1번). 하나라도 검사에 실패하면 전부 저장하지 않는다. */
  saveMany(groups: InvoiceGroup[]): Promise<void>;
  delete(id: string): Promise<void>;
  /** 시스템 도입 이전 과거 데이터 1회성 정리용 — 발주서 번호 자체를 영구 제외한다(그룹 불필요). */
  listExcludedPurchaseOrderNumbers(): Promise<string[]>;
  excludePurchaseOrders(purchaseOrderNumbers: string[]): Promise<void>;
}
