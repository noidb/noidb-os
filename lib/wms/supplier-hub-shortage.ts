import { normalizeSkuId } from "./sku-normalize";
import type { SupplierHubInboundEvent, SupplierHubOrderStatus } from "./picking-wave/shared-store-types";

const clean = (value: unknown) => String(value ?? "").trim();
const pairKey = (orderNo: string, skuId: string) => JSON.stringify([orderNo, skuId]);
const eventKey = (event: SupplierHubInboundEvent) => JSON.stringify([
  clean(event.orderNo), clean(event.skuId), clean(event.inboundDate), clean(event.quantity), clean(event.division),
]);
const quantity = (value: unknown): number | null => {
  const raw = clean(value).replace(/,/g, "");
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

export interface SupplierHubShortagePair {
  orderNo: string;
  skuId: string;
  skuName: string;
  confirmedQuantity: number;
  receivedQuantity: number;
  shortageQuantity: number;
}

export interface SupplierHubUnresolvedPair {
  orderNo: string;
  skuId: string;
  skuName: string;
  issue: string;
}

export interface SupplierHubShortageCalculation {
  statusCount: number;
  excludedPurchaseTypeCount: number;
  exactSettledCount: number;
  inboundEventCount: number;
  uniqueInboundEventCount: number;
  duplicateInboundEventCount: number;
  shortagePairs: SupplierHubShortagePair[];
  unresolvedPairs: SupplierHubUnresolvedPair[];
  missingSourceOrderNumbers: string[];
  noInboundEventOrderNumbers: string[];
}

interface PurchaseCandidate {
  orderNo: string;
  skuId: string;
  skuName: string;
  confirmedQuantity: number | null;
  sourceIssue: string;
}

/** Strict Supplier Hub reconciliation. No stock, status, expected-date, or review heuristics. */
export function calculateSupplierHubShortages(input: {
  statuses: SupplierHubOrderStatus[];
  events: SupplierHubInboundEvent[];
  purchaseRows: string[][];
}): SupplierHubShortageCalculation {
  const eligibleOrders = new Set(input.statuses
    .filter(status => status.purchaseType !== "매입용" && status.settlementStatus === "정산완료")
    .map(status => clean(status.orderNo)).filter(Boolean));
  const excludedPurchaseTypeCount = input.statuses.filter(status => status.purchaseType === "매입용").length;

  const uniqueEvents = new Map<string, SupplierHubInboundEvent>();
  for (const event of input.events) {
    const key = eventKey(event);
    if (!uniqueEvents.has(key)) uniqueEvents.set(key, event);
  }
  const receivedByPair = new Map<string, number>();
  const skuNameByPair = new Map<string, string>();
  const invalidEventPairs = new Set<string>();
  const eventOrders = new Set<string>();
  for (const event of uniqueEvents.values()) {
    const orderNo = clean(event.orderNo);
    const skuId = normalizeSkuId(event.skuId);
    if (!orderNo || !skuId || !eligibleOrders.has(orderNo)) continue;
    eventOrders.add(orderNo);
    const key = pairKey(orderNo, skuId);
    const parsed = quantity(event.quantity);
    if (parsed === null) {
      invalidEventPairs.add(key);
      continue;
    }
    receivedByPair.set(key, (receivedByPair.get(key) || 0) + parsed);
    if (!skuNameByPair.has(key) && clean(event.skuName)) skuNameByPair.set(key, clean(event.skuName));
  }

  const candidatesByPair = new Map<string, PurchaseCandidate[]>();
  const sourceOrders = new Set<string>();
  const headers = input.purchaseRows[0] || [];
  const orderIndex = headers.indexOf("발주번호");
  const skuIndex = headers.indexOf("SKU ID");
  const nameIndex = headers.indexOf("상품명");
  const confirmedIndex = headers.indexOf("확정수량");
  const sourceIssueIndex = headers.indexOf("_주간원문검증오류");
  for (const row of input.purchaseRows.slice(1)) {
    const orderNo = clean(row[orderIndex]);
    const skuId = normalizeSkuId(row[skuIndex]);
    if (!orderNo || !skuId || !eligibleOrders.has(orderNo)) continue;
    sourceOrders.add(orderNo);
    const key = pairKey(orderNo, skuId);
    candidatesByPair.set(key, [...(candidatesByPair.get(key) || []), {
      orderNo, skuId, skuName: clean(row[nameIndex]), confirmedQuantity: quantity(row[confirmedIndex]), sourceIssue: clean(row[sourceIssueIndex]),
    }]);
  }

  const unresolvedPairs: SupplierHubUnresolvedPair[] = [];
  const shortagePairs: SupplierHubShortagePair[] = [];
  for (const [key, candidates] of candidatesByPair) {
    const candidate = candidates[0];
    const skuName = candidate.skuName || skuNameByPair.get(key) || "";
    if (!eventOrders.has(candidate.orderNo)) {
      unresolvedPairs.push({ orderNo: candidate.orderNo, skuId: candidate.skuId, skuName, issue: "입고데이터가 발주서 전체에서 확인되지 않아 검토가 필요합니다." });
      continue;
    }
    if (candidates.length !== 1) {
      unresolvedPairs.push({ orderNo: candidate.orderNo, skuId: candidate.skuId, skuName, issue: "확정 발주수량 원본이 중복되어 계산할 수 없습니다." });
      continue;
    }
    if (candidate.confirmedQuantity === null) {
      unresolvedPairs.push({ orderNo: candidate.orderNo, skuId: candidate.skuId, skuName, issue: "확정 발주수량 원본이 없거나 정수가 아니어서 계산할 수 없습니다." });
      continue;
    }
    if (/확정수량|발주서 원문이 없어|발주서 원문.*확인할 수 없/.test(candidate.sourceIssue)) {
      unresolvedPairs.push({ orderNo: candidate.orderNo, skuId: candidate.skuId, skuName, issue: `확정 발주수량 원본 검증 오류: ${candidate.sourceIssue}` });
      continue;
    }
    if (invalidEventPairs.has(key)) {
      unresolvedPairs.push({ orderNo: candidate.orderNo, skuId: candidate.skuId, skuName, issue: "입고상세 수량이 올바른 정수가 아니어서 계산할 수 없습니다." });
      continue;
    }
    const receivedQuantity = receivedByPair.get(key) || 0;
    const shortageQuantity = Math.max(candidate.confirmedQuantity - receivedQuantity, 0);
    if (shortageQuantity > 0) shortagePairs.push({ orderNo: candidate.orderNo, skuId: candidate.skuId, skuName,
      confirmedQuantity: candidate.confirmedQuantity, receivedQuantity, shortageQuantity });
  }

  for (const key of receivedByPair.keys()) {
    if (candidatesByPair.has(key)) continue;
    const [orderNo, skuId] = JSON.parse(key) as [string, string];
    unresolvedPairs.push({ orderNo, skuId, skuName: skuNameByPair.get(key) || "", issue: "확정 발주수량 원본이 없어 계산할 수 없습니다." });
  }

  const noInboundEventOrderNumbers = [...eligibleOrders].filter(orderNo => !eventOrders.has(orderNo)).sort();
  return {
    statusCount: input.statuses.length,
    excludedPurchaseTypeCount,
    exactSettledCount: eligibleOrders.size,
    inboundEventCount: input.events.length,
    uniqueInboundEventCount: uniqueEvents.size,
    duplicateInboundEventCount: input.events.length - uniqueEvents.size,
    shortagePairs: shortagePairs.sort((a, b) => pairKey(a.orderNo, a.skuId).localeCompare(pairKey(b.orderNo, b.skuId))),
    unresolvedPairs: unresolvedPairs.sort((a, b) => pairKey(a.orderNo, a.skuId).localeCompare(pairKey(b.orderNo, b.skuId))),
    missingSourceOrderNumbers: [...eligibleOrders].filter(orderNo => !sourceOrders.has(orderNo)).sort(),
    noInboundEventOrderNumbers,
  };
}
