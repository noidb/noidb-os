import { appendSheetRow, ensureHiddenSheet, ensureHiddenSheetOptionalColumn, fetchExistingSheetRows, fetchSheetRows, updateSheetCells } from "./google-sheets";
import { normalizeSkuId, PRODUCT_DB_SHEET_NAME } from "./product-catalog";
import { calculateReceivingCost } from "./receiving-cost";
import { resolveDisplayNameAndOption } from "./display-name";
import { summarizeReceivingDelayRows, validateReceivingDelayChange, type ReceivingDelaySummary } from "./vendor-order/receiving-delay";
export type { ReceivingDelaySummary } from "./vendor-order/receiving-delay";

export const STATUS_REQUEST_SHEET = "_WMS단종해제이력";
export const RECEIVING_DELAY_SHEET = "_WMS입고지연이력";
export const RECEIVING_COST_SHEET = "_WMS입고원가이력";
export const STATUS_FILE_GENERATION_SHEET = "_WMS단종파일생성이력";

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
export const STATUS_FILE_GENERATION_HEADERS = [
  "생성ID", "구분", "SKU IDs", "요청 IDs", "생성일시", "XLSX 파일명", "PDF 파일명", "생성자",
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
  const rows = await fetchExistingSheetRows(STATUS_REQUEST_SHEET, { expectedHeaders: STATUS_REQUEST_HEADERS });
  // 빈 이력행이 있어도 실제 시트 행번호를 유지해야 처리완료가 다른 SKU 셀에 기록되지 않는다.
  return rows.slice(1).map((row, index) => ({ row, sheetRow: index + 2 }))
    .filter(({ row }) => row.some(Boolean)).map(({ row, sheetRow }) => {
    const item = rowObject(STATUS_REQUEST_HEADERS, row);
    return {
      id: item["요청ID"], skuId: item["SKU ID"], modelSku: item["모델SKU"], productName: item["상품명"],
      optionLabel: item["옵션"], currentStatus: item["현재상태"], requestType: item["요청구분"] as "단종" | "단종해제",
      requestedAt: item["요청일"], supplyHubStatus: item["Supply Hub 처리상태"] as "처리대기" | "처리완료",
      completedAt: item["처리완료일"], requester: item["요청자"], processor: item["처리자"],
      previousStatus: item["이전상태"] === EMPTY_STATUS_TOKEN ? "" : item["이전상태"], productLink: item["제품링크"],
      purchaseOrderNumber: item["발주번호"], sheetRow,
    };
  });
}

export interface StatusFileGenerationRecord {
  id: string;
  kind: "단종" | "단종해제";
  skuIds: string[];
  requestIds: string[];
  generatedAt: string;
  xlsxFileName: string;
  pdfFileName: string;
  operator: string;
}

/** 단종/해제 후보만 외부 처리대기 목록에 넣는다.
 * 제품DB 현재상태는 건드리지 않으며, 파일 생성과 실제 외부 완료를 별도로 관리한다. */
export async function queueStatusCandidate(input: {
  skuId: string; operator: string; purchaseOrderNumber?: string; requestType: "단종" | "단종해제";
}): Promise<StatusRequestRecord> {
  const skuId = requiredText(input.skuId, "SKU ID");
  const operator = requiredText(input.operator, "처리자");
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
  if (input.requestType === "단종" && currentStatus === "단종") throw new Error(`SKU ${skuId}는 이미 단종 상태입니다.`);
  if (input.requestType === "단종해제" && currentStatus !== "단종") throw new Error(`SKU ${skuId}는 현재 단종 상태가 아니어서 해제대기에 넣지 않았습니다.`);
  const productName = String(product.values[headerIndex("상품명")] ?? "").trim();
  const display = resolveDisplayNameAndOption(productName, String(product.values[product.headers.indexOf("색상")] ?? "").trim());
  const record: StatusRequestRecord = {
    id: makeId("status"), skuId: normalizeSkuId(skuId),
    modelSku: String(product.values[headerIndex("모델SKU")] ?? "").trim(),
    productName: display.name, optionLabel: display.option,
    currentStatus, requestType: input.requestType, requestedAt: new Date().toISOString(), supplyHubStatus: "처리대기",
    completedAt: "", requester: operator, processor: "", previousStatus: currentStatus,
    productLink: String(product.values[product.headers.indexOf("제품링크")] ?? "").trim(),
    purchaseOrderNumber: String(input.purchaseOrderNumber || "").trim(), sheetRow: 0,
  };
  await ensureHiddenSheet(STATUS_REQUEST_SHEET, [...STATUS_REQUEST_HEADERS]);
  await appendSheetRow(STATUS_REQUEST_SHEET, [
    record.id, record.skuId, record.modelSku, record.productName, record.optionLabel, record.currentStatus,
    record.requestType, record.requestedAt, record.supplyHubStatus, "", record.requester, "",
    currentStatus || EMPTY_STATUS_TOKEN, record.productLink, record.purchaseOrderNumber,
  ]);
  return record;
}

export async function queueDiscontinueCandidate(input: {
  skuId: string; operator: string; purchaseOrderNumber?: string;
}): Promise<StatusRequestRecord> {
  return queueStatusCandidate({ ...input, requestType: "단종" });
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

export async function listStatusFileGenerations(): Promise<StatusFileGenerationRecord[]> {
  const rows = await fetchExistingSheetRows(STATUS_FILE_GENERATION_SHEET, { expectedHeaders: STATUS_FILE_GENERATION_HEADERS });
  return rows.slice(1).filter(row => row.some(Boolean)).map(row => {
    const item = rowObject(STATUS_FILE_GENERATION_HEADERS, row);
    return {
      id: item["생성ID"], kind: item["구분"] as "단종" | "단종해제",
      skuIds: item["SKU IDs"].split(",").map(value => value.trim()).filter(Boolean),
      requestIds: item["요청 IDs"].split(",").map(value => value.trim()).filter(Boolean),
      generatedAt: item["생성일시"], xlsxFileName: item["XLSX 파일명"], pdfFileName: item["PDF 파일명"], operator: item["생성자"],
    };
  });
}

export async function recordStatusFileGeneration(input: {
  kind: "단종" | "단종해제"; skuIds: string[]; requestIds: string[];
  xlsxFileName: string; pdfFileName?: string; operator?: string;
}): Promise<StatusFileGenerationRecord> {
  if (input.kind !== "단종" && input.kind !== "단종해제") throw new Error("지원하지 않는 생성 구분입니다.");
  const skuIds = Array.from(new Set((input.skuIds || []).map(normalizeSkuId).filter(Boolean)));
  const requestIds = Array.from(new Set((input.requestIds || []).map(value => String(value || "").trim()).filter(Boolean)));
  if (!skuIds.length || !requestIds.length) throw new Error("파일 생성 이력의 SKU 또는 요청 정보가 비어 있습니다.");
  const requests = await listStatusRequests();
  // Reprinting a completed request only appends a generation record. It must
  // neither require a status rollback nor change the original request row.
  const requestsById = new Map(requests.map(item => [item.id, item]));
  const matched = requestIds.map(id => requestsById.get(id)).filter((item): item is StatusRequestRecord => Boolean(item));
  const matchedSkuIds = Array.from(new Set(matched.map(item => normalizeSkuId(item.skuId))));
  if (matched.length !== requestIds.length || matched.some(item => item.requestType !== input.kind) || matchedSkuIds.length !== skuIds.length || matchedSkuIds.some(id => !skuIds.includes(id))) {
    throw new Error("선택한 요청 목록과 생성 파일의 SKU 또는 신청 종류가 달라 이력 저장을 중단했습니다.");
  }
  const xlsxFileName = requiredText(input.xlsxFileName, "XLSX 파일명");
  const pdfFileName = input.kind === "단종" ? requiredText(input.pdfFileName, "단종 공문 PDF 파일명") : "";
  await ensureHiddenSheet(STATUS_FILE_GENERATION_SHEET, [...STATUS_FILE_GENERATION_HEADERS]);
  const record: StatusFileGenerationRecord = {
    id: makeId("status-file"), kind: input.kind, skuIds, requestIds, generatedAt: new Date().toISOString(),
    xlsxFileName, pdfFileName,
    operator: String(input.operator || "자동").trim() || "자동",
  };
  await appendSheetRow(STATUS_FILE_GENERATION_SHEET, [
    record.id, record.kind, record.skuIds.join(","), record.requestIds.join(","), record.generatedAt,
    record.xlsxFileName, record.pdfFileName, record.operator,
  ]);
  return record;
}

export async function recordReceivingDelay(input: {
  skuId: string; modelSku?: string; productName?: string; optionLabel?: string; vendorName?: string;
  purchaseOrderNumber?: string; operator: string; delayed: boolean; memo?: string; expectedLastActionAt?: string | null;
}): Promise<ReceivingDelaySummary> {
  const skuId = normalizeSkuId(requiredText(input.skuId, "SKU ID"));
  const operator = requiredText(input.operator, "처리자");
  let previous = (await listReceivingDelaySummaries()).find(summary => summary.skuId === skuId);
  const initial = validateReceivingDelayChange(input, previous);
  if (!initial.changed) return previous || { skuId, recentDelayedAt: "", active: false, lastActionAt: "", vendorName: "", memo: "" };
  // Only this explicit mutation can create/extend the dedicated history tab. Reads never do.
  await ensureHiddenSheetOptionalColumn(RECEIVING_DELAY_SHEET, RECEIVING_DELAY_HEADERS, "메모");
  previous = (await listReceivingDelaySummaries()).find(summary => summary.skuId === skuId);
  const change = validateReceivingDelayChange(input, previous);
  if (!change.changed && previous) return previous;
  const now = new Date().toISOString();
  await appendSheetRow(RECEIVING_DELAY_SHEET, [
    makeId("delay"), skuId, input.modelSku || "", input.productName || "", input.optionLabel || "",
    input.vendorName || "", input.purchaseOrderNumber || "", input.delayed ? "입고지연" : "입고지연해제",
    now, operator, input.delayed ? "입고지연" : "해제", change.memo,
  ]);
  return { skuId, active: input.delayed, recentDelayedAt: input.delayed ? now : previous?.recentDelayedAt || "", lastActionAt: now, vendorName: input.vendorName || "", memo: change.memo };
}

export async function listReceivingDelaySummaries(): Promise<ReceivingDelaySummary[]> {
  const rows = await fetchExistingSheetRows(RECEIVING_DELAY_SHEET, { expectedHeaders: RECEIVING_DELAY_HEADERS });
  const memoHeader = String(rows[0]?.[RECEIVING_DELAY_HEADERS.length] || "").trim();
  if (memoHeader && memoHeader !== "메모") throw new Error("입고지연 메모 열 구성을 확인해 주세요.");
  return summarizeReceivingDelayRows(memoHeader === "메모" ? rows : rows.map(row => row.slice(0, RECEIVING_DELAY_HEADERS.length)));
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
