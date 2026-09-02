import type { BasketAssignment } from "./types";

/**
 * 내부 발주서 배정번호(basketNumber)의 표시 이름을 물류센터명으로 바꾼다.
 * (2026-08-19 사용자 확정 — 현장에서 물류센터 기준으로 바로 찾을 수 있어야 하므로).
 * 내부 basketNumber/분배 로직은 그대로 두고, 화면에 보여줄 라벨만 계산하는 순수 함수다.
 * 같은 물류센터가 여러 발주서로 나뉘면 "물류센터명-1", "물류센터명-2"처럼 번호를 붙인다.
 */
export function buildBasketDisplayNames(baskets: BasketAssignment[]): Record<string, string> {
  const sorted = [...baskets].sort((a, b) => Number(a.basketNumber) - Number(b.basketNumber));
  const countByCenter = new Map<string, number>();
  for (const basket of sorted) {
    countByCenter.set(basket.fulfillmentCenter, (countByCenter.get(basket.fulfillmentCenter) || 0) + 1);
  }

  const seenByCenter = new Map<string, number>();
  const result: Record<string, string> = {};
  for (const basket of sorted) {
    const total = countByCenter.get(basket.fulfillmentCenter) || 1;
    if (total <= 1) {
      result[basket.basketNumber] = basket.fulfillmentCenter;
    } else {
      const nextIndex = (seenByCenter.get(basket.fulfillmentCenter) || 0) + 1;
      seenByCenter.set(basket.fulfillmentCenter, nextIndex);
      result[basket.basketNumber] = `${basket.fulfillmentCenter}-${nextIndex}`;
    }
  }
  return result;
}
