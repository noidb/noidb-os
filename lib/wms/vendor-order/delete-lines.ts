import type { VendorOrderDraft, VendorOrderDraftLine } from "./types";

/** The draft editor and the atomic server mutation use the same deletion boundary. */
export function getVendorLineDeletionBlockReason(line: VendorOrderDraftLine, draft?: Pick<VendorOrderDraft, "status">, allowSentDeletion = false): string | null {
  if (line.receivingHistory?.length || line.receivedUsedImmediatelyAt || line.receivedCostAppliedAt
    || [line.receivedQuantity, line.receivedUnitPrice, line.receivedVat, line.receivedCostVatIncluded].some(value => value !== undefined && value !== null && value !== 0)) {
    return "입고·원가 이력이 있는 품목은 초안에서 삭제할 수 없습니다. 입고관리에서 이력을 확인해 주세요.";
  }
  if (line.orderExclusion || line.vendorTransfer || line.sentResolution || line.receivingCompletedAt) {
    return "이미 처리완료한 상품입니다. 기존 처리 이력을 확인해 주세요.";
  }
  if (!allowSentDeletion && !["draft", "review", "resend_needed"].includes(draft?.status || "draft")) return "승인·전송된 발주 품목은 먼저 수정 상태로 변경해 주세요.";
  return null;
}

export class VendorLineBatchDeleteConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VendorLineBatchDeleteConflictError";
  }
}
