import { createHash } from "node:crypto";
import { calculateReceivingCost } from "./receiving-cost";
import type { VendorOrderDraftLine } from "./vendor-order/types";

export interface SimpleReceivingInput { quantity: number; unitPrice: number; usedImmediately: boolean }

export function assertReceivingRecordPreserved(current: VendorOrderDraftLine | undefined, incoming: VendorOrderDraftLine): void {
  if (!current?.receivingHistory?.length) return;
  const fields = ["receivedQuantity", "receivedUnitPrice", "receivedVat", "receivedCostVatIncluded", "receivedUsedImmediatelyAt", "receivingHistory", "receivingCompletedAt", "receivingCompletionToken", "isStockReplenishment"] as const;
  if (fields.some(key => JSON.stringify(current[key]) !== JSON.stringify(incoming[key]))) throw new Error("간단 입고기록이 변경되었습니다. 발주서를 새로 열어 주세요.");
}

function plan(line: VendorOrderDraftLine, input: SimpleReceivingInput) {
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 0 || input.quantity > line.shortageQuantity || !Number.isSafeInteger(input.unitPrice) || input.unitPrice < 0 || typeof input.usedImmediately !== "boolean") throw new Error("받은 수량과 입고단가를 확인해 주세요.");
  const cost = calculateReceivingCost(input.unitPrice);
  const token = createHash("sha256").update(JSON.stringify([line, input])).digest("hex");
  return { token, quantity: input.quantity, unitPrice: input.unitPrice, usedImmediately: input.usedImmediately, ...cost };
}

export function saveSimpleReceivingLine(current: VendorOrderDraftLine, before: VendorOrderDraftLine, input: SimpleReceivingInput, now: string): VendorOrderDraftLine {
  if (JSON.stringify(current) !== JSON.stringify(before)) throw new Error("다른 기기에서 발주서가 변경되었습니다. 다시 확인해 주세요.");
  const p = plan(current, input);
  const { receivingHistory, ...backup } = current;
  return { ...current, receivedQuantity: p.quantity, receivedUnitPrice: p.unitPrice, receivedVat: p.vat, receivedCostVatIncluded: p.costVatIncluded, receivedUsedImmediatelyAt: p.usedImmediately ? now : undefined, updatedAt: now, receivingHistory: [...(receivingHistory || []), { savedAt: now, record: backup }] };
}

export function completeReceivingLine(current: VendorOrderDraftLine, before: VendorOrderDraftLine, isStockReplenishment: boolean, now: string): VendorOrderDraftLine {
  if (typeof isStockReplenishment !== "boolean" || !Number.isSafeInteger(before.shortageQuantity) || before.shortageQuantity <= 0) throw new Error("입고완료할 주문수량과 재고보충 여부를 확인해 주세요.");
  if (JSON.stringify(current) !== JSON.stringify(before)) throw new Error("다른 기기에서 발주 품목이 변경되었습니다. 입고완료 내용을 다시 확인해 주세요.");
  const token = createHash("sha256").update(JSON.stringify(["complete-receiving", before, isStockReplenishment])).digest("hex");
  const { receivingHistory, ...backup } = current;
  return { ...current, isStockReplenishment, receivedQuantity: current.shortageQuantity, receivingCompletedAt: now, receivingCompletionToken: token, reorderPendingQuantity: 0, reorderRequestedAt: undefined, updatedAt: now, receivingHistory: [...(receivingHistory || []), { savedAt: now, record: backup }] };
}
