import { LOGISTICS_RECEIPT_EPOCH } from "./logistics-receipts";
import type { WeeklyWorkspace } from "./weekly-work-types";

/**
 * 사용자 확정(2026-10-08): 예전 입고결과·과거청산 처리기록은 모두 지우고
 * 2026-09-13 이후 입고예정 마감 쉽먼트부터 새로 처리한다. 쿠팡 목록 수집을 처음 저장할 때 한 번만 실행된다.
 * 상품 정보(productOverrides)와 쿠폰 종료일 확인기록(couponChecks)은 처리기록이 아니므로 남긴다.
 */
export function resetLogisticsReceiptHistory(workspace: WeeklyWorkspace): boolean {
  if (workspace.logisticsReceiptEpoch === LOGISTICS_RECEIPT_EPOCH) return false;
  workspace.runs = [];
  delete workspace.logisticsReceipts;
  delete workspace.logisticsReceiptRoutes;
  delete workspace.logisticsFollowUp;
  delete workspace.shipmentReceiptOrders;
  delete workspace.materialSnapshot;
  delete workspace.workTransfers;
  delete workspace.statusCompletionIds;
  workspace.logisticsReceiptEpoch = LOGISTICS_RECEIPT_EPOCH;
  return true;
}
