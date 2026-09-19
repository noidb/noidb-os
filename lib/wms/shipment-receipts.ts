/** Supplier Hub shipment snapshots. Quantities are snapshots, never additive events. */
export interface ShipmentReceiptLine {
  boxId: string;
  purchaseOrderNumber: string;
  skuId: string;
  productName: string;
  barcode: string;
  deliveredQuantity: number;
  receivedQuantity: number;
}
export interface ShipmentReceipt {
  shipmentNumber: string;
  status: string;
  totalDelivered: number | null;
  totalReceived: number | null;
  lines: ShipmentReceiptLine[];
}
export interface ShipmentReceiptImport {
  source: "supplier-hub-shipments";
  schemaVersion: 1;
  collectedAt: string;
  orders: Array<{ purchaseOrderNumber: string; shipmentNumbers: string[] }>;
  shipments: ShipmentReceipt[];
}
export interface ShipmentReceiptOrder {
  purchaseOrderNumber: string;
  collectedAt: string;
  shipments: ShipmentReceipt[];
}
export type ShipmentReceiptOrders = Record<string, ShipmentReceiptOrder>;

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && /^\d{1,20}$/.test(v);
const text = (v: unknown, max = 500): v is string => typeof v === "string" && v.length <= max;
const quantity = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const unique = (items: string[]) => new Set(items).size === items.length;

export function parseShipmentReceiptImport(value: unknown): ShipmentReceiptImport {
  const invalid = () => { throw new Error("쉽먼트 수집 자료가 불완전하거나 수량 합계가 맞지 않습니다. 다시 가져와 주세요."); };
  if (!record(value) || value.source !== "supplier-hub-shipments" || value.schemaVersion !== 1
    || !text(value.collectedAt, 40) || !/^\d{4}-\d{2}-\d{2}T/.test(value.collectedAt)
    || !Number.isFinite(Date.parse(value.collectedAt)) || Date.parse(value.collectedAt) > Date.now() + 300_000
    || !Array.isArray(value.orders) || !value.orders.length || value.orders.length > 200
    || !Array.isArray(value.shipments) || value.shipments.length > 2000) return invalid();
  for (const order of value.orders) {
    if (!record(order) || !id(order.purchaseOrderNumber) || !Array.isArray(order.shipmentNumbers)
      || order.shipmentNumbers.length > 1000 || !order.shipmentNumbers.every(id) || !unique(order.shipmentNumbers)) return invalid();
  }
  for (const shipment of value.shipments) {
    if (!record(shipment) || !id(shipment.shipmentNumber) || !text(shipment.status, 40) || !shipment.status.trim()
      || !Array.isArray(shipment.lines) || shipment.lines.length > 10000) return invalid();
    if (shipment.status !== "마감") {
      // Open shipments are blockers. Partial quantities must not become final receipts.
      if (shipment.lines.length || shipment.totalDelivered !== null || shipment.totalReceived !== null) return invalid();
      continue;
    }
    if (!shipment.lines.length || !quantity(shipment.totalDelivered) || !quantity(shipment.totalReceived)) return invalid();
    const keys = new Set<string>();
    let delivered = 0, received = 0;
    for (const line of shipment.lines) {
      if (!record(line) || !text(line.boxId, 100) || !line.boxId.trim() || !id(line.purchaseOrderNumber) || !id(line.skuId)
        || !text(line.productName) || !text(line.barcode, 100) || !quantity(line.deliveredQuantity) || !quantity(line.receivedQuantity)) return invalid();
      const key = JSON.stringify([line.boxId, line.purchaseOrderNumber, line.skuId]);
      if (keys.has(key)) return invalid();
      keys.add(key); delivered += line.deliveredQuantity; received += line.receivedQuantity;
    }
    if (!Number.isSafeInteger(delivered) || !Number.isSafeInteger(received)
      || delivered !== shipment.totalDelivered || received !== shipment.totalReceived) return invalid();
  }
  const input = value as unknown as ShipmentReceiptImport;
  if (!unique(input.orders.map(o => o.purchaseOrderNumber)) || !unique(input.shipments.map(s => s.shipmentNumber))) return invalid();
  const referenced = new Set(input.orders.flatMap(o => o.shipmentNumbers));
  if (referenced.size !== input.shipments.length || input.shipments.some(s => !referenced.has(s.shipmentNumber))) return invalid();
  const byId = new Map(input.shipments.map(s => [s.shipmentNumber, s]));
  for (const order of input.orders) for (const number of order.shipmentNumbers) {
    const shipment = byId.get(number);
    if (!shipment || shipment.status === "마감" && !shipment.lines.some(line => line.purchaseOrderNumber === order.purchaseOrderNumber)) return invalid();
  }
  return structuredClone(input);
}

export function mergeShipmentReceiptImport(current: ShipmentReceiptOrders, raw: unknown): ShipmentReceiptOrders {
  const input = parseShipmentReceiptImport(raw);
  const next = structuredClone(current);
  const shipments = new Map(input.shipments.map(s => [s.shipmentNumber, s]));
  for (const order of input.orders) {
    const previous = current[order.purchaseOrderNumber];
    const fresh = { purchaseOrderNumber: order.purchaseOrderNumber, collectedAt: input.collectedAt,
      shipments: order.shipmentNumbers.map(number => shipments.get(number)!).sort((a, b) => a.shipmentNumber.localeCompare(b.shipmentNumber)) };
    if (previous && Date.parse(previous.collectedAt) > Date.parse(input.collectedAt)) throw new Error("더 최신의 쉽먼트 자료가 이미 저장돼 있습니다. 새로 수집해 주세요.");
    if (previous && previous.collectedAt === input.collectedAt && JSON.stringify(previous) !== JSON.stringify(fresh)) throw new Error("동일 시각의 수집 자료가 서로 다릅니다. 새로 수집해 주세요.");
    next[order.purchaseOrderNumber] = fresh;
  }
  return next;
}

export function summarizeShipmentReceipt(order: ShipmentReceiptOrder) {
  const pending = order.shipments.filter(s => s.status !== "마감");
  const complete = order.shipments.length > 0 && !pending.length;
  const receivedBySku: Record<string, number> = {};
  if (complete) for (const shipment of order.shipments) for (const line of shipment.lines) {
    if (line.purchaseOrderNumber !== order.purchaseOrderNumber) continue;
    const received = (receivedBySku[line.skuId] || 0) + line.receivedQuantity;
    if (!Number.isSafeInteger(received)) throw new Error("입고 수량의 합계 범위를 확인해 주세요.");
    receivedBySku[line.skuId] = received;
  }
  return { purchaseOrderNumber: order.purchaseOrderNumber, collectedAt: order.collectedAt, complete,
    shipmentCount: order.shipments.length, closedCount: order.shipments.length - pending.length,
    receivedBySku, pendingShipmentNumbers: pending.map(s => s.shipmentNumber) };
}
