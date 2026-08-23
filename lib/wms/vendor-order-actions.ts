import { appendSheetRow, ensureHiddenSheet, fetchSheetRows, updateSheetCells } from "./google-sheets";
import { normalizeSkuId, PRODUCT_DB_SHEET_NAME } from "./product-catalog";
import { calculateReceivingCost } from "./receiving-cost";
import { resolveDisplayNameAndOption } from "./display-name";

export const STATUS_REQUEST_SHEET = "_WMS단종해제이력";
export const RECEIVING_DELAY_SHEET = "_WMS입고지연이력";
export const RECEIVING_COST_SHEET = "_WMS입고원가이력";

export const STATUS_REQUEST_HEADERS = [
  "요청ID", "SKU ID", "모델SKU", "상품명", "옵션", "현재상태", "요청구분", "요청일",
  "Supply Hub 처리상태", "처리완료일", "요청자", "처리자", "이전상태", "제품링크", "발주번호",
] as const;
export const RECEIVING_DELAY_HEADERS = [
  "기록ID", "SKU ID", "모델SKU", "상품명", "옵션", "거래처", "발주번호", "처리구분", "처리일", "처리자", "상태",
] as const;
export const RECEIVING_COST_HEADERS = [
  "기록ID", "발주번호", "발주라인ID", "SKU ID", "입력단가(부가세별도)", "부가세", "원가(부가세포함)",
  "입고수량", "입력일시", "입력자", "이전원가",
] as const;

const EMPTY_STATUS_TOKEN = "(빈값)";

export interface StatusRequestRecord {
  id: string;
  skuId: string;
  modelSku: string;
  productName: string;
  optionLabel: string;
  currentStatus: string;
  requestType: "단종" | "단종해제";
  requestedAt: string;
  supplyHubStatus: "처리대기" | "처리완료";
  completedAt: string;
  requester: string;
  processor: string;
  previousStatus: string;
  productLink: string;
  purchaseOrderNumber: string;
  sheetRow: number;
}

export interface ReceivingDelaySummary {
  skuId: string;
  recentDelayedAt: string;
  active: boolean;
  lastActionAt: string;
}

interface ProductSnapshot {
  rowNumber: number;
  headers: string[];
  values: string[];
}

function requiredText(value: unknown, label: string): string {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label}이(가) 비어 있습니다.`);
  return text;
}

function makeId(prefix: string): string {
  return `${prefix}-${new Date().toISOString().replace(/[-:.TZ]/g, "")}-${Math.random().toString(36).slice(2, 9)}`;
}

function rowObject(headers: readonly string[], row: string[]): Record<string, string> {
  return Object.fromEntries(headers.map((header, index) => [header, String(row[index] ?? "").trim()]));
}

async function readProductSnapshot(skuId: string): Promise<ProductSnapshot> {
  const target = normalizeSkuId(skuId);
  if (!target) throw new Error("SKU ID가 비어 있습니다.");
  const rows = await fetchSheetRows(PRODUCT_DB_SHEET_NAME);
  if (!rows.length) throw new Error("제품DB를 읽을 수 없습니다.");
  const headers = rows[0].map(value => String(value || "").trim());
  const skuColumn = headers.indexOf("SKU ID");
  if (skuColumn < 0) throw new Error("제품DB에 'SKU ID' 헤더가 없습니다.");
  const matches = rows.slice(1).map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter(entry => normalizeSkuId(entry.row[skuColumn]) === target);
  if (matches.length !== 1) {
    throw new Error(matches.length === 0
      ? `제품DB에서 SKU ID "${skuId}"를 찾을 수 없습니다.`
      : `제품DB에 SKU ID "${skuId}"가 ${matches.length}건 중복되어 쓰기를 중단했습니다.`);
  }
  return { rowNumber: matches[0].rowNumber, headers, values: matches[0].row };
}

function normalizedNumber(value: string): string {
  const parsed = Number(String(value || "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? String(parsed) : String(value || "").trim();
}

async function writeProductField(
  skuId: string,
  header: string,
  expected: string,
  value: string,
  numeric = false
): Promise<void> {
  const latest = await readProductSnapshot(skuId);
  const column = latest.headers.indexOf(header);
  if (column < 0) throw new Error(`제품DB에 '${header}' 헤더가 없어 쓰기를 중단했습니다.`);
  const actual = String(latest.values[column] ?? "").trim();
  const same = numeric ? normalizedNumber(actual) === normalizedNumber(expected) : actual === expected;
  if (!same) throw new Error(`제품DB '${header}' 값이 조회 후 변경되어 쓰기를 중단했습니다.`);
  await updateSheetCells(PRODUCT_DB_SHEET_NAME, [{ row: latest.rowNumber, col: column + 1, value }]);
}

export async function listStatusRequests(): Promise<StatusRequestRecord[]> {
  await ensureHiddenSheet(STATUS_REQUEST_SHEET, [...STATUS_REQUEST_HEADERS]);
  const rows = await fetchSheetRows(STATUS_REQUEST_SHEET);
  return rows.slice(1).filter(row => row.some(Boolean)).map((row, index) => {
    const item = rowObject(STATUS_REQUEST_HEADERS, row);
    return {
      id: item["요청ID"], skuId: item["SKU ID"], modelSku: item["모델SKU"], productName: item["상품명"],
      optionLabel: item["옵션"], currentStatus: item["현재상태"], requestType: item["요청구분"] as "단종" | "단종해제",
      requestedAt: item["요청일"], supplyHubStatus: item["Supply Hub 처리상태"] as "처리대기" | "처리완료",
      completedAt: item["처리완료일"], requester: item["요청자"], processor: item["처리자"],
      previousStatus: item["이전상태"] === EMPTY_STATUS_TOKEN ? "" : item["이전상태"], productLink: item["제품링크"],
      purchaseOrderNumber: item["발주번호"], sheetRow: index + 2,
    };
  });
}

export async function createStatusRequest(input: {
  skuId: string; requestType: "단종" | "단종해제"; operator: string; purchaseOrderNumber?: string;
}): Promise<StatusRequestRecord> {
  const skuId = requiredText(input.skuId, "SKU ID");
  const operator = requiredText(input.operator, "처리자");
  if (input.requestType !== "단종" && input.requestType !== "단종해제") throw new Error("지원하지 않는 요청구분입니다.");
  const [requests, product] = await Promise.all([listStatusRequests(), readProductSnapshot(skuId)]);
  if (requests.some(request => normalizeSkuId(request.skuId) === normalizeSkuId(skuId) && request.supplyHubStatus === "처리대기")) {
    throw new Error(`SKU ${skuId}에 이미 처리대기 요청이 있습니다.`);
  }
  const headerIndex = (header: string) => {
    const index = product.headers.indexOf(header);
    if (index < 0) throw new Error(`제품DB에 '${header}' 헤더가 없습니다.`);
    return index;
  };
  const currentStatus = String(product.values[headerIndex("현재상태")] ?? "").trim();
  let nextStatus = "단종";
  let previousStatus = currentStatus;
  if (input.requestType === "단종") {
    if (currentStatus === "단종") throw new Error(`SKU ${skuId}는 이미 단종 상태입니다.`);
  } else {
    if (currentStatus !== "단종") throw new Error(`SKU ${skuId}의 현재상태가 단종이 아니어서 자동 해제하지 않았습니다.`);
    const prior = [...requests].reverse().find(request => normalizeSkuId(request.skuId) === normalizeSkuId(skuId) && request.requestType === "단종");
    if (!prior) throw new Error(`SKU ${skuId}의 단종 전 상태 이력을 찾지 못해 자동 복원을 중단했습니다.`);
    nextStatus = prior.previousStatus;
    previousStatus = currentStatus;
  }

  const now = new Date().toISOString();
  const productName = String(product.values[headerIndex("상품명")] ?? "").trim();
  const display = resolveDisplayNameAndOption(productName, String(product.values[product.headers.indexOf("색상")] ?? "").trim());
  const record: StatusRequestRecord = {
    id: makeId("status"), skuId: normalizeSkuId(skuId),
    modelSku: String(product.values[headerIndex("모델SKU")] ?? "").trim(),
    productName: display.name,
    optionLabel: display.option,
    currentStatus: nextStatus, requestType: input.requestType, requestedAt: now, supplyHubStatus: "처리대기",
    completedAt: "", requester: operator, processor: "", previousStatus,
    productLink: String(product.values[product.headers.indexOf("제품링크")] ?? "").trim(),
    purchaseOrderNumber: String(input.purchaseOrderNumber || "").trim(), sheetRow: 0,
  };

  await writeProductField(skuId, "현재상태", currentStatus, nextStatus);
  try {
    await appendSheetRow(STATUS_REQUEST_SHEET, [
      record.id, record.skuId, record.modelSku, record.productName, record.optionLabel, record.currentStatus,
      record.requestType, record.requestedAt, record.supplyHubStatus, "", record.requester, "",
      previousStatus || EMPTY_STATUS_TOKEN, record.productLink, record.purchaseOrderNumber,
    ]);
  } catch (error) {
    await writeProductField(skuId, "현재상태", nextStatus, currentStatus).catch(() => undefined);
    throw error;
  }
  return record;
}

export async function completeStatusRequests(ids: string[], operatorValue: string): Promise<number> {
  const operator = requiredText(operatorValue, "처리자");
  const targets = new Set(ids.map(value => String(value || "").trim()).filter(Boolean));
  if (!targets.size) return 0;
  const requests = await listStatusRequests();
  const statusColumn = STATUS_REQUEST_HEADERS.indexOf("Supply Hub 처리상태") + 1;
  const completedColumn = STATUS_REQUEST_HEADERS.indexOf("처리완료일") + 1;
  const processorColumn = STATUS_REQUEST_HEADERS.indexOf("처리자") + 1;
  const now = new Date().toISOString();
  const updates = requests.filter(request => targets.has(request.id) && request.supplyHubStatus === "처리대기")
    .flatMap(request => [
      { row: request.sheetRow, col: statusColumn, value: "처리완료" },
      { row: request.sheetRow, col: completedColumn, value: now },
      { row: request.sheetRow, col: processorColumn, value: operator },
    ]);
  if (!updates.length) return 0;
  await updateSheetCells(STATUS_REQUEST_SHEET, updates);
  return updates.length / 3;
}

export async function recordReceivingDelay(input: {
  skuId: string; modelSku?: string; productName?: string; optionLabel?: string; vendorName?: string;
  purchaseOrderNumber?: string; operator: string; delayed: boolean;
}): Promise<void> {
  const skuId = normalizeSkuId(requiredText(input.skuId, "SKU ID"));
  const operator = requiredText(input.operator, "처리자");
  await ensureHiddenSheet(RECEIVING_DELAY_SHEET, [...RECEIVING_DELAY_HEADERS]);
  const rows = await fetchSheetRows(RECEIVING_DELAY_SHEET);
  const existing = rows.slice(1).filter(row => normalizeSkuId(row[1]) === skuId);
  const last = existing[existing.length - 1];
  const active = last ? String(last[10] || "") === "입고지연" : false;
  if (active === input.delayed) throw new Error(input.delayed ? `SKU ${skuId}는 이미 입고지연 상태입니다.` : `SKU ${skuId}는 입고지연 상태가 아닙니다.`);
  const now = new Date().toISOString();
  await appendSheetRow(RECEIVING_DELAY_SHEET, [
    makeId("delay"), skuId, input.modelSku || "", input.productName || "", input.optionLabel || "",
    input.vendorName || "", input.purchaseOrderNumber || "", input.delayed ? "입고지연" : "입고지연해제",
    now, operator, input.delayed ? "입고지연" : "해제",
  ]);
}

export async function listReceivingDelaySummaries(): Promise<ReceivingDelaySummary[]> {
  await ensureHiddenSheet(RECEIVING_DELAY_SHEET, [...RECEIVING_DELAY_HEADERS]);
  const rows = await fetchSheetRows(RECEIVING_DELAY_SHEET);
  const summaries = new Map<string, ReceivingDelaySummary>();
  for (const row of rows.slice(1)) {
    const skuId = normalizeSkuId(row[1]);
    if (!skuId) continue;
    const action = String(row[7] || "");
    const actionAt = String(row[8] || "");
    const previous = summaries.get(skuId) || { skuId, recentDelayedAt: "", active: false, lastActionAt: "" };
    if (action === "입고지연") previous.recentDelayedAt = actionAt;
    previous.active = String(row[10] || "") === "입고지연";
    previous.lastActionAt = actionAt;
    summaries.set(skuId, previous);
  }
  return Array.from(summaries.values());
}

export async function applyReceivingCost(input: {
  draftId: string; lineId: string; purchaseOrderNumber?: string; skuId: string;
  unitPriceExVat: number; receivedQuantity: number; operator: string;
}): Promise<{ applied: boolean; vat: number; costVatIncluded: number }> {
  const skuId = normalizeSkuId(requiredText(input.skuId, "SKU ID"));
  const operator = requiredText(input.operator, "처리자");
  const receivedQuantity = Math.max(0, Math.round(Number(input.receivedQuantity) || 0));
  const { unitPriceExVat, vat, costVatIncluded } = calculateReceivingCost(input.unitPriceExVat);
  if (receivedQuantity <= 0 || unitPriceExVat <= 0) return { applied: false, vat, costVatIncluded };

  await ensureHiddenSheet(RECEIVING_COST_SHEET, [...RECEIVING_COST_HEADERS]);
  const eventId = `cost:${input.draftId}:${input.lineId}:${receivedQuantity}:${unitPriceExVat}`;
  const history = await fetchSheetRows(RECEIVING_COST_SHEET);
  if (history.slice(1).some(row => String(row[0] || "") === eventId)) return { applied: false, vat, costVatIncluded };
  const product = await readProductSnapshot(skuId);
  const costColumn = product.headers.indexOf("원가(부가세포함)");
  if (costColumn < 0) throw new Error("제품DB에 '원가(부가세포함)' 헤더가 없어 원가 반영을 중단했습니다.");
  const previousCost = String(product.values[costColumn] ?? "").trim();
  await writeProductField(skuId, "원가(부가세포함)", previousCost, String(costVatIncluded), true);
  try {
    await appendSheetRow(RECEIVING_COST_SHEET, [
      eventId, input.purchaseOrderNumber || "", input.lineId, skuId, unitPriceExVat, vat, costVatIncluded,
      receivedQuantity, new Date().toISOString(), operator, previousCost,
    ]);
  } catch (error) {
    await writeProductField(skuId, "원가(부가세포함)", String(costVatIncluded), previousCost, true).catch(() => undefined);
    throw error;
  }
  return { applied: true, vat, costVatIncluded };
}
