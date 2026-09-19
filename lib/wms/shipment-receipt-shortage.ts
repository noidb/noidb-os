import { normalizeSkuId } from "./sku-normalize";
import { summarizeShipmentReceipt, type ShipmentReceiptOrder, type ShipmentReceiptOrders } from "./shipment-receipts";

export interface ShipmentShortagePurchaseItem {
  productCode: string;
  productName: string;
  vendorConfirmedQuantity: number;
}

export interface ShipmentShortagePurchaseOrder {
  purchaseOrderNumber: string;
  items: ShipmentShortagePurchaseItem[];
}

export interface ShipmentReceiptShortageLine {
  purchaseOrderNumber: string;
  skuId: string;
  productName: string;
  confirmedQuantity: number;
  receivedQuantity: number;
  shortageQuantity: number;
}

export interface ShipmentReceiptShortageResult {
  purchaseOrderNumber: string;
  status: "ready" | "waiting";
  shipmentCount: number;
  closedCount: number;
  pendingShipmentNumbers: string[];
  lines: ShipmentReceiptShortageLine[];
  blockers: string[];
}

/**
 * Calculates shortages only from a complete, explicitly collected shipment snapshot.
 * It deliberately does not consult settlement status or the old inbound-history files.
 */
export function calculateShipmentReceiptShortages(
  orders: ShipmentShortagePurchaseOrder[],
  snapshots: ShipmentReceiptOrders,
): ShipmentReceiptShortageResult[] {
  return orders.map(order => {
    const snapshot: ShipmentReceiptOrder | undefined = snapshots[order.purchaseOrderNumber];
    if (!snapshot) return {
      purchaseOrderNumber: order.purchaseOrderNumber, status: "waiting", shipmentCount: 0, closedCount: 0,
      pendingShipmentNumbers: [], lines: [], blockers: ["쉽먼트 수집 자료가 없습니다."],
    };
    const summary = summarizeShipmentReceipt(snapshot);
    if (!summary.complete) return {
      purchaseOrderNumber: order.purchaseOrderNumber, status: "waiting", shipmentCount: summary.shipmentCount,
      closedCount: summary.closedCount, pendingShipmentNumbers: summary.pendingShipmentNumbers, lines: [],
      blockers: ["연결된 쉽먼트가 모두 마감된 뒤 미납을 계산합니다."],
    };

    const seen = new Set<string>();
    const lines: ShipmentReceiptShortageLine[] = [];
    const blockers: string[] = [];
    for (const item of order.items) {
      const skuId = normalizeSkuId(item.productCode);
      if (!skuId || !Number.isSafeInteger(item.vendorConfirmedQuantity) || item.vendorConfirmedQuantity < 0) {
        blockers.push(`SKU ${item.productCode || "미확인"}의 확정수량을 확인할 수 없습니다.`);
        continue;
      }
      if (seen.has(skuId)) {
        blockers.push(`SKU ${skuId}가 발주서에 중복되어 있습니다.`);
        continue;
      }
      seen.add(skuId);
      const receivedQuantity = summary.receivedBySku[skuId] || 0;
      const shortageQuantity = Math.max(item.vendorConfirmedQuantity - receivedQuantity, 0);
      if (shortageQuantity > 0) lines.push({
        purchaseOrderNumber: order.purchaseOrderNumber, skuId, productName: item.productName,
        confirmedQuantity: item.vendorConfirmedQuantity, receivedQuantity, shortageQuantity,
      });
    }
    return {
      purchaseOrderNumber: order.purchaseOrderNumber, status: blockers.length ? "waiting" : "ready",
      shipmentCount: summary.shipmentCount, closedCount: summary.closedCount,
      pendingShipmentNumbers: summary.pendingShipmentNumbers, lines: blockers.length ? [] : lines, blockers,
    };
  });
}
