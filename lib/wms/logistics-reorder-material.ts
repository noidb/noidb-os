import { logisticsReceiptLineKey } from "./logistics-receipts";
import type { WeeklyReorderRow } from "./weekly-reorder-files";
import type { WeeklyRun, WeeklyWorkspace } from "./weekly-work-types";

export interface LogisticsReorderLine {
  lineKey: string; shipmentNumber: string; boxId: string; purchaseOrderNumber: string; skuId: string;
  deliveredQuantity: number; receivedQuantity: number; handledQuantity?: number; shortageQuantity: number;
}
export interface LogisticsReorderMaterial { line: LogisticsReorderLine; row: WeeklyReorderRow }
type LogisticsRun = WeeklyRun & { logisticsReceiptLine?: LogisticsReorderLine };

const isId = (value: unknown) => typeof value === "string" && /^\d{1,20}$/.test(value);
const isQuantity = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function logisticsReorderLine(run: WeeklyRun): LogisticsReorderLine | undefined {
  return (run as LogisticsRun).logisticsReceiptLine;
}
export function logisticsReorderLines(run: WeeklyRun): LogisticsReorderLine[] {
  const many = (run as LogisticsRun).logisticsReceiptLines;
  return many?.length ? many : logisticsReorderLine(run) ? [logisticsReorderLine(run)!] : [];
}

/** Reads only the persisted v2 receipt snapshot; saved weekly material must never replace this source. */
export function logisticsReorderMaterial(workspace: WeeklyWorkspace, run: WeeklyRun, sourceLine?: LogisticsReorderLine): LogisticsReorderMaterial {
  const line = sourceLine || logisticsReorderLine(run);
  if (!line || !isId(line.shipmentNumber) || typeof line.boxId !== "string" || !line.boxId.trim()
    || !isId(line.purchaseOrderNumber) || !isId(line.skuId) || !isQuantity(line.deliveredQuantity)
    || !isQuantity(line.receivedQuantity) || (line.handledQuantity !== undefined && !isQuantity(line.handledQuantity)) || !isQuantity(line.shortageQuantity)
    || line.deliveredQuantity - line.receivedQuantity - (line.handledQuantity || 0) !== line.shortageQuantity || line.shortageQuantity <= 0
    || line.lineKey !== logisticsReceiptLineKey(line.shipmentNumber, line.boxId, line.purchaseOrderNumber, line.skuId)) {
    throw new Error("물류 쉽먼트 미납 출처를 확인하지 못했습니다.");
  }
  const shipment = workspace.logisticsReceipts?.shipments.find(item => item.shipmentNumber === line.shipmentNumber);
  const current = shipment?.status === "마감" ? shipment.lines.find(item => logisticsReceiptLineKey(shipment.shipmentNumber, item.boxId, item.purchaseOrderNumber, item.skuId) === line.lineKey) : undefined;
  if (!current || current.purchaseOrderNumber !== line.purchaseOrderNumber || current.skuId !== line.skuId
    || current.deliveredQuantity !== line.deliveredQuantity || current.receivedQuantity !== line.receivedQuantity
    || current.deliveredQuantity - current.receivedQuantity - (line.handledQuantity || 0) !== line.shortageQuantity) {
    throw new Error("현재 저장된 쉽먼트 수집 자료와 미납수량이 달라 재발주에서 제외됩니다.");
  }
  const item = run.snapshot.vendorItems.find(value => value.skuId === line.skuId);
  if (!item?.productName) throw new Error("물류 쉽먼트 미납 항목의 상품 정보를 확인해 주세요.");
  return { line, row: { purchaseOrderNumber: line.purchaseOrderNumber, skuId: line.skuId, productName: item.productName, shortageQuantity: line.shortageQuantity } };
}
