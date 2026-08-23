import type { PickingWaveItem } from "./types";
import { sortWarehouseProducts } from "../category-order";

/**
 * 발주서(PO) 1건 기준으로 확정수량 서류 생성에 필요한 행을 계산하는 순수 함수.
 * 원래 PoConfirmSection.tsx 안에 있던 로직을 그대로 옮겨왔다 — 개별 발주서 생성 버튼과
 * "전체 발주확정 서류 생성"(ZIP) 버튼이 똑같은 계산을 다시 만들지 않고 이 함수 하나를
 * 공유한다 (2026-08-19 4차 실사용 테스트 반영).
 */
export interface PoConfirmRow {
  skuId: string;
  productName: string;
  originalQuantity: number;
  foundQuantity: number;
  shortageQuantity: number;
}

export function buildPoConfirmRows(items: PickingWaveItem[], purchaseOrderNumber: string): PoConfirmRow[] {
  return sortWarehouseProducts(items.filter(item => item.sources.some(source => source.purchaseOrderNumber === purchaseOrderNumber)))
    .map(item => {
      const source = item.sources.find(s => s.purchaseOrderNumber === purchaseOrderNumber)!;
      const allocation = item.allocations.find(a => a.purchaseOrderNumber === purchaseOrderNumber);
      const foundQuantity = allocation ? allocation.fulfilledQuantity : 0;
      return {
        skuId: item.productCode,
        productName: item.productName,
        originalQuantity: source.requestedQuantity,
        foundQuantity,
        shortageQuantity: Math.max(0, source.requestedQuantity - foundQuantity),
      };
    });
}
