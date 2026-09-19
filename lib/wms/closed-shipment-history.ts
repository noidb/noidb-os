import { logisticsReceiptLineKey, type LogisticsReceiptSnapshot } from "./logistics-receipts";

export interface ClosedShipmentMetadata {
  expectedDate: string;
  centerName: string;
}

export interface ClosedShipmentHistoryRow {
  expectedDate: string;
  centerName: string;
  shipmentNumber: string;
  purchaseOrderNumber: string;
  skuId: string;
  productName: string;
  receivedQuantity: number;
}

export interface ClosedShipmentHistoryDateSummary {
  expectedDate: string;
  shipmentCount: number;
  purchaseOrderCount: number;
  skuCount: number;
  receivedQuantity: number;
}

const UNRECORDED_EXPECTED_DATE = "입고예정일 기록 없음";
const UNRECORDED_CENTER = "센터 기록 없음";

/**
 * Turns the saved closed-shipment snapshot into a display-only ledger. Box
 * rows are intentionally folded by shipment/PO/SKU, so they cannot be added
 * to the monthly inbound aggregate or displayed as duplicate receipt totals.
 */
export function summarizeClosedShipmentHistory(
  snapshot: LogisticsReceiptSnapshot | undefined,
  metadataByShipment: ReadonlyMap<string, ClosedShipmentMetadata | undefined>,
): ClosedShipmentHistoryRow[] {
  const rows = new Map<string, ClosedShipmentHistoryRow>();
  const seenBoxLines = new Set<string>();
  for (const shipment of snapshot?.shipments || []) {
    if (shipment.status !== "마감") continue;
    const metadata = metadataByShipment.get(shipment.shipmentNumber);
    const expectedDate = metadata?.expectedDate || UNRECORDED_EXPECTED_DATE;
    const centerName = metadata?.centerName || UNRECORDED_CENTER;
    for (const line of shipment.lines) {
      const sourceKey = logisticsReceiptLineKey(shipment.shipmentNumber, line.boxId, line.purchaseOrderNumber, line.skuId);
      if (seenBoxLines.has(sourceKey)) continue;
      seenBoxLines.add(sourceKey);
      const key = JSON.stringify([expectedDate, centerName, shipment.shipmentNumber, line.purchaseOrderNumber, line.skuId, line.productName]);
      const existing = rows.get(key);
      const receivedQuantity = (existing?.receivedQuantity || 0) + line.receivedQuantity;
      if (!Number.isSafeInteger(receivedQuantity)) throw new Error("마감 쉽먼트 입고수량의 합계 범위를 확인해 주세요.");
      rows.set(key, {
        expectedDate, centerName, shipmentNumber: shipment.shipmentNumber,
        purchaseOrderNumber: line.purchaseOrderNumber, skuId: line.skuId,
        productName: line.productName, receivedQuantity,
      });
    }
  }
  return [...rows.values()].sort((a, b) => b.expectedDate.localeCompare(a.expectedDate, "ko")
    || a.centerName.localeCompare(b.centerName, "ko")
    || a.shipmentNumber.localeCompare(b.shipmentNumber)
    || a.purchaseOrderNumber.localeCompare(b.purchaseOrderNumber)
    || a.skuId.localeCompare(b.skuId));
}

export function summarizeClosedShipmentHistoryDates(rows: readonly ClosedShipmentHistoryRow[]): ClosedShipmentHistoryDateSummary[] {
  const summaries = new Map<string, ClosedShipmentHistoryDateSummary & { shipments: Set<string>; purchaseOrders: Set<string>; skus: Set<string> }>();
  for (const row of rows) {
    const current = summaries.get(row.expectedDate) || {
      expectedDate: row.expectedDate, shipmentCount: 0, purchaseOrderCount: 0, skuCount: 0, receivedQuantity: 0,
      shipments: new Set<string>(), purchaseOrders: new Set<string>(), skus: new Set<string>(),
    };
    current.shipments.add(row.shipmentNumber);
    current.purchaseOrders.add(row.purchaseOrderNumber);
    current.skus.add(row.skuId);
    current.receivedQuantity += row.receivedQuantity;
    summaries.set(row.expectedDate, current);
  }
  return [...summaries.values()].map(summary => ({
    expectedDate: summary.expectedDate,
    shipmentCount: summary.shipments.size,
    purchaseOrderCount: summary.purchaseOrders.size,
    skuCount: summary.skus.size,
    receivedQuantity: summary.receivedQuantity,
  })).sort((a, b) => b.expectedDate.localeCompare(a.expectedDate, "ko"));
}
