import type { PickingAllocationResult, PickingWaveSourceRef } from "./types";

/**
 * 부분찾음 시 발주서별 부족 배분 "추천 기본값"을 계산한다 (2026-08-18 사용자 확정 규칙):
 * 내부 배정번호 오름차순으로 요청 수량을 먼저 채우고, 못 채운 나머지는 자연히 번호가 큰 발주서부터
 * 부족으로 남는다. 이 함수는 제안값만 계산할 뿐 저장하지 않는다 — 화면에서 사용자가 배정수량을
 * 직접 고쳐 쓸 수 있고, 사용자가 확인 버튼을 눌러야만 최종 저장된다.
 */
export function proposeShortageAllocation(
  sources: PickingWaveSourceRef[],
  pickedTotal: number
): PickingAllocationResult[] {
  const ordered = [...sources].sort((a, b) => Number(a.basketNumber) - Number(b.basketNumber));
  let remaining = Math.max(0, pickedTotal);

  return ordered.map(source => {
    const fulfilledQuantity = Math.min(source.requestedQuantity, remaining);
    remaining -= fulfilledQuantity;
    return {
      purchaseOrderNumber: source.purchaseOrderNumber,
      basketNumber: source.basketNumber,
      requestedQuantity: source.requestedQuantity,
      fulfilledQuantity,
      shortageQuantity: source.requestedQuantity - fulfilledQuantity,
    };
  });
}

/** 배정수량 합계가 실제 찾은 수량과 일치하는지 검증한다 — 확인 버튼 활성화 조건. */
export function sumFulfilledQuantity(allocations: PickingAllocationResult[]): number {
  return allocations.reduce((sum, allocation) => sum + allocation.fulfilledQuantity, 0);
}
