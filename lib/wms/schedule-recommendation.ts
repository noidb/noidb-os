import type { SupplierHubPurchaseOrder } from "./supplier-hub-orders";

/**
 * 실제 발주서 목록에서 "입고예정일/물류센터 변경 추천"만 계산하는 순수 함수 모듈.
 *
 * 이 모듈은 추천만 만들고, 어떤 자동 요청·승인·변경도 하지 않는다 (2026-08-19 사용자 확정,
 * 이번 스프린트 범위). 최종 변경은 사용자가 직접 쿠팡 서플라이허브에서 진행한다.
 * lib/wms/types.ts의 ScheduleChangeRequest(자동 요청/승인 흐름)는 다음 스프린트 대상이며
 * 이 모듈과는 무관하다.
 *
 * 예상 절감액: 실제 배송비 데이터가 없으므로 금액을 임의로 계산하지 않는다 (2026-08-19 사용자 확정).
 * 항상 고정 문구 "절감 가능성 있음"만 표시한다.
 */

export type ScheduleRecommendationPriority = "high" | "medium" | "low";

export interface ScheduleChangeRecommendation {
  /** `${변경대상 발주서}->${기준 발주서}` 형태의 안정적인 키 (화면/localStorage 결정 저장에도 사용) */
  id: string;
  /** 변경을 추천하는 대상 발주서 (수량이 더 적은 쪽) */
  targetPurchaseOrderNumber: string;
  /** 맞춰야 할 기준 발주서 (수량이 더 많은 쪽) */
  anchorPurchaseOrderNumber: string;
  current: { expectedDate: string; fulfillmentCenter: string };
  recommended: { expectedDate: string; fulfillmentCenter: string };
  reason: string;
  /** 같이 출고 가능한 SKU 목록 (상품코드 + 상품명) */
  sharedSkus: { productCode: string; productName: string }[];
  /** 예상 합배송 수량 — 공통 SKU들의 두 발주서 수량 합 */
  combinedShipQuantity: number;
  dateDiffDays: number;
  sameRegion: boolean;
  priority: ScheduleRecommendationPriority;
  /** 실제 배송비 데이터가 없어 금액을 계산하지 않는다 — 항상 이 고정 문구만 표시 */
  savingsNote: "절감 가능성 있음";
}

function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  if (!Number.isFinite(da) || !Number.isFinite(db)) return NaN;
  return Math.round(Math.abs(da - db) / (1000 * 60 * 60 * 24));
}

/**
 * 물류센터명 → 대략적인 권역. 정확한 쿠팡 FC 권역 데이터가 없어 지역명 접두어 기반의
 * 추정치다 (참고용 신호일 뿐, 추천 여부를 이 값만으로 가르지 않는다). 필요시 실제 데이터로 교체.
 */
function guessRegion(fulfillmentCenter: string): string {
  const name = fulfillmentCenter.trim();
  if (/^(인천|서울|고양|이천|평택|오산|용인|안성|여주|남양주|김포|파주|동탄|수원|안산|화성|의왕|하남)/.test(name)) return "수도권";
  if (/^(대구|경산|칠곡|구미|포항)/.test(name)) return "대구경북권";
  if (/^(부산|김해|양산|창원|울산)/.test(name)) return "동남권";
  if (/^(대전|청주|천안|세종|충주)/.test(name)) return "충청권";
  if (/^(광주|나주|전주)/.test(name)) return "호남권";
  return "기타";
}

/** 같은 거래처·입고예정일·물류센터에 이미 함께 출고할 다른 발주서가 있는지 확인한다. */
function hasExistingShipmentGroup(order: SupplierHubPurchaseOrder, orders: SupplierHubPurchaseOrder[]): boolean {
  return orders.some(candidate =>
    candidate.purchaseOrderNumber !== order.purchaseOrderNumber &&
    candidate.accountName === order.accountName &&
    candidate.expectedDate === order.expectedDate &&
    candidate.fulfillmentCenter === order.fulfillmentCenter
  );
}

/**
 * 두 발주서씩 비교해 아래 조건을 모두 만족하면 합배송 추천을 만든다:
 * - 같은 거래처(accountName)
 * - 공통 SKU(상품코드) 1개 이상
 * - 입고예정일 차이 0~1일 (같은 날 포함 — "같은 날짜에 이미 출고 예정인 발주"도 포함)
 * - 물류센터와 입고예정일이 이미 완전히 같은 경우는 제외 (추천할 것이 없음)
 *
 * 수량이 더 적은 발주서를 "변경 대상", 더 많은 발주서를 "기준"으로 삼아 대상 쪽을
 * 기준에 맞추는 방향으로 추천한다 (변경 폭을 최소화하기 위한 참고용 기준일 뿐,
 * 실제로 어느 쪽을 바꿀지는 사용자가 결정한다).
 */
export function buildScheduleChangeRecommendations(
  orders: SupplierHubPurchaseOrder[]
): ScheduleChangeRecommendation[] {
  const recommendations: ScheduleChangeRecommendation[] = [];

  for (let i = 0; i < orders.length; i++) {
    for (let j = i + 1; j < orders.length; j++) {
      const a = orders[i];
      const b = orders[j];
      if (a.accountName !== b.accountName) continue;

      const aByCode = new Map(a.items.map(item => [item.productCode, item]));
      const sharedSkus: { productCode: string; productName: string }[] = [];
      let combinedShipQuantity = 0;
      for (const lineB of b.items) {
        const lineA = aByCode.get(lineB.productCode);
        if (!lineA) continue;
        sharedSkus.push({ productCode: lineB.productCode, productName: lineB.productName });
        combinedShipQuantity += lineA.orderedQuantity + lineB.orderedQuantity;
      }
      if (sharedSkus.length === 0) continue;

      const dateDiffDays = daysBetween(a.expectedDate, b.expectedDate);
      if (!Number.isFinite(dateDiffDays) || dateDiffDays > 1) continue;

      const centerSame = a.fulfillmentCenter === b.fulfillmentCenter;
      if (centerSame && dateDiffDays === 0) continue;

      const regionA = guessRegion(a.fulfillmentCenter);
      const regionB = guessRegion(b.fulfillmentCenter);
      const sameRegion = regionA === regionB;

      const aQty = a.items.reduce((sum, item) => sum + item.orderedQuantity, 0);
      const bQty = b.items.reduce((sum, item) => sum + item.orderedQuantity, 0);
      const aHasShipmentGroup = hasExistingShipmentGroup(a, orders);
      const bHasShipmentGroup = hasExistingShipmentGroup(b, orders);

      // 서로 다른 센터라도 양쪽 모두 현재 날짜·센터에 이미 합배송할 발주서가 있으면
      // 서울→대구와 대구→서울처럼 불필요하고 상충하는 센터 변경 추천을 만들지 않는다.
      if (!centerSame && aHasShipmentGroup && bHasShipmentGroup) continue;

      // 한쪽만 기존 합배송 그룹에 속해 있으면 그 그룹을 깨지 않고, 미그룹 발주서를 그룹 쪽에
      // 맞추는 방향으로 추천한다. 양쪽 모두 미그룹일 때만 기존 수량 기준을 사용한다.
      const [target, anchor] = aHasShipmentGroup !== bHasShipmentGroup
        ? (aHasShipmentGroup ? [b, a] : [a, b])
        : (aQty <= bQty ? [a, b] : [b, a]);

      const reasonParts = [
        `공통 SKU ${sharedSkus.length}종`,
        "동일 거래처",
        centerSame ? "동일 물류센터" : `물류센터 상이 (${a.fulfillmentCenter} / ${b.fulfillmentCenter})`,
        dateDiffDays === 0 ? "입고예정일 동일(같은 날 출고 예정)" : `입고예정일 ${dateDiffDays}일 차이`,
      ];
      if (!centerSame && sameRegion) reasonParts.push(`동일 권역(${regionA}) 추정`);
      const reason = reasonParts.join(" · ");

      let priority: ScheduleRecommendationPriority = "low";
      if (centerSame && sharedSkus.length >= 2) priority = "high";
      else if (sharedSkus.length >= 1 && dateDiffDays <= 1 && (centerSame || sameRegion)) priority = "medium";

      recommendations.push({
        id: `${target.purchaseOrderNumber}->${anchor.purchaseOrderNumber}`,
        targetPurchaseOrderNumber: target.purchaseOrderNumber,
        anchorPurchaseOrderNumber: anchor.purchaseOrderNumber,
        current: { expectedDate: target.expectedDate, fulfillmentCenter: target.fulfillmentCenter },
        recommended: { expectedDate: anchor.expectedDate, fulfillmentCenter: anchor.fulfillmentCenter },
        reason,
        sharedSkus,
        combinedShipQuantity,
        dateDiffDays,
        sameRegion,
        priority,
        savingsNote: "절감 가능성 있음",
      });
    }
  }

  const priorityOrder: Record<ScheduleRecommendationPriority, number> = { high: 0, medium: 1, low: 2 };
  return recommendations.sort((x, y) => {
    if (priorityOrder[x.priority] !== priorityOrder[y.priority]) {
      return priorityOrder[x.priority] - priorityOrder[y.priority];
    }
    return y.sharedSkus.length - x.sharedSkus.length;
  });
}
