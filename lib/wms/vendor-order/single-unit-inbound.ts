import type { SupplierHubPurchaseOrder } from "../supplier-hub-orders";
import { isUpcomingInboundDate, todayInKorea } from "../supplier-hub-orders";
import type { ProductCatalogItem } from "../product-catalog";
import { normalizeSkuId } from "../sku-normalize";
import { resolveDisplayOption } from "../display-name";

/**
 * "실제 입고수량이 정확히 1개인 SKU" 목록 (2026-09-11 신규).
 *
 * 쿠팡이 고객반응을 확인하기 위한 테스트 발주일 가능성이 높은 SKU를 놓치지 않기 위한 참고
 * 목록이다. `computeActualInboundShortageLines`와 완전히 같은 Supplier Hub 발주서리스트
 * 데이터(SupplierHubPurchaseOrderLine.receivedQuantity)를 재사용하지만, 계산은 별개다:
 * 미납(확정-입고 부족분)과는 무관하게 "같은 발주서+SKU의 실제 입고수량 합계가 정확히 1"인
 * 것만 고른다 — 현재고나 거래처 발주 부족수량과는 절대 섞지 않는다.
 *
 * 쿠폰/광고 등록 "파일 생성" 기능은 이번에 만들지 않는다(대규모 자동화, 별도 작업 범위) —
 * 이 목록/건수만으로 "오늘 놓치지 않고 확인"하는 용도다. 입고예정일은 있지만 정확한 "실제
 * 입고일" 컬럼이 Supplier Hub 발주서리스트 형식에 없어서, expectedDate(입고예정일)를
 * 참고값으로만 같이 보여준다 — 실제 입고일로 단정하지 않는다.
 */
export interface SingleUnitInboundLine {
  purchaseOrderNumber: string;
  productCode: string;
  productName: string;
  optionLabel: string;
  confirmedQuantity: number;
  /** 항상 1(이 목록에 들어오는 조건). */
  receivedQuantity: number;
  /** 발주서의 입고예정일 — 참고용. 정확한 "실제 입고일" 컬럼이 원본에 없어 대신 표시한다. */
  expectedDateForReference: string;
}

export function computeSingleUnitInboundLines(
  orders: SupplierHubPurchaseOrder[],
  catalogItems: ProductCatalogItem[],
  today = todayInKorea()
): SingleUnitInboundLine[] {
  const catalogBySkuId = new Map<string, ProductCatalogItem>();
  for (const item of catalogItems) catalogBySkuId.set(normalizeSkuId(item.skuId), item);

  const accum = new Map<string, {
    purchaseOrderNumber: string;
    productCode: string;
    productName: string;
    confirmedQuantity: number;
    receivedQuantity: number;
    expectedDateForReference: string;
  }>();

  for (const order of orders) {
    if (!order.purchaseOrderNumber) continue;
    if (isUpcomingInboundDate(order.expectedDate, today)) continue; // 아직 입고 전 — 판단 대상 아님
    for (const line of order.items) {
      if (!line.productCode) continue;
      const key = `${order.purchaseOrderNumber}::${line.productCode}`;
      const existing = accum.get(key);
      if (existing) {
        existing.confirmedQuantity += line.vendorConfirmedQuantity;
        existing.receivedQuantity += line.receivedQuantity;
      } else {
        accum.set(key, {
          purchaseOrderNumber: order.purchaseOrderNumber,
          productCode: line.productCode,
          productName: line.productName,
          confirmedQuantity: line.vendorConfirmedQuantity,
          receivedQuantity: line.receivedQuantity,
          expectedDateForReference: order.expectedDate,
        });
      }
    }
  }

  const results: SingleUnitInboundLine[] = [];
  for (const item of accum.values()) {
    if (item.receivedQuantity !== 1) continue;
    const catalogEntry = catalogBySkuId.get(normalizeSkuId(item.productCode));
    const productName = catalogEntry?.productName || item.productName;
    results.push({
      purchaseOrderNumber: item.purchaseOrderNumber,
      productCode: item.productCode,
      productName,
      optionLabel: resolveDisplayOption(productName, catalogEntry?.optionLabel),
      confirmedQuantity: item.confirmedQuantity,
      receivedQuantity: item.receivedQuantity,
      expectedDateForReference: item.expectedDateForReference,
    });
  }
  return results;
}
