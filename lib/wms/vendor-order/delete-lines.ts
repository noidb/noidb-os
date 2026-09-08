import type { VendorOrderDraft, VendorOrderDraftLine } from "./types";

/** The draft editor and the atomic server mutation use the same deletion boundary. */
export function getVendorLineDeletionBlockReason(line: VendorOrderDraftLine, draft?: Pick<VendorOrderDraft, "status">): string | null {
  if (line.receivingHistory?.length || line.receivedUsedImmediatelyAt || line.receivedCostAppliedAt
    || [line.receivedQuantity, line.receivedUnitPrice, line.receivedVat, line.receivedCostVatIncluded].some(value => value !== undefined && value !== null && value !== 0)) {
    return "입고·원가 이력이 있는 품목은 초안에서 삭제할 수 없습니다. 입고관리에서 이력을 확인해 주세요.";
  }
  if (!["draft", "review", "resend_needed"].includes(draft?.status || "draft")) {
    return "승인·전송된 발주 품목은 삭제할 수 없습니다. 먼저 수정 상태로 변경해 주세요.";
  }
  return null;
}

export class VendorLineBatchDeleteConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VendorLineBatchDeleteConflictError";
  }
}
