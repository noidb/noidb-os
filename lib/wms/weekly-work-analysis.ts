import { createHash } from "node:crypto";
import { normalizeInboundMoment, type InboundImportDataset, type InboundImportItem } from "./inbound-import-safety";
import { normalizeSkuId, type ProductCatalogItem } from "./product-catalog";
import type { PickingWaveStoreSnapshot } from "./picking-wave/shared-store-types";
import { WEEKLY_RULES_VERSION, type WeeklyPeriod, type WeeklySnapshot, type WeeklyUnresolvedItem, type WeeklyVendorItem } from "./weekly-work-types";
import { toVendorOrderQuantity } from "./vendor-order/aggregate";

const clean = (value: unknown) => String(value ?? "").trim();
const key = (po: string, sku: string) => JSON.stringify([po, sku]);
const date = (value: unknown) => normalizeInboundMoment(clean(value))?.actualDate || "";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const quantity = (value: unknown): number | null => {
  const raw = clean(value).replace(/,/g, "");
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
};
const within = (value: string, period: WeeklyPeriod) => value >= period.startDate && value <= period.endDate;
const objects = (rows: string[][]) => rows.slice(1).filter(row => row.some(value => clean(value))).map(row =>
  Object.fromEntries((rows[0] || []).map((header, index) => [clean(header), clean(row[index])])));

export function validateWeeklyPeriod(period: WeeklyPeriod): void {
  if (!period || date(period.startDate) !== period.startDate || date(period.endDate) !== period.endDate
    || period.startDate > period.endDate) throw new Error("분석 시작일과 종료일을 확인해 주세요.");
  if ((Date.parse(period.endDate) - Date.parse(period.startDate)) / 86_400_000 > 366) throw new Error("분석 기간은 1년 이내로 선택해 주세요.");
}

interface Receipt { po: string; sku: string; at: string; day: string; inbound: number; outbound: number; exact: boolean }
interface Purchase {
  po: string; sku: string; name: string; confirmed: number | null; cancelled: boolean;
  sourceIssue: string; sourceReceived: number | null;
}
interface BuildInput {
  period: WeeklyPeriod; datasets: InboundImportDataset[]; historyRows: string[][]; purchaseRows: string[][];
  catalogItems: ProductCatalogItem[]; pickingStore: PickingWaveStoreSnapshot;
  mode: WeeklySnapshot["source"]["mode"]; now?: string; carryPurchaseOrders?: string[];
}

export function weeklyOperationalToken(input: Pick<BuildInput, "historyRows" | "purchaseRows" | "catalogItems" | "pickingStore">): string {
  return hash({ version: 1, historyRows: input.historyRows, purchaseRows: input.purchaseRows, catalogItems: input.catalogItems, pickingStore: input.pickingStore });
}

/** Pure weekly read model. It never imports receipts or changes stock/picking/order state. */
export function buildWeeklySnapshot(input: BuildInput): WeeklySnapshot {
  validateWeeklyPeriod(input.period);
  const { period, pickingStore } = input;
  const warnings = new Set<string>();
  const blockers = new Set<string>();
  const vendorProblems = new Map<string, Set<string>>();
  const problem = (sku: string, message: string) => {
    const entries = vendorProblems.get(sku) || new Set<string>();
    entries.add(message); vendorProblems.set(sku, entries);
  };
  const events = new Map<string, InboundImportItem>();
  let duplicateCount = 0;
  for (const dataset of input.datasets) {
    const seen = new Set<string>();
    for (const raw of dataset.items) {
      const moment = normalizeInboundMoment(raw.actualAt);
      const po = clean(raw.po), sku = normalizeSkuId(raw.sku);
      const inbound = quantity(raw.totalInbound), outbound = quantity(raw.outbound);
      if (!moment || !po || !sku || inbound === null || outbound === null
        || !((raw.kind === "inbound" && inbound > 0 && outbound === 0) || (raw.kind === "outbound" && outbound > 0 && inbound === 0))) {
        blockers.add(`${dataset.sourceFile}: 입고 원문의 날짜·발주번호·SKU·수량을 확인해 주세요.`); continue;
      }
      const eventKey = JSON.stringify([moment.actualAt, po, sku, raw.kind]);
      const item = { ...raw, po, sku, actualAt: moment.actualAt, actualDate: moment.actualDate, eventKey };
      if (seen.has(eventKey)) blockers.add(`${dataset.sourceFile}: 같은 시각·발주·SKU 이벤트가 반복되어 원문 확인이 필요합니다.`);
      seen.add(eventKey);
      const prior = events.get(eventKey);
      if (prior) {
        if (prior.totalInbound !== inbound || prior.outbound !== outbound) blockers.add(`발주 ${po} · SKU ${sku}: 겹친 원문의 입고/반출 수량이 서로 다릅니다.`);
        else duplicateCount += 1;
      } else events.set(eventKey, item);
    }
  }
  const allEvents = [...events.values()];
  const selected = allEvents.filter(item => within(item.actualDate, period));
  const received = selected.filter(item => item.kind === "inbound" && item.totalInbound > 0);
  const selectedPo = new Set(received.map(item => item.po));
  const catalog = new Map<string, ProductCatalogItem>();
  for (const item of input.catalogItems) {
    const sku = normalizeSkuId(item.skuId);
    if (!sku) continue;
    if (catalog.has(sku)) problem(sku, "제품DB에 같은 SKU가 여러 행입니다. 상품 연결 확인이 필요합니다.");
    else catalog.set(sku, item);
  }
  const purchaseHeaderValues = (input.purchaseRows[0] || []).map(clean);
  const validPurchaseHeaders = ["발주번호", "SKU ID"].every(header => purchaseHeaderValues.filter(value => value === header).length === 1)
    && ["확정수량", "발주수량"].some(header => purchaseHeaderValues.filter(value => value === header).length === 1)
    && ["확정수량", "발주수량", "발주현황", "_주간원문검증오류", "_주간원문입고수량"].every(header => purchaseHeaderValues.filter(value => value === header).length <= 1);
  const purchases: Purchase[] = objects(input.purchaseRows).map(row => ({
    po: clean(row["발주번호"]), sku: normalizeSkuId(row["SKU ID"]), name: row["상품명"] || "",
    confirmed: quantity(clean(row["확정수량"]) === "" ? row["발주수량"] : row["확정수량"]),
    cancelled: /취소|반려|무효/.test(row["발주현황"] || ""),
    sourceIssue: clean(row["_주간원문검증오류"]) || (clean(row["_주간원문입고수량"]) !== "" && quantity(row["_주간원문입고수량"]) === null ? "발주서 입고수량을 정확한 정수로 확인할 수 없습니다." : ""),
    sourceReceived: quantity(row["_주간원문입고수량"]),
  }));
  const headerRequired = ["발주번호", "SKU ID", "입고수량", "반출", "최근입고일"];
  const validHistoryHeaders = input.historyRows.length > 0
    && headerRequired.every(header => (input.historyRows[0] || []).map(clean).filter(value => value === header).length === 1);
  const historyObjects = validHistoryHeaders ? objects(input.historyRows) : [];
  const receiptEvidencePo = new Set(allEvents.filter(item => item.kind === "inbound" && item.totalInbound > 0).map(item => item.po));
  for (const row of historyObjects) {
    const po = clean(row["발주번호"]), sku = normalizeSkuId(row["SKU ID"]);
    const inbound = quantity(row["입고수량"]), outbound = quantity(row["반출"]);
    if (po && sku && normalizeInboundMoment(row["최근입고일"]) && inbound !== null && inbound > 0 && outbound !== null) receiptEvidencePo.add(po);
  }
  // An expected date or an old saved review is never proof of receipt. A receipt
  // on any SKU admits that PO's other lines, including their zero-receipt SKUs.
  const scopePo = new Set(selectedPo);
  const carryPurchaseOrders = [...new Set((input.carryPurchaseOrders || []).map(clean).filter(po => po && receiptEvidencePo.has(po)))].sort();
  carryPurchaseOrders.forEach(po => scopePo.add(po));
  const scoped = purchases.filter(item => scopePo.has(item.po));
  const byPoSku = new Map<string, Purchase>();
  const duplicatePurchaseKeys = new Set<string>();
  const incompletePurchaseOrders = new Set(scoped.filter(item => !item.sku).map(item => item.po));
  for (const item of scoped) {
    if (!item.sku) { warnings.add(`발주 ${item.po}: SKU가 없는 발주행이 있어 거래처 발주 대조를 확인해야 합니다.`); continue; }
    if (byPoSku.has(key(item.po, item.sku))) {
      duplicatePurchaseKeys.add(key(item.po, item.sku));
      problem(item.sku, `발주 ${item.po}: 발주이력이 중복되어 수량을 자동 확정할 수 없습니다.`);
    }
    else byPoSku.set(key(item.po, item.sku), item);
    if (incompletePurchaseOrders.has(item.po)) problem(item.sku, `발주 ${item.po}: SKU가 없는 발주행이 있어 발주 구성과 수량을 확인할 수 없습니다.`);
    if (item.sourceIssue) problem(item.sku, `발주 ${item.po} · SKU ${item.sku}: ${item.sourceIssue}`);
    if (item.confirmed === null) problem(item.sku, `발주 ${item.po}: 확정수량이 비었거나 올바르지 않습니다.`);
  }
  const scopedSkus = new Set(scoped.map(item => item.sku).filter(Boolean));
  const sourceByDay = new Map<string, Receipt[]>();
  for (const item of allEvents) {
    const receipt: Receipt = { po: item.po, sku: item.sku, at: item.actualAt, day: item.actualDate, inbound: item.totalInbound, outbound: item.outbound, exact: true };
    const dayKey = JSON.stringify([receipt.po, receipt.sku, receipt.day]);
    sourceByDay.set(dayKey, [...(sourceByDay.get(dayKey) || []), receipt]);
  }
  const historyByDay = new Map<string, Receipt[]>();
  const globalVendorIssues = new Set<string>();
  if (!input.purchaseRows.length) globalVendorIssues.add("발주이력을 확인하지 못해 미입고 수량 대조가 필요합니다.");
  else if (!validPurchaseHeaders) globalVendorIssues.add("발주이력 열 구성이 달라 확정수량을 정확히 대조할 수 없습니다.");
  if (!input.historyRows.length) globalVendorIssues.add("기존 누적 입고이력이 없어 이전 입고 누락 여부를 확인해야 합니다.");
  if (input.historyRows.length && !validHistoryHeaders) {
    globalVendorIssues.add("입고이력 열 구성이 달라 누적수량을 자동 확정할 수 없습니다.");
  } else for (const row of historyObjects) {
    const po = clean(row["발주번호"]), sku = normalizeSkuId(row["SKU ID"]);
    if (!scopePo.has(po) || !scopedSkus.has(sku)) continue;
    const moment = normalizeInboundMoment(row["최근입고일"] || row["실제입고일"]);
    const inbound = quantity(row["입고수량"]), outbound = quantity(row["반출"]);
    if (!po || !moment || inbound === null || outbound === null || inbound + outbound === 0) {
      problem(sku, "기존 입고이력에 날짜 또는 수량 오류가 있어 누적 입고를 확인해야 합니다."); continue;
    }
    const receipt: Receipt = { po, sku, at: moment.actualAt, day: moment.actualDate, inbound, outbound,
      exact: moment.hasTime && /^noidb-inbound-event-v2:/.test(row["데이터세트"] || "") && ((inbound > 0 && outbound === 0) || (outbound > 0 && inbound === 0)) };
    const dayKey = JSON.stringify([po, sku, moment.actualDate]);
    historyByDay.set(dayKey, [...(historyByDay.get(dayKey) || []), receipt]);
  }
  const cumulative = new Map<string, number>();
  const sumReceipt = (items: Receipt[]) => items.reduce((sum, item) => ({ inbound: sum.inbound + item.inbound, outbound: sum.outbound + item.outbound }), { inbound: 0, outbound: 0 });
  for (const dayKey of new Set([...historyByDay.keys(), ...sourceByDay.keys()])) {
    const history = historyByDay.get(dayKey) || [], source = sourceByDay.get(dayKey) || [];
    const representative = source[0] || history[0];
    if (!representative || !scopePo.has(representative.po) || !scopedSkus.has(representative.sku)) continue;
    const historyKeys = history.filter(item => item.exact).map(item => `${item.at}|${item.inbound > 0 ? "inbound" : "outbound"}`);
    if (new Set(historyKeys).size !== historyKeys.length || history.filter(item => !item.exact).length > 1
      || (history.some(item => !item.exact) && history.some(item => item.exact))) {
      problem(representative.sku, `발주 ${representative.po} · ${representative.day}: 기존 입고이력의 중복 또는 일합계 겹침을 확인해야 합니다.`);
    }
    let merged: Receipt[];
    if (!history.length) merged = source;
    else if (!source.length) merged = history;
    else if (history.some(item => !item.exact)) {
      const a = sumReceipt(history), b = sumReceipt(source);
      if (a.inbound !== b.inbound || a.outbound !== b.outbound) problem(representative.sku, `발주 ${representative.po} · ${representative.day}: 과거 일합계와 원문이 겹치지만 수량이 달라 누적 입고 확인이 필요합니다.`);
      else duplicateCount += source.length;
      merged = history;
    } else {
      const exact = new Map<string, Receipt>();
      for (const item of history) {
        const eventKey = `${item.at}|${item.inbound > 0 ? "inbound" : "outbound"}`;
        if (exact.has(eventKey)) problem(item.sku, `발주 ${item.po}: 기존 입고 이벤트가 중복되어 누적수량 확인이 필요합니다.`);
        else exact.set(eventKey, item);
      }
      for (const item of source) {
        const eventKey = `${item.at}|${item.inbound > 0 ? "inbound" : "outbound"}`, prior = exact.get(eventKey);
        if (prior) {
          if (prior.inbound !== item.inbound || prior.outbound !== item.outbound) problem(item.sku, `발주 ${item.po}: 기존 이력과 원문의 동일 입고 이벤트 수량이 다릅니다.`);
          else duplicateCount += 1;
        } else exact.set(eventKey, item);
      }
      merged = [...exact.values()];
    }
    const total = sumReceipt(merged), poSku = key(representative.po, representative.sku);
    const net = (cumulative.get(poSku) || 0) + total.inbound - total.outbound;
    if (![total.inbound, total.outbound, net].every(Number.isSafeInteger)) problem(representative.sku, `발주 ${representative.po}: 누적 입고수량이 올바른 정수 범위를 벗어나 확인이 필요합니다.`);
    cumulative.set(poSku, net);
  }
  const sourceName = (sku: string) => received.find(item => item.sku === sku)?.name || allEvents.find(item => item.sku === sku)?.name || "";
  const baseItem = (skuId: string) => ({ skuId, productName: sourceName(skuId) || scoped.find(item => item.sku === skuId)?.name || catalog.get(skuId)?.productName || "", productLink: catalog.get(skuId)?.productLink || "" });
  const couponInboundBySku = new Map<string, number>();
  for (const item of received) couponInboundBySku.set(item.sku, (couponInboundBySku.get(item.sku) || 0) + item.totalInbound);
  // Coupon eligibility uses gross actual inbound in the selected period, summed
  // across events and POs. Returns cannot turn a multi-unit receipt into one unit.
  const couponItems = blockers.size ? [] : [...couponInboundBySku].filter(([, amount]) => amount === 1).map(([sku]) => sku).sort().map(baseItem);
  type ShortageDetail = NonNullable<WeeklyVendorItem["shortageDetails"]>[number];
  const shortageBySku = new Map<string, { quantity: number; pos: Set<string>; confirmedQuantity: number | null; receivedQuantity: number | null; details: ShortageDetail[] }>();
  const getMismatch = (sku: string) => shortageBySku.get(sku)
    || { quantity: 0, pos: new Set<string>(), confirmedQuantity: 0, receivedQuantity: 0, details: [] as ShortageDetail[] };
  for (const purchase of byPoSku.values()) {
    if (duplicatePurchaseKeys.has(key(purchase.po, purchase.sku))) {
      if (scoped.some(item => item.po === purchase.po && item.sku === purchase.sku && !item.cancelled && item.confirmed !== 0)) {
        const prior = getMismatch(purchase.sku);
        prior.confirmedQuantity = null;
        if (prior.receivedQuantity !== null) prior.receivedQuantity += cumulative.get(key(purchase.po, purchase.sku)) || 0;
        prior.pos.add(purchase.po); shortageBySku.set(purchase.sku, prior);
      }
      continue;
    }
    if (purchase.cancelled || purchase.confirmed === 0) continue;
    const total = cumulative.get(key(purchase.po, purchase.sku)) || 0;
    if (purchase.sourceReceived !== null && purchase.sourceReceived !== total) {
      problem(purchase.sku, `발주 ${purchase.po} · SKU ${purchase.sku}: 발주서 입고수량 ${purchase.sourceReceived}개와 입고상세 누적수량 ${total}개가 달라 미납수량을 확정할 수 없습니다.`);
    }
    if (total < 0) problem(purchase.sku, `발주 ${purchase.po}: 반출이 입고보다 많아 잔량 확인이 필요합니다.`);
    const shortage = purchase.confirmed === null ? 0 : Math.max(0, purchase.confirmed - Math.max(0, total));
    if (purchase.confirmed !== null && total > purchase.confirmed) {
      const message = `발주 ${purchase.po} · SKU ${purchase.sku}: 누적 순입고가 확정수량보다 커 원문 확인이 필요합니다.`;
      warnings.add(message);
      problem(purchase.sku, message);
    }
    // Fully received/overreceived lines are not shortage candidates. Ambiguous
    // source totals still require a review instead of appearing safely complete.
    if (purchase.confirmed !== null && shortage === 0 && !vendorProblems.has(purchase.sku)) continue;
    const prior = getMismatch(purchase.sku);
    prior.confirmedQuantity = prior.confirmedQuantity === null || purchase.confirmed === null ? null : prior.confirmedQuantity + purchase.confirmed;
    if (prior.receivedQuantity !== null) prior.receivedQuantity += total;
    if (purchase.confirmed !== null && total >= 0 && shortage > 0) prior.details.push({
      purchaseOrderNumber: purchase.po, confirmedQuantity: purchase.confirmed, receivedQuantity: total, shortageQuantity: shortage,
    });
    prior.quantity += shortage; prior.pos.add(purchase.po); shortageBySku.set(purchase.sku, prior);
  }
  const missingPurchaseEvidence = [...allEvents.map(item => ({ po: item.po, sku: item.sku })),
    ...historyObjects.map(row => ({ po: clean(row["발주번호"]), sku: normalizeSkuId(row["SKU ID"]) }))]
    .filter(item => scopePo.has(item.po) && item.sku);
  for (const item of missingPurchaseEvidence) if (!purchases.some(purchase => purchase.po === item.po && purchase.sku === item.sku)) {
    const message = `발주 ${item.po} · SKU ${item.sku}: 대응 발주이력이 없어 미입고 잔량을 계산할 수 없습니다. 최신 발주자료 확인이 필요합니다.`;
    warnings.add(message); problem(item.sku, message);
    const prior = getMismatch(item.sku);
    prior.confirmedQuantity = null;
    prior.receivedQuantity = null;
    prior.pos.add(item.po); shortageBySku.set(item.sku, prior);
  }
  const vendorItems: WeeklyVendorItem[] = [];
  const unresolvedItems: WeeklyUnresolvedItem[] = [];
  for (const [skuId, shortage] of shortageBySku) {
    const product = catalog.get(skuId);
    const dataIssues = [...new Set([...(vendorProblems.get(skuId) || []), ...globalVendorIssues, ...blockers])];
    const exactDetails = dataIssues.length === 0 && shortage.details.length > 0
      && [shortage.quantity, shortage.confirmedQuantity, shortage.receivedQuantity].every(Number.isSafeInteger)
      && shortage.quantity > 0
      && shortage.details.every(item => [item.confirmedQuantity, item.receivedQuantity, item.shortageQuantity].every(Number.isSafeInteger)
        && item.confirmedQuantity > item.receivedQuantity && item.receivedQuantity >= 0 && item.shortageQuantity > 0)
      && shortage.details.reduce((sum, item) => sum + item.shortageQuantity, 0) === shortage.quantity
      && shortage.details.reduce((sum, item) => sum + item.confirmedQuantity, 0) === shortage.confirmedQuantity
      && shortage.details.reduce((sum, item) => sum + item.receivedQuantity, 0) === shortage.receivedQuantity;
    // An uncertain PO must not appear as a zero shortage or as a partial SKU total.
    // Operational review issues below do not make a verified receipt shortage uncertain.
    if (!exactDetails) {
      unresolvedItems.push({ skuId, productName: baseItem(skuId).productName,
        relatedPurchaseOrderNumbers: [...shortage.pos].sort(),
        issues: dataIssues.length ? dataIssues : ["발주번호별 확정수량과 실제 누적 입고수량을 정확히 대조할 수 없어 미납에서 제외했습니다."] });
      continue;
    }
    const issues = new Set<string>();
    let openOrderQuantity = 0;
    const lineIds = new Set<string>();
    for (const line of pickingStore.vendorOrderLines.filter(line => normalizeSkuId(line.skuId) === skuId && !pickingStore.deletedVendorLineIds[line.id])) {
      const draft = pickingStore.vendorOrderDrafts.find(draft => draft.id === line.draftId && !pickingStore.deletedVendorDraftIds[draft.id]);
      const ordered = quantity(line.shortageQuantity), receivedQuantity = quantity(line.receivedQuantity ?? 0);
      if (!draft || ordered === null || receivedQuantity === null || lineIds.has(line.id)) { issues.add("기존 거래처 발주 연결 또는 수량을 확인해야 합니다."); continue; }
      lineIds.add(line.id);
      const remaining = Math.max(0, ordered - receivedQuantity);
      if (!remaining) continue;
      const related = line.relatedPurchaseOrderNumbers || [];
      if (!related.length || related.some(po => !shortage.pos.has(po))) { issues.add(`기존 거래처 발주 ${remaining}개에 다른 발주가 연결되어 추가 주문 수량을 확인해야 합니다.`); continue; }
      openOrderQuantity += remaining;
      if (draft.status !== "sent") issues.add(`기존 거래처 발주 ${remaining}개가 전송 완료 전입니다. 기존 발주와 추가 수량을 확인해 주세요.`);
    }
    for (const item of pickingStore.items.filter(item => normalizeSkuId(item.productCode) === skuId)) {
      if (item.allocations.some(allocation => shortage.pos.has(allocation.purchaseOrderNumber) && allocation.fulfilledQuantity > 0)) {
        issues.add("이미 피킹한 수량이 있습니다. 출고 대기·배송 중·입고 반영 지연 여부를 확인해 주세요."); break;
      }
    }
    if (pickingStore.shipments.some(shipment => shipment.status === "dispatched" && shipment.purchaseOrders.some(po => shortage.pos.has(po.purchaseOrderNumber)))) issues.add("연결 발주가 출고 완료 상태입니다. 배송 중 수량을 확인한 뒤 추가 주문해 주세요.");
    if (product?.currentStock.trim()) issues.add(`현재고 ${product.currentStock}개는 참고 정보입니다. 실제 사용 가능한 재고를 확인해 주세요.`);
    else issues.add("사용 가능한 현재고를 확인한 뒤 주문 수량을 확정해 주세요.");
    if (!product?.vendorName.trim()) issues.add("거래처를 지정해 주세요.");
    if (!product?.imageUrl.trim()) issues.add("거래처에 보낼 상품 사진을 추가해 주세요.");
    vendorItems.push({ ...baseItem(skuId), vendorName: product?.vendorName || "", imageUrl: product?.imageUrl || "",
      optionLabel: product?.optionLabel || "", modelName: product?.modelName || "", barcode: product?.barcode || "",
      shortageQuantity: shortage.quantity, openOrderQuantity, suggestedQuantity: toVendorOrderQuantity(Math.max(0, shortage.quantity - openOrderQuantity), product?.productName || ""),
      ...(shortage.confirmedQuantity === null ? {} : { confirmedQuantity: shortage.confirmedQuantity }),
      ...(shortage.receivedQuantity === null ? {} : { receivedQuantity: shortage.receivedQuantity }),
      shortageDetails: shortage.details.sort((a, b) => a.purchaseOrderNumber.localeCompare(b.purchaseOrderNumber)),
      relatedPurchaseOrderNumbers: [...shortage.pos].sort(), issues: [...issues], discontinued: /단종/.test(product?.currentStatus || "") });
  }
  if (!selected.length) warnings.add("선택 기간에 확인된 입고/반출 원문이 없습니다. 파일의 조회 기간과 최신 자료를 확인해 주세요.");
  globalVendorIssues.forEach(issue => warnings.add(issue));
  const actualDates = allEvents.map(item => item.actualDate).sort();
  const operationalToken = weeklyOperationalToken(input);
  // A re-download or browser transfer changes descriptors, not the underlying work.
  const canonicalEvents = allEvents.map(item => [item.actualAt, item.po, item.sku, item.kind, item.totalInbound, item.outbound])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const sourceToken = hash({ version: 5, rulesVersion: WEEKLY_RULES_VERSION, period, events: canonicalEvents, operationalToken, carryPurchaseOrders, blockers: [...blockers].sort() });
  return { id: `WEEKLY-${sourceToken.slice(0, 20)}`, rulesVersion: WEEKLY_RULES_VERSION, sourceToken, operationalToken, createdAt: input.now || new Date().toISOString(), period: { ...period },
    source: { files: [...new Set(input.datasets.map(dataset => dataset.sourceFile))], firstActualDate: actualDates[0] || "", latestActualDate: actualDates.at(-1) || "",
      eventCount: allEvents.length, duplicateCount, selectedEventCount: selected.length, mode: input.mode },
    couponItems, couponReceiptKeys: Object.fromEntries(couponItems.map(item => [item.skuId, received.filter(event => event.sku === item.skuId).map(event => event.eventKey).sort()])),
    vendorItems: vendorItems.sort((a, b) => a.vendorName.localeCompare(b.vendorName, "ko") || a.skuId.localeCompare(b.skuId)),
    unresolvedItems: unresolvedItems.sort((a, b) => a.skuId.localeCompare(b.skuId)), warnings: [...warnings], blockers: [...blockers] };
}
