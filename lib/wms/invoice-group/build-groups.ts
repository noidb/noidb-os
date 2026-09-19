import type { SupplierHubPurchaseOrder } from "../supplier-hub-orders";

/**
 * 합배송 묶음 그룹핑 (2026-09-18 신규 규칙 — 사용자 확정).
 *
 * "입고예정일이 같고 물류센터가 같으면 하나의 한진 송장(합배송)으로 묶는다"는 지금까지
 * 어디에도 없던 규칙이다. 발주서 단위로 무조건 1건씩 처리하던 기존 방식(hanjin-upload/generate,
 * lib/wms/vendor-order 쪽 250개 자동분할과는 무관한 별개 기준)을 대체한다.
 *
 * 우편번호(zip)는 Supplier Hub 원본 발주서 데이터(SupplierHubPurchaseOrder)에 없다 — 발주상세
 * "입고 정보" 페이지에서만 확인 가능하다(06_사이트_한진nFocus.md 참고). 이 함수는 그 값을
 * 채우지 않고 빈 문자열로 둔다 — 한진 송장생성(②단계) 화면에서 별도로 보정해야 한다.
 */
export interface InvoiceGroupDraft {
  expectedDate: string;
  fulfillmentCenter: string;
  fulfillmentCenterAddress: string;
  fulfillmentCenterPhone: string;
  purchaseOrderNumbers: string[];
  mergedFromMultiplePo: boolean;
  skuCount: number;
  totalQuantity: number;
}

function groupKey(order: SupplierHubPurchaseOrder): string {
  return JSON.stringify([order.expectedDate, order.fulfillmentCenter]);
}

export function buildInvoiceGroupDrafts(orders: SupplierHubPurchaseOrder[]): InvoiceGroupDraft[] {
  const groups = new Map<string, SupplierHubPurchaseOrder[]>();
  for (const order of orders) {
    const key = groupKey(order);
    const existing = groups.get(key);
    if (existing) existing.push(order);
    else groups.set(key, [order]);
  }

  return [...groups.values()]
    .map(groupOrders => {
      const first = groupOrders[0];
      const purchaseOrderNumbers = groupOrders.map(order => order.purchaseOrderNumber).sort();
      const skuIds = new Set(groupOrders.flatMap(order => order.items.map(item => item.productCode)));
      const totalQuantity = groupOrders.reduce((sum, order) => sum + order.items.reduce((lineSum, item) => lineSum + item.orderedQuantity, 0), 0);
      return {
        expectedDate: first.expectedDate,
        fulfillmentCenter: first.fulfillmentCenter,
        fulfillmentCenterAddress: first.fulfillmentAddress,
        fulfillmentCenterPhone: first.fulfillmentContactPhone,
        purchaseOrderNumbers,
        mergedFromMultiplePo: purchaseOrderNumbers.length > 1,
        skuCount: skuIds.size,
        totalQuantity,
      };
    })
    .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate) || a.fulfillmentCenter.localeCompare(b.fulfillmentCenter, "ko"));
}
