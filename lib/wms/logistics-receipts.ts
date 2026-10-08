import type { InvoiceGroup } from "./invoice-group/types";
import type { ShipmentReceipt, ShipmentReceiptLine } from "./shipment-receipts";

export type LogisticsReceiptStatus = "마감" | "발송 완료" | "발송 가능";
export type LogisticsReceiptTargetSource = "dispatch" | "aside" | "hub";

/** 입고결과 확인 시작 기준(사용자 확정 2026-10-08): 이 날짜 이전 입고예정 쉽먼트는 다루지 않는다. */
export const LOGISTICS_RECEIPT_SINCE = "2026-09-13";
/** 이 값이 바뀌면 이전 입고결과 처리기록을 한 번 비우고 새로 시작한다. */
export const LOGISTICS_RECEIPT_EPOCH = "hub-closed-since-2026-09-13";

export interface LogisticsReceiptTarget {
  shipmentNumber: string;
  expectedDate: string;
  centerName: string;
  purchaseOrderNumbers: string[];
  source: LogisticsReceiptTargetSource;
}

export interface LogisticsReceiptImport {
  source: "supplier-hub-shipments";
  schemaVersion: 2 | 3;
  collectedAt: string;
  requestedShipmentNumbers: string[];
  shipments: ShipmentReceipt[];
  /** v3 exact Supplier Hub supply-state lookup for every SKU in a closed shipment. */
  skuStatuses?: LogisticsReceiptSkuStatus[];
  /** "hub-closed": Supplier Hub 목록 전체에서 기준일 이후 마감 쉽먼트를 직접 찾은 수집. */
  mode?: "hub-closed";
  since?: string;
  /** 쿠팡 조회가 안 돼 제품DB 발주가능상태로 채운 SKU. */
  skuStatusesFromProductDb?: string[];
  /** 제품DB로 채우기를 시도한 시각(같은 수집에 대해 한 번만). */
  productDbStatusFillAt?: string;
  /** Receipt-target identity captured with the collection so closed history survives later group cleanup. */
  shipmentMetadata?: Record<string, Pick<LogisticsReceiptTarget, "expectedDate" | "centerName">>;
}

/** 쿠팡이 준 공급상태 그대로. "정상"만 분류 대상이고 그 외(불가·일시중단·조회안됨 등)는 검토로 둔다. */
export type LogisticsReceiptSkuOrderStatus = string;
export interface LogisticsReceiptSkuStatus { skuId: string; orderStatus: LogisticsReceiptSkuOrderStatus; }

/** Latest complete collection. It is deliberately separate from the v1 PO snapshots. */
export type LogisticsReceiptSnapshot = LogisticsReceiptImport;

export interface LogisticsReceiptHandledLine {
  shipmentNumber: string;
  purchaseOrderNumber: string;
  skuId: string;
  quantity: number;
  classification: string;
  note: string;
}

export interface LogisticsAsideBaseline {
  closedShipmentNumbers: string[];
  pendingTargets: LogisticsReceiptTarget[];
  completedMarketingSkuIds: string[];
  excludedMarketingSkuIds: string[];
  handledLines: LogisticsReceiptHandledLine[];
  source: unknown;
}

export interface LogisticsReceiptRoute {
  decision: "vendor" | "discontinue" | "reorder" | "marketing";
  runId: string;
  at: string;
  completed: boolean;
  quantity: number;
  sourceFingerprint: string;
  note?: string;
}

export interface LogisticsReceiptBoardLine {
  lineKey: string;
  /** Original Supplier Hub box-row identity, shared by a shortage and marketing candidate. */
  sourceLineKey: string;
  shipmentNumber: string;
  boxId: string;
  purchaseOrderNumber: string;
  skuId: string;
  productName: string;
  barcode: string;
  deliveredQuantity: number | null;
  receivedQuantity: number | null;
  shortageQuantity: number | null;
  handledQuantity: number;
  remainingQuantity: number | null;
  kind: "shortage" | "marketing";
  state: "ready" | "review" | "pending" | "unknown" | "routed";
  firstArrivalCandidate: boolean;
  reviewReason?: string;
  /** Queue connection metadata. `completed` means the connection succeeded, not external work completion. */
  route?: LogisticsReceiptRoute;
  target: LogisticsReceiptTarget;
}

export interface LogisticsReceiptBoard {
  collectedAt?: string;
  targets: LogisticsReceiptTarget[];
  lines: LogisticsReceiptBoardLine[];
  warnings: string[];
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const shipmentId = (value: unknown): value is string => typeof value === "string" && /^\d{8}$/.test(value);
const businessId = (value: unknown): value is string => typeof value === "string" && /^\d{1,20}$/.test(value);
const text = (value: unknown, max = 500): value is string => typeof value === "string" && value.length <= max;
const quantity = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const distinct = (values: string[]) => new Set(values).size === values.length;
const supportedStatuses = new Set<LogisticsReceiptStatus>(["마감", "발송 완료", "발송 가능"]);

export const logisticsReceiptLineKey = (shipmentNumber: string, boxId: string, purchaseOrderNumber: string, skuId: string) =>
  JSON.stringify([shipmentNumber, boxId, purchaseOrderNumber, skuId]);

/** Canonical evidence fingerprint, intentionally plain data rather than a security hash. */
export const logisticsReceiptSourceFingerprint = (line: Pick<LogisticsReceiptBoardLine,
  "lineKey" | "deliveredQuantity" | "receivedQuantity" | "handledQuantity" | "remainingQuantity">) =>
  JSON.stringify([line.lineKey, line.deliveredQuantity, line.receivedQuantity, line.handledQuantity, line.remainingQuantity]);

function invalid(): never {
  throw new Error("쉽먼트 수집 자료가 대상·상태·수량 조건과 맞지 않습니다. 전체 목록을 다시 수집해 주세요.");
}

function sameSet(left: string[], right: string[]) {
  return left.length === right.length && left.every(value => right.includes(value));
}

function validateTarget(target: unknown): asserts target is LogisticsReceiptTarget {
  if (!record(target) || !shipmentId(target.shipmentNumber) || !text(target.expectedDate, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(target.expectedDate)
    || !text(target.centerName) || !target.centerName.trim() || !Array.isArray(target.purchaseOrderNumbers)
    || (target.source === "dispatch" && target.purchaseOrderNumbers.length === 0)
    || !target.purchaseOrderNumbers.every(businessId) || !distinct(target.purchaseOrderNumbers)
    || (target.source !== "dispatch" && target.source !== "aside" && target.source !== "hub")) invalid();
}

/** Creates a stable, de-duplicated target list from only phase-1 dispatched groups. */
export function collectDispatchReceiptTargets(groups: InvoiceGroup[]): LogisticsReceiptTarget[] {
  const targets = new Map<string, LogisticsReceiptTarget>();
  for (const group of groups) {
    if (group.stage !== "dispatched" || group.supersededByGroupId) continue;
    for (const shipmentNumber of group.shipmentNumbers) {
      if (!shipmentId(shipmentNumber)) throw new Error("출고완료 묶음의 쉽먼트번호 형식을 확인해 주세요.");
      const target: LogisticsReceiptTarget = {
        shipmentNumber,
        expectedDate: group.expectedDate,
        centerName: group.fulfillmentCenter,
        purchaseOrderNumbers: [...new Set(group.purchaseOrderNumbers)].sort(),
        source: "dispatch",
      };
      const existing = targets.get(shipmentNumber);
      if (existing) {
        if (existing.expectedDate !== target.expectedDate || existing.centerName !== target.centerName) {
          throw new Error("같은 쉽먼트번호의 입고예정일 또는 센터가 서로 다릅니다.");
        }
        existing.purchaseOrderNumbers = [...new Set([...existing.purchaseOrderNumbers, ...target.purchaseOrderNumbers])].sort();
      } else {
        targets.set(shipmentNumber, target);
      }
    }
  }
  return [...targets.values()].sort((a, b) => a.shipmentNumber.localeCompare(b.shipmentNumber));
}

export function mergeLogisticsReceiptTargets(dispatchTargets: LogisticsReceiptTarget[], asideTargets: LogisticsReceiptTarget[]): LogisticsReceiptTarget[] {
  const merged = new Map<string, LogisticsReceiptTarget>();
  for (const target of [...dispatchTargets, ...asideTargets]) {
    validateTarget(target);
    const normalized = { ...target, purchaseOrderNumbers: [...target.purchaseOrderNumbers].sort() };
    const existing = merged.get(normalized.shipmentNumber);
    if (existing && existing.source !== normalized.source) {
      if (existing.expectedDate !== normalized.expectedDate || existing.centerName !== normalized.centerName) {
        throw new Error("같은 쉽먼트번호의 입고예정일 또는 센터가 서로 다릅니다.");
      }
      if (normalized.source === "dispatch") merged.set(normalized.shipmentNumber, normalized);
      continue;
    }
    if (existing && JSON.stringify(existing) !== JSON.stringify(normalized)) {
      throw new Error("같은 쉽먼트번호의 발주 정보가 서로 다릅니다.");
    }
    merged.set(normalized.shipmentNumber, normalized);
  }
  return [...merged.values()].sort((a, b) => a.shipmentNumber.localeCompare(b.shipmentNumber));
}

function validateShipment(shipment: unknown, target: LogisticsReceiptTarget) {
  if (!record(shipment) || !shipmentId(shipment.shipmentNumber) || shipment.shipmentNumber !== target.shipmentNumber
    || !text(shipment.status, 40) || !supportedStatuses.has(shipment.status as LogisticsReceiptStatus)
    || !Array.isArray(shipment.lines) || shipment.lines.length > 10_000) invalid();
  if (shipment.status !== "마감") {
    if (shipment.lines.length || shipment.totalDelivered !== null || shipment.totalReceived !== null) invalid();
    return;
  }
  if (!shipment.lines.length || !quantity(shipment.totalDelivered) || !quantity(shipment.totalReceived)) invalid();
  const keys = new Set<string>();
  let delivered = 0;
  let received = 0;
  for (const line of shipment.lines) {
    if (!record(line) || !text(line.boxId, 100) || !line.boxId.trim() || !businessId(line.purchaseOrderNumber) || !businessId(line.skuId)
      || !text(line.productName) || !text(line.barcode, 100) || !quantity(line.deliveredQuantity) || !quantity(line.receivedQuantity)
      || (target.source === "dispatch" && !target.purchaseOrderNumbers.includes(line.purchaseOrderNumber))) invalid();
    const key = logisticsReceiptLineKey(shipment.shipmentNumber, line.boxId, line.purchaseOrderNumber, line.skuId);
    if (keys.has(key)) invalid();
    keys.add(key);
    delivered += line.deliveredQuantity;
    received += line.receivedQuantity;
  }
  if (!Number.isSafeInteger(delivered) || !Number.isSafeInteger(received)
    || delivered !== shipment.totalDelivered || received !== shipment.totalReceived) invalid();
  if (target.source === "dispatch" && !sameSet(
    [...new Set(shipment.lines.map(line => line.purchaseOrderNumber))].sort(),
    [...target.purchaseOrderNumbers].sort(),
  )) invalid();
}

/** Validates a complete, shipment-targeted collection before it may enter the weekly blob. */
function parseImport(value: unknown, targets: LogisticsReceiptTarget[], requireExactTargetSet: boolean): LogisticsReceiptImport {
  if (!Array.isArray(targets) || !targets.length || targets.length > 5_000) invalid();
  const targetIds = targets.map(target => target.shipmentNumber);
  if (!distinct(targetIds)) invalid();
  targets.forEach(validateTarget);
  if (!record(value) || value.source !== "supplier-hub-shipments" || (value.schemaVersion !== 2 && value.schemaVersion !== 3)
    || !text(value.collectedAt, 40) || !/^\d{4}-\d{2}-\d{2}T/.test(value.collectedAt)
    || !Number.isFinite(Date.parse(value.collectedAt)) || Date.parse(value.collectedAt) > Date.now() + 300_000
    || !Array.isArray(value.requestedShipmentNumbers) || !Array.isArray(value.shipments)
    || value.requestedShipmentNumbers.length > 5_000 || value.shipments.length > 5_000
    || !value.requestedShipmentNumbers.every(shipmentId) || !distinct(value.requestedShipmentNumbers)) invalid();
  if ((requireExactTargetSet && !sameSet([...value.requestedShipmentNumbers].sort(), [...targetIds].sort()))
    || (!requireExactTargetSet && !value.requestedShipmentNumbers.every(number => targetIds.includes(number)))
    || (requireExactTargetSet && value.shipments.length !== targetIds.length)) invalid();
  const shipmentIds = value.shipments.map(shipment => record(shipment) ? shipment.shipmentNumber : "");
  if (!shipmentIds.every(shipmentId) || !distinct(shipmentIds)
    || (requireExactTargetSet && !sameSet([...shipmentIds].sort(), [...targetIds].sort()))
    || (!requireExactTargetSet && !sameSet([...shipmentIds].sort(), [...value.requestedShipmentNumbers].sort()))) invalid();
  const targetByShipment = new Map(targets.map(target => [target.shipmentNumber, target]));
  value.shipments.forEach(shipment => validateShipment(shipment, targetByShipment.get((shipment as ShipmentReceipt).shipmentNumber)!));
  const closedSkuIds = [...new Set(value.shipments.filter((shipment): shipment is ShipmentReceipt => record(shipment) && shipment.status === "마감").flatMap(shipment => shipment.lines.map(line => line.skuId)))].sort();
  if (value.schemaVersion === 3) {
    if (!Array.isArray(value.skuStatuses) || value.skuStatuses.length !== closedSkuIds.length) invalid();
    const statuses = value.skuStatuses as unknown[];
    const statusSkuIds = statuses.map(status => record(status) && businessId(status.skuId) ? status.skuId : "");
    if (!statuses.every(status => record(status) && businessId(status.skuId) && typeof status.orderStatus === "string" && status.orderStatus.trim().length > 0 && status.orderStatus.length <= 20)
      || !distinct(statusSkuIds) || !sameSet([...statusSkuIds].sort(), closedSkuIds)) invalid();
  } else if (requireExactTargetSet) invalid();
  return structuredClone(value as unknown as LogisticsReceiptImport);
}

/** Validates an incoming full collection. Its requested and returned sets must exactly equal current targets. */
export function parseLogisticsReceiptImport(value: unknown, targets: LogisticsReceiptTarget[]): LogisticsReceiptImport {
  return parseImport(value, targets, true);
}

/** Validates a saved collection without making a newly-dispatched target unreadable. */
function parseStoredLogisticsReceiptSnapshot(value: unknown, targets: LogisticsReceiptTarget[]): LogisticsReceiptSnapshot {
  return parseImport(value, targets, false);
}

export function mergeLogisticsReceiptSnapshot(current: LogisticsReceiptSnapshot | undefined, raw: unknown, targets: LogisticsReceiptTarget[]): LogisticsReceiptSnapshot {
  const incoming = parseLogisticsReceiptImport(raw, targets);
  const withMetadata = (snapshot: LogisticsReceiptSnapshot): LogisticsReceiptSnapshot => {
    const targetByShipment = new Map(targets.map(target => [target.shipmentNumber, target]));
    const shipmentMetadata: NonNullable<LogisticsReceiptSnapshot["shipmentMetadata"]> = {};
    for (const shipment of snapshot.shipments) {
      const target = targetByShipment.get(shipment.shipmentNumber);
      if (target) shipmentMetadata[shipment.shipmentNumber] = { expectedDate: target.expectedDate, centerName: target.centerName };
    }
    return { ...snapshot, shipmentMetadata };
  };
  const incomingWithMetadata = withMetadata(incoming);
  if (!current) return incomingWithMetadata;
  const previous = parseStoredLogisticsReceiptSnapshot(current, targets);
  const previousAt = Date.parse(previous.collectedAt);
  const incomingAt = Date.parse(incoming.collectedAt);
  if (incomingAt < previousAt) throw new Error("더 최신의 쉽먼트 수집 자료가 이미 저장돼 있습니다. 새로 수집해 주세요.");
  if (incomingAt === previousAt && JSON.stringify(previous) !== JSON.stringify(incomingWithMetadata)) {
    throw new Error("동일 시각의 쉽먼트 수집 자료가 서로 다릅니다. 새로 수집해 주세요.");
  }
  return incomingWithMetadata;
}

export function buildLogisticsReceiptBoard(input: {
  targets: LogisticsReceiptTarget[];
  snapshot?: LogisticsReceiptSnapshot;
  baseline: LogisticsAsideBaseline;
  routes?: Record<string, LogisticsReceiptRoute>;
  /** Persisted operator exclusions are line-specific; a later shipment of the same SKU stays reviewable. */
  excludedMarketingLineKeys?: readonly string[];
}): LogisticsReceiptBoard {
  const targets = mergeLogisticsReceiptTargets(input.targets.filter(target => target.source === "dispatch"), input.targets.filter(target => target.source !== "dispatch"));
  const warnings: string[] = [];
  const snapshot = input.snapshot ? parseStoredLogisticsReceiptSnapshot(input.snapshot, targets) : undefined;
  const receiptByShipment = new Map(snapshot?.shipments.map(shipment => [shipment.shipmentNumber, shipment]) || []);
  const statusBySku = new Map(snapshot?.schemaVersion === 3 ? snapshot.skuStatuses?.map(status => [status.skuId, status.orderStatus]) : []);
  const needsStatusRefresh = Boolean(snapshot && snapshot.schemaVersion !== 3);
  const completedMarketing = new Set(input.baseline.completedMarketingSkuIds);
  const excludedMarketing = new Set(input.baseline.excludedMarketingSkuIds);
  const excludedMarketingLines = new Set(input.excludedMarketingLineKeys || []);
  const handledByShipmentPoSku = new Map<string, number>();
  const handledLabels = new Map<string, string>();
  for (const handled of input.baseline.handledLines) {
    if (!shipmentId(handled.shipmentNumber) || !businessId(handled.purchaseOrderNumber) || !businessId(handled.skuId) || !quantity(handled.quantity)) {
      throw new Error("기준 처리자료의 쉽먼트·발주·SKU·수량 형식을 확인해 주세요.");
    }
    const key = JSON.stringify([handled.shipmentNumber, handled.purchaseOrderNumber, handled.skuId]);
    handledByShipmentPoSku.set(key, (handledByShipmentPoSku.get(key) || 0) + handled.quantity);
    handledLabels.set(key, `${handled.shipmentNumber} · PO ${handled.purchaseOrderNumber} · SKU ${handled.skuId}`);
  }
  const closedHandledKeys = new Set<string>();

  const lines: LogisticsReceiptBoardLine[] = [];
  let unavailableSkuCount = 0;
  for (const target of targets) {
    const shipment = receiptByShipment.get(target.shipmentNumber);
    if (!shipment) {
      lines.push({ lineKey: JSON.stringify([target.shipmentNumber]), sourceLineKey: JSON.stringify([target.shipmentNumber]), shipmentNumber: target.shipmentNumber, boxId: "", purchaseOrderNumber: "", skuId: "", productName: "", barcode: "",
        deliveredQuantity: null, receivedQuantity: null, shortageQuantity: null, handledQuantity: 0, remainingQuantity: null, kind: "shortage", state: "unknown", firstArrivalCandidate: false,
        reviewReason: "수집 자료에 이 쉽먼트가 없습니다.", target });
      continue;
    }
    if (shipment.status !== "마감") {
      lines.push({ lineKey: JSON.stringify([target.shipmentNumber]), sourceLineKey: JSON.stringify([target.shipmentNumber]), shipmentNumber: target.shipmentNumber, boxId: "", purchaseOrderNumber: "", skuId: "", productName: "", barcode: "",
        deliveredQuantity: null, receivedQuantity: null, shortageQuantity: null, handledQuantity: 0, remainingQuantity: null, kind: "shortage", state: "pending", firstArrivalCandidate: false,
        reviewReason: `${shipment.status} 상태라 마감 수량을 계산하지 않습니다.`, target });
      continue;
    }
    const zeroReceived = shipment.totalReceived === 0;
    for (const line of [...shipment.lines].sort((a, b) => logisticsReceiptLineKey(shipment.shipmentNumber, a.boxId, a.purchaseOrderNumber, a.skuId).localeCompare(logisticsReceiptLineKey(shipment.shipmentNumber, b.boxId, b.purchaseOrderNumber, b.skuId)))) {
      const shortage = Math.max(0, line.deliveredQuantity - line.receivedQuantity);
      const marker = JSON.stringify([shipment.shipmentNumber, line.purchaseOrderNumber, line.skuId]);
      const remainingHandled = handledByShipmentPoSku.get(marker) || 0;
      closedHandledKeys.add(marker);
      const handledQuantity = Math.min(shortage, remainingHandled);
      handledByShipmentPoSku.set(marker, Math.max(0, remainingHandled - handledQuantity));
      const remaining = shortage - handledQuantity;
      const sourceLineKey = logisticsReceiptLineKey(shipment.shipmentNumber, line.boxId, line.purchaseOrderNumber, line.skuId);
      const route = input.routes?.[sourceLineKey];
      const orderStatus = statusBySku.get(line.skuId);
      const statusBlocked = needsStatusRefresh || orderStatus !== "정상";
      if (orderStatus && orderStatus !== "정상") unavailableSkuCount++;
      if (remaining > 0 || route?.completed) {
        const boardLine: LogisticsReceiptBoardLine = { lineKey: sourceLineKey, sourceLineKey, shipmentNumber: shipment.shipmentNumber,
        boxId: line.boxId, purchaseOrderNumber: line.purchaseOrderNumber, skuId: line.skuId, productName: line.productName, barcode: line.barcode,
        deliveredQuantity: line.deliveredQuantity, receivedQuantity: line.receivedQuantity, shortageQuantity: shortage, handledQuantity, remainingQuantity: remaining,
        kind: "shortage", state: route?.completed ? "routed" : statusBlocked || zeroReceived ? "review" : "ready",
        firstArrivalCandidate: false, reviewReason: route?.completed ? "후속 처리 중" : needsStatusRefresh ? "공급상태가 없는 이전 수집자료입니다. 전체를 다시 수집해 주세요." : orderStatus !== "정상" ? `공급상태 ${orderStatus || "미확인"} SKU는 분류하지 않습니다.` : zeroReceived ? "마감 기록의 입고 수량이 0건입니다. 확인이 필요합니다." : undefined, route, target };
        if (route?.completed && route.sourceFingerprint !== logisticsReceiptSourceFingerprint(boardLine)) {
          boardLine.state = "review";
          boardLine.reviewReason = "분류 이후 수량 변경·후속 업무 확인 필요";
        }
        lines.push(boardLine);
      }
    }
  }
  const receivedBySku = new Map<string, number>();
  for (const shipment of snapshot?.shipments || []) if (shipment.status === "마감") for (const line of shipment.lines) {
    receivedBySku.set(line.skuId, (receivedBySku.get(line.skuId) || 0) + line.receivedQuantity);
  }
  for (const target of targets) {
    const shipment = receiptByShipment.get(target.shipmentNumber);
    if (!shipment || shipment.status !== "마감") continue;
    for (const line of shipment.lines) {
      const sourceLineKey = logisticsReceiptLineKey(shipment.shipmentNumber, line.boxId, line.purchaseOrderNumber, line.skuId);
      const lineKey = `marketing::${sourceLineKey}`;
      const isCandidate = !needsStatusRefresh && statusBySku.get(line.skuId) === "정상" && line.receivedQuantity > 0 && receivedBySku.get(line.skuId) === 1
        && !completedMarketing.has(line.skuId) && !excludedMarketing.has(line.skuId);
      if (!isCandidate || excludedMarketingLines.has(lineKey)) continue;
      const route = input.routes?.[lineKey];
      const boardLine: LogisticsReceiptBoardLine = { lineKey, sourceLineKey, shipmentNumber: shipment.shipmentNumber, boxId: line.boxId, purchaseOrderNumber: line.purchaseOrderNumber,
        skuId: line.skuId, productName: line.productName, barcode: line.barcode, deliveredQuantity: line.deliveredQuantity, receivedQuantity: line.receivedQuantity,
        shortageQuantity: null, handledQuantity: 0, remainingQuantity: null, kind: "marketing", state: route?.completed ? "routed" : "ready",
        firstArrivalCandidate: true, reviewReason: route?.completed ? "후속 처리 중" : "초도 입고 후보입니다. 실제 최초 입고 여부는 확인하지 않았습니다.", route, target };
      if (route?.completed && route.sourceFingerprint !== logisticsReceiptSourceFingerprint(boardLine)) {
        boardLine.state = "review";
        boardLine.reviewReason = "분류 이후 수량 변경·후속 업무 확인 필요";
      }
      lines.push(boardLine);
    }
  }
  for (const [key, remaining] of handledByShipmentPoSku) {
    if (remaining > 0 && closedHandledKeys.has(key)) warnings.push(`기준 처리수량이 확인된 미납수량보다 큽니다: ${handledLabels.get(key)}`);
  }
  if (needsStatusRefresh) warnings.push("이전 수집자료에는 공급상태가 없습니다. 전체 쉽먼트를 다시 수집해 주세요.");
  if (unavailableSkuCount) warnings.push(`공급상태가 정상이 아닌 SKU ${unavailableSkuCount}건(불가·일시중단·조회안됨)은 미납·쿠폰광고 분류에서 뺐습니다.`);
  return { collectedAt: snapshot?.collectedAt, targets, lines, warnings };
}

/** 저장된 쿠팡 목록 수집에서 다시 만든 대상. 사이트 출고기록·예전 Aside 대기목록은 더 이상 쓰지 않는다. */
export function logisticsTargetsFromSnapshot(snapshot: LogisticsReceiptSnapshot | undefined): LogisticsReceiptTarget[] {
  if (!snapshot || snapshot.mode !== "hub-closed" || !snapshot.shipmentMetadata) return [];
  return snapshot.shipments.map(shipment => {
    const meta = snapshot.shipmentMetadata?.[shipment.shipmentNumber];
    return { shipmentNumber: shipment.shipmentNumber, expectedDate: meta?.expectedDate || "", centerName: meta?.centerName || "",
      purchaseOrderNumbers: [...new Set(shipment.lines.map(line => line.purchaseOrderNumber))].sort(), source: "hub" as const };
  }).filter(target => target.expectedDate >= LOGISTICS_RECEIPT_SINCE).sort((a, b) => a.shipmentNumber.localeCompare(b.shipmentNumber));
}

/** 쿠팡 목록 전체 수집 저장. 기준일 이후 입고예정 + 마감 쉽먼트만 받고, 대상 목록은 수집 자료 자체가 정한다. */
export function mergeHubClosedSnapshot(current: LogisticsReceiptSnapshot | undefined, raw: unknown): LogisticsReceiptSnapshot {
  if (!record(raw) || raw.mode !== "hub-closed" || raw.since !== LOGISTICS_RECEIPT_SINCE || !record(raw.shipmentMetadata) || !Array.isArray(raw.shipments)) {
    throw new Error("확장프로그램을 최신 버전(0.9.8)으로 새로고침한 뒤 다시 가져와 주세요.");
  }
  if (!raw.shipments.length) throw new Error(`${LOGISTICS_RECEIPT_SINCE} 이후 입고예정인 마감 쉽먼트가 없습니다.`);
  const metadata = raw.shipmentMetadata as Record<string, unknown>;
  const targets: LogisticsReceiptTarget[] = raw.shipments.map(shipment => {
    if (!record(shipment) || shipment.status !== "마감" || !Array.isArray(shipment.lines)) invalid();
    const meta = metadata[String(shipment.shipmentNumber)];
    if (!record(meta) || typeof meta.expectedDate !== "string" || meta.expectedDate < LOGISTICS_RECEIPT_SINCE) invalid();
    return { shipmentNumber: String(shipment.shipmentNumber), expectedDate: meta.expectedDate, centerName: String(meta.centerName || ""),
      purchaseOrderNumbers: [...new Set((shipment.lines as Array<{ purchaseOrderNumber?: unknown }>).map(line => String(line?.purchaseOrderNumber)))].sort(), source: "hub" as const };
  });
  const incoming = parseLogisticsReceiptImport(raw, targets);
  if (current?.collectedAt && current.mode === "hub-closed" && Date.parse(incoming.collectedAt) < Date.parse(current.collectedAt)) {
    throw new Error("더 최신의 쉽먼트 수집 자료가 이미 저장돼 있습니다. 새로 수집해 주세요.");
  }
  const shipmentMetadata: NonNullable<LogisticsReceiptSnapshot["shipmentMetadata"]> = {};
  for (const target of targets) shipmentMetadata[target.shipmentNumber] = { expectedDate: target.expectedDate, centerName: target.centerName };
  const merged: LogisticsReceiptSnapshot = { ...incoming, mode: "hub-closed", since: LOGISTICS_RECEIPT_SINCE, shipmentMetadata };
  // 마감 쉽먼트는 다시 바뀌지 않는다: 이전에 가져온 마감건이 이번 쿠팡 목록에서 빠졌으면 그대로 남긴다.
  if (current?.mode === "hub-closed") {
    const incomingIds = new Set(merged.shipments.map(shipment => shipment.shipmentNumber));
    const statusIds = new Set((merged.skuStatuses || []).map(status => status.skuId));
    const previousStatus = new Map((current.skuStatuses || []).map(status => [status.skuId, status]));
    const fromProductDb = new Set(current.skuStatusesFromProductDb || []);
    const carriedFromProductDb: string[] = [];
    for (const shipment of current.shipments) {
      const meta = current.shipmentMetadata?.[shipment.shipmentNumber];
      if (incomingIds.has(shipment.shipmentNumber) || shipment.status !== "마감" || !meta || meta.expectedDate < LOGISTICS_RECEIPT_SINCE) continue;
      merged.shipments.push(structuredClone(shipment));
      merged.requestedShipmentNumbers.push(shipment.shipmentNumber);
      merged.shipmentMetadata![shipment.shipmentNumber] = { ...meta };
      for (const line of shipment.lines) {
        if (statusIds.has(line.skuId)) continue;
        const status = previousStatus.get(line.skuId);
        merged.skuStatuses!.push(status ? { ...status } : { skuId: line.skuId, orderStatus: "조회안됨" });
        statusIds.add(line.skuId);
        if (fromProductDb.has(line.skuId)) carriedFromProductDb.push(line.skuId);
      }
    }
    merged.skuStatuses!.sort((a, b) => a.skuId.localeCompare(b.skuId));
    if (carriedFromProductDb.length) merged.skuStatusesFromProductDb = carriedFromProductDb.sort();
  }
  return merged;
}

const knownSkuStatuses = new Set(["정상", "불가", "일시중단"]);
/** 쿠팡 공급상태 조회가 안 된 SKU만 제품DB 발주가능상태(정상·불가·일시중단)로 채운다. 쿠팡이 준 값은 덮어쓰지 않는다. */
export function fillSkuStatusesFromProductDb(snapshot: LogisticsReceiptSnapshot, productDbStatusBySku: ReadonlyMap<string, string>, at: string): number {
  const fromProductDb = new Set(snapshot.skuStatusesFromProductDb || []);
  let filled = 0;
  for (const status of snapshot.skuStatuses || []) {
    if (knownSkuStatuses.has(status.orderStatus)) continue;
    const productDb = (productDbStatusBySku.get(status.skuId) || "").trim();
    if (!knownSkuStatuses.has(productDb)) continue;
    status.orderStatus = productDb; fromProductDb.add(status.skuId); filled++;
  }
  snapshot.skuStatusesFromProductDb = [...fromProductDb].sort();
  snapshot.productDbStatusFillAt = at;
  return filled;
}
export const needsProductDbStatusFill = (snapshot: LogisticsReceiptSnapshot | undefined) =>
  Boolean(snapshot && !snapshot.productDbStatusFillAt && snapshot.skuStatuses?.some(status => !knownSkuStatuses.has(status.orderStatus)));
