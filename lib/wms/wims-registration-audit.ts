import { createHash } from "node:crypto";
import { fetchSheetRows } from "./google-sheets";
import { backupSheetWithinSpreadsheet, updateSheetCells, type SheetCellUpdate } from "./google-sheets";
import { PRODUCT_DB_SHEET_NAME } from "./product-catalog";
import { collectRetiredSkuIds, fetchSkuReplacementHistory as readReregistrationHistory } from "./sku-retirement";
import type { WimsRegistrationRow } from "./wims-registration";

export type WimsAuditResultType = "approved_candidate" | "reviewing" | "rejected" | "already_linked" | "conflict" | "unmatched";

export interface WimsAuditResultRow {
  type: WimsAuditResultType;
  wims: WimsRegistrationRow;
  sheetRowNumber?: number;
  productDbModelSku?: string;
  productDbSkuId?: string;
  productDbStatus?: string;
  productDbProductName?: string;
  productDbBarcode?: string;
  proposedStatus?: string;
  message: string;
}

export interface WimsRegistrationAudit {
  readOnly: true;
  dryRunToken: string;
  rows: WimsAuditResultRow[];
  approvedCandidateCount: number;
  reviewingCandidateCount: number;
  reviewingCount: number;
  rejectedCount: number;
  alreadyLinkedCount: number;
  conflictCount: number;
  unmatchedCount: number;
  pendingNotInWimsCount: number;
  pendingNotInWims: { sheetRowNumber: number; modelSku: string; productName: string }[];
}

export interface WimsRegistrationApplyResult {
  applied: boolean;
  audit: WimsRegistrationAudit;
  backupSheetName?: string;
  writtenRowCount: number;
  writtenCellCount: number;
}

const PENDING = new Set(["신상승인대기", "기존상품승인대기", "등록파일생성", "재등록파일생성"]);
const REJECTION_DECISIONS = new Set(["등록불가", "재등록시도"]);

function normalize(value: unknown): string {
  return String(value ?? "").trim().toUpperCase().replace(/[\s_-]+/g, "");
}

function identityKey(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeProductName(value: string, trailingModelSku = ""): string {
  let text = value.trim();
  if (trailingModelSku && text.toUpperCase().endsWith(trailingModelSku.toUpperCase())) {
    text = text.slice(0, text.length - trailingModelSku.length).trim();
  }
  return normalize(text.replace(/\d+\s*(?:컬러|색상?)/g, "").replace(/[,.]/g, ""));
}

function headerIndex(headers: string[], candidates: string[]): number {
  const normalized = headers.map(normalize);
  return normalized.findIndex(header => candidates.some(candidate => header === normalize(candidate)));
}

interface ReregistrationHistory { latestAt: number; previousSkuIds: Set<string> }

function parseReregistrationHistory(rows: string[][]): { byModelSku: Map<string, ReregistrationHistory>; retiredSkuIds: Set<string> } {
  const headers = rows[0] || [];
  const statusIndex = headerIndex(headers, ["처리상태"]);
  const dateIndex = headerIndex(headers, ["처리일시"]);
  const oldSkuIndex = headerIndex(headers, ["이전 SKU ID"]);
  const originalIndex = headerIndex(headers, ["기존행전체정보"]);
  const targetIndex = headerIndex(headers, ["새행연결전정보"]);
  const retiredSkuIds = collectRetiredSkuIds(rows);
  const histories = new Map<string, ReregistrationHistory>();
  for (const row of rows.slice(1)) {
    const isDuplicateCleanup = row[statusIndex] === "재등록중복정리";
    if (row[statusIndex] !== "동일모델재등록" && !isDuplicateCleanup) continue;
    const previousSkuId = identityKey(row[oldSkuIndex]);
    try {
      const original = JSON.parse(row[isDuplicateCleanup ? targetIndex : originalIndex] || "null");
      const originalModelSku = Array.isArray(original) ? original[5]
        : Array.isArray(original?.headers) && Array.isArray(original?.values)
          ? original.values[headerIndex(original.headers, ["모델SKU"])] : original?.["모델SKU"];
      const modelSku = identityKey(originalModelSku);
      // 중복정리 시각은 실제 업로드보다 늦을 수 있으므로 등록일 하한으로 쓰지 않는다.
      const registeredAt = isDuplicateCleanup ? 0 : Date.parse(String(row[dateIndex] || ""));
      if (!modelSku || !Number.isFinite(registeredAt)) continue;
      const history = histories.get(modelSku) || { latestAt: registeredAt, previousSkuIds: new Set<string>() };
      history.latestAt = Math.max(history.latestAt, registeredAt);
      if (previousSkuId) history.previousSkuIds.add(previousSkuId);
      histories.set(modelSku, history);
    } catch { /* 해석되지 않은 이력은 현재 재등록을 입증할 수 없다. */ }
  }
  return { byModelSku: histories, retiredSkuIds };
}

function isCurrentRegistration(wims: WimsRegistrationRow, history: ReregistrationHistory): boolean {
  if (wims.skuId && history.previousSkuIds.has(identityKey(wims.skuId))) return false;
  if (!history.latestAt) return true;
  const match = wims.registeredAt.trim().match(/^(\d{4})[\/-](\d{2})[\/-](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return false;
  const stamp = Date.parse(match[1] + "-" + match[2] + "-" + match[3] + "T" + (match[4] || "00") + ":" + (match[5] || "00") + ":" + (match[6] || "00") + "+09:00");
  return Number.isFinite(stamp) && stamp >= history.latestAt;
}

export async function buildWimsRegistrationAudit(wimsRows: WimsRegistrationRow[]): Promise<WimsRegistrationAudit> {
  const sheetRows = await fetchSheetRows(PRODUCT_DB_SHEET_NAME, { valueRenderOption: "FORMULA" });
  const historyRows = await readReregistrationHistory(sheetRows);
  return buildWimsRegistrationAuditFromRows(wimsRows, sheetRows, historyRows);
}

export function buildWimsRegistrationAuditFromRows(wimsRows: WimsRegistrationRow[], sheetRows: string[][], historyRows: string[][] = []): WimsRegistrationAudit {
  const headers = (sheetRows[0] || []).map(value => String(value ?? "").trim());
  const idx = {
    status: headerIndex(headers, ["현재상태", "상태"]),
    modelSku: headerIndex(headers, ["모델SKU"]),
    skuId: headerIndex(headers, ["SKU ID", "SKU"]),
    barcode: headerIndex(headers, ["쿠팡 바코드", "Seller SKU Barcode", "쿠팡바코드", "바코드"]),
    productName: headerIndex(headers, ["상품명"]),
  };
  const missing = Object.entries(idx).filter(([, value]) => value < 0).map(([key]) => key);
  if (missing.length > 0) throw new Error(`제품DB 필수 열을 찾지 못했습니다: ${missing.join(", ")}`);

  const products = sheetRows.slice(1).map((row, index) => ({
    row,
    sheetRowNumber: index + 2,
    status: String(row[idx.status] ?? "").trim(),
    modelSku: String(row[idx.modelSku] ?? "").trim(),
    skuId: String(row[idx.skuId] ?? "").trim(),
    barcode: String(row[idx.barcode] ?? "").trim(),
    productName: String(row[idx.productName] ?? "").trim(),
  }));
  const byModelSku = new Map<string, typeof products>();
  const bySkuId = new Map<string, typeof products>();
  const byProductName = new Map<string, typeof products>();
  for (const product of products) {
    if (identityKey(product.modelSku)) byModelSku.set(identityKey(product.modelSku), [...(byModelSku.get(identityKey(product.modelSku)) || []), product]);
    if (identityKey(product.skuId)) bySkuId.set(identityKey(product.skuId), [...(bySkuId.get(identityKey(product.skuId)) || []), product]);
    if (normalizeProductName(product.productName)) byProductName.set(normalizeProductName(product.productName), [...(byProductName.get(normalizeProductName(product.productName)) || []), product]);
  }

  const reregistrations = parseReregistrationHistory(historyRows);
  const matchedSheetRows = new Set<number>();
  const rows: WimsAuditResultRow[] = [];
  for (const wims of wimsRows) {
    if (wims.skuId && reregistrations.retiredSkuIds.has(identityKey(wims.skuId))) {
      rows.push({ type: "unmatched", wims, message: "재등록 이력에서 교체된 이전 SKU입니다. 현재 상품에 다시 연결하지 않습니다." });
      continue;
    }
    const skuMatches = wims.skuId ? bySkuId.get(identityKey(wims.skuId)) || [] : [];
    const modelMatches = wims.modelSku ? byModelSku.get(identityKey(wims.modelSku)) || [] : [];
    const rejectedNameMatches = wims.status === "rejected" ? byProductName.get(normalizeProductName(wims.productName, wims.modelSku)) || [] : [];
    const matches = skuMatches.length > 0 ? skuMatches : modelMatches.length > 0 ? modelMatches : rejectedNameMatches;
    if (matches.length !== 1) {
      rows.push({ type: matches.length > 1 ? "conflict" : "unmatched", wims, message: matches.length > 1 ? `제품DB 후보가 ${matches.length}행이라 자동 연결할 수 없습니다.` : "제품DB에서 동일 SKU ID 또는 모델SKU 행을 찾지 못했습니다." });
      continue;
    }
    const product = matches[0];
    const base = { wims, sheetRowNumber: product.sheetRowNumber, productDbModelSku: product.modelSku, productDbSkuId: product.skuId, productDbStatus: product.status, productDbProductName: product.productName, productDbBarcode: product.barcode };
    const history = reregistrations.byModelSku.get(identityKey(product.modelSku));
    const isReregistration = ["재등록파일생성", "기존상품승인대기"].includes(product.status) || (PENDING.has(product.status) && Boolean(history));
    if ((product.status === "재등록파일생성" && !history) || (isReregistration && history && !isCurrentRegistration(wims, history))) {
      rows.push({ ...base, sheetRowNumber: undefined, type: "unmatched", message: "이전 등록 이력이거나 재등록 이후 등록 건임을 확인할 수 없습니다. WIMS 등록일·시간을 포함해 이번 재등록 건을 다시 수집해주세요." });
      continue;
    }
    matchedSheetRows.add(product.sheetRowNumber);
    if ((wims.modelSku && identityKey(product.modelSku) !== identityKey(wims.modelSku))
      || modelMatches.some(match => match.sheetRowNumber !== product.sheetRowNumber)
      || (product.skuId && wims.skuId && identityKey(product.skuId) !== identityKey(wims.skuId))
      || (product.barcode && wims.barcode && identityKey(product.barcode) !== identityKey(wims.barcode))) {
      rows.push({ ...base, type: "conflict", message: "SKU ID·모델SKU·바코드가 서로 다른 제품을 가리켜 자동 반영하지 않습니다." });
    } else if (wims.status === "rejected") {
      rows.push({ ...base, type: "rejected", message: "WIMS 반려 건입니다. SKU·바코드를 자동 반영하지 않습니다." });
    } else if (wims.status === "reviewing") {
      const proposedStatus = product.status === "등록파일생성" ? (history ? "기존상품승인대기" : "신상승인대기")
        : product.status === "재등록파일생성" ? "기존상품승인대기" : undefined;
      rows.push({ ...base, type: "reviewing", proposedStatus, message: proposedStatus
        ? "WIMS 검수중 확인: 현재상태를 " + proposedStatus + "(으)로 반영할 수 있습니다."
        : "WIMS에서 실제 검수중인 등록 건입니다. 제품DB 현재상태는 유지합니다." });
    } else if (wims.status !== "approved" || !wims.skuId || !wims.barcode) {
      rows.push({ ...base, type: "unmatched", message: "검수완료 여부 또는 SKU·R바코드를 확인해야 합니다." });
    } else if (product.skuId && identityKey(product.skuId) !== identityKey(wims.skuId)) {
      rows.push({ ...base, type: "conflict", message: `제품DB SKU ${product.skuId}와 WIMS SKU ${wims.skuId}가 다릅니다.` });
    } else if (product.barcode && identityKey(product.barcode) !== identityKey(wims.barcode)) {
      rows.push({ ...base, type: "conflict", message: `불변 바코드가 다릅니다: 제품DB ${product.barcode} / WIMS ${wims.barcode}` });
    } else if (product.skuId && product.barcode && !PENDING.has(product.status)) {
      rows.push({ ...base, type: "already_linked", message: "제품DB에 같은 SKU·바코드가 이미 연결되어 있습니다." });
    } else if (!PENDING.has(product.status)) {
      rows.push({ ...base, type: "conflict", message: "제품DB 현재상태가 승인대기 또는 등록파일생성이 아니라 승인 결과를 자동 반영하지 않습니다." });
    } else {
      rows.push({ ...base, type: "approved_candidate", proposedStatus: "완료", message: `기존 제품DB ${product.sheetRowNumber}행에 SKU·바코드를 채울 수 있습니다.` });
    }
  }

  // 한 제품에 여러 견적서가 연결되면 마지막 행으로 덮어쓰지 않는다.
  const matchedCounts = new Map<number, number>();
  for (const row of rows) if (row.sheetRowNumber) matchedCounts.set(row.sheetRowNumber, (matchedCounts.get(row.sheetRowNumber) || 0) + 1);
  for (const row of rows) {
    if (row.sheetRowNumber && (matchedCounts.get(row.sheetRowNumber) || 0) > 1) {
      row.type = "conflict";
      row.proposedStatus = undefined;
      row.message = "같은 제품DB 행에 여러 WIMS 견적서가 연결됩니다. 등록일 범위를 이번 등록 건으로 좁혀 다시 수집해주세요.";
    }
  }

  const pendingNotInWims = products.filter(product => PENDING.has(product.status) && !matchedSheetRows.has(product.sheetRowNumber)).map(product => ({ sheetRowNumber: product.sheetRowNumber, modelSku: product.modelSku, productName: product.productName }));
  const auditWithoutToken: Omit<WimsRegistrationAudit, "dryRunToken"> = {
    readOnly: true,
    rows,
    approvedCandidateCount: rows.filter(row => row.type === "approved_candidate").length,
    reviewingCandidateCount: rows.filter(row => row.type === "reviewing" && row.proposedStatus).length,
    reviewingCount: wimsRows.filter(row => row.status === "reviewing").length,
    rejectedCount: wimsRows.filter(row => row.status === "rejected").length,
    alreadyLinkedCount: rows.filter(row => row.type === "already_linked").length,
    conflictCount: rows.filter(row => row.type === "conflict").length,
    unmatchedCount: rows.filter(row => row.type === "unmatched").length,
    pendingNotInWimsCount: pendingNotInWims.length,
    pendingNotInWims,
  };
  return { ...auditWithoutToken, dryRunToken: createHash("sha256").update(JSON.stringify(auditWithoutToken)).digest("hex") };
}

export async function applyWimsRejectionDecision(
  wimsRows: WimsRegistrationRow[],
  expectedDryRunToken: string,
  sheetRowNumber: number,
  decision: string
) {
  if (!REJECTION_DECISIONS.has(decision)) throw new Error("반려 처리 상태는 등록불가 또는 재등록시도만 가능합니다.");
  const audit = await buildWimsRegistrationAudit(wimsRows);
  if (!expectedDryRunToken || audit.dryRunToken !== expectedDryRunToken) throw new Error("WIMS 또는 제품DB 내용이 변경되었습니다. 다시 대조해주세요.");
  const target = audit.rows.find(row => row.type === "rejected" && row.sheetRowNumber === sheetRowNumber);
  if (!target) throw new Error("정확히 연결된 반려 제품DB 행을 찾지 못했습니다.");

  const sheetRows = await fetchSheetRows(PRODUCT_DB_SHEET_NAME, { valueRenderOption: "FORMULA" });
  const headers = (sheetRows[0] || []).map(value => String(value ?? "").trim());
  const statusIndex = headerIndex(headers, ["현재상태", "상태"]);
  if (statusIndex < 0) throw new Error("제품DB 현재상태 열을 찾지 못했습니다.");
  const currentStatus = String(sheetRows[sheetRowNumber - 1]?.[statusIndex] ?? "").trim();
  const allowed = new Set([...PENDING, "등록불가", "재등록시도"]);
  if (!allowed.has(currentStatus)) throw new Error(`현재상태가 ${currentStatus || "빈값"}이라 반려 상태로 변경하지 않았습니다.`);
  if (currentStatus === decision) return { applied: false, decision, sheetRowNumber, backupSheetName: "" };

  const backup = await backupSheetWithinSpreadsheet(PRODUCT_DB_SHEET_NAME);
  const rechecked = await buildWimsRegistrationAudit(wimsRows);
  if (rechecked.dryRunToken !== audit.dryRunToken) throw new Error("제품DB가 백업 중 변경되었습니다. 다시 대조해주세요.");

  // 백업 사이에 열 순서가 바뀌었을 가능성까지 차단하기 위해 최종 쓰기 직전에
  // 머리글과 대상 행 식별자를 다시 읽는다. 이전 statusIndex를 재사용하지 않는다.
  const finalRows = await fetchSheetRows(PRODUCT_DB_SHEET_NAME, { valueRenderOption: "FORMULA" });
  const finalHeaders = (finalRows[0] || []).map(value => String(value ?? "").trim());
  const finalStatusIndex = headerIndex(finalHeaders, ["현재상태", "상태"]);
  const finalModelSkuIndex = headerIndex(finalHeaders, ["모델SKU"]);
  const finalSkuIdIndex = headerIndex(finalHeaders, ["SKU ID", "SKU"]);
  const finalProductNameIndex = headerIndex(finalHeaders, ["상품명"]);
  const finalBarcodeIndex = headerIndex(finalHeaders, ["쿠팡 바코드", "Seller SKU Barcode", "쿠팡바코드", "바코드"]);
  if ([finalStatusIndex, finalModelSkuIndex, finalSkuIdIndex, finalProductNameIndex, finalBarcodeIndex].some(index => index < 0)) throw new Error("최종 확인에서 제품DB 식별 열을 찾지 못했습니다.");
  const finalRow = finalRows[sheetRowNumber - 1] || [];
  const finalModelSku = String(finalRow[finalModelSkuIndex] ?? "").trim();
  const finalSkuId = String(finalRow[finalSkuIdIndex] ?? "").trim();
  const finalProductName = String(finalRow[finalProductNameIndex] ?? "").trim();
  const finalBarcode = String(finalRow[finalBarcodeIndex] ?? "").trim();
  const finalStatus = String(finalRow[finalStatusIndex] ?? "").trim();
  const identityUnchanged = identityKey(finalModelSku) === identityKey(target.productDbModelSku)
    && identityKey(finalSkuId) === identityKey(target.productDbSkuId)
    && finalProductName === (target.productDbProductName || "")
    && identityKey(finalBarcode) === identityKey(target.productDbBarcode);
  if (!identityUnchanged) throw new Error("최종 확인에서 대상 제품DB 행의 식별정보가 바뀌어 상태를 수정하지 않았습니다.");
  if (finalStatus !== currentStatus) throw new Error(`현재상태가 ${currentStatus || "빈값"}에서 ${finalStatus || "빈값"}(으)로 바뀌어 덮어쓰지 않았습니다.`);
  const updates = [{ row: sheetRowNumber, col: finalStatusIndex + 1, value: decision }];
  await updateSheetCells(PRODUCT_DB_SHEET_NAME, updates);
  verifyWrittenRows(finalRows, await fetchSheetRows(PRODUCT_DB_SHEET_NAME, { valueRenderOption: "FORMULA" }), updates);
  return { applied: true, decision, sheetRowNumber, backupSheetName: backup.sheetName };
}

export function buildWimsRegistrationCellUpdates(
  sheetRows: string[][], audit: WimsRegistrationAudit, includeReviewing = false
): SheetCellUpdate[] {
  const headers = (sheetRows[0] || []).map(value => String(value ?? "").trim());
  const idx = {
    status: headerIndex(headers, ["현재상태", "상태"]),
    modelSku: headerIndex(headers, ["모델SKU"]),
    skuId: headerIndex(headers, ["SKU ID", "SKU"]),
    barcode: headerIndex(headers, ["쿠팡 바코드", "Seller SKU Barcode", "쿠팡바코드", "바코드"]),
    productName: headerIndex(headers, ["상품명"]),
  };
  if (Object.values(idx).some(index => index < 0)) throw new Error("최종 확인에서 제품DB 필수 열을 찾지 못했습니다.");
  const cellUpdates: SheetCellUpdate[] = [];
  const seen = new Set<number>();
  for (const candidate of audit.rows) {
    const approved = candidate.type === "approved_candidate";
    const reviewing = includeReviewing && candidate.type === "reviewing" && candidate.proposedStatus;
    if (!candidate.sheetRowNumber || (!approved && !reviewing)) continue;
    const row = candidate.sheetRowNumber;
    if (seen.has(row)) throw new Error("동일 제품DB 행에 여러 WIMS 결과가 연결되어 반영을 중단했습니다.");
    seen.add(row);
    const current = sheetRows[row - 1] || [];
    if (identityKey(current[idx.modelSku]) !== identityKey(candidate.productDbModelSku)
      || identityKey(current[idx.skuId]) !== identityKey(candidate.productDbSkuId)
      || identityKey(current[idx.barcode]) !== identityKey(candidate.productDbBarcode)
      || String(current[idx.productName] ?? "").trim() !== candidate.productDbProductName
      || String(current[idx.status] ?? "").trim() !== candidate.productDbStatus) {
      throw new Error("최종 확인에서 대상 제품DB 행의 식별정보 또는 현재상태가 바뀌었습니다. 다시 대조해주세요.");
    }
    if (reviewing) {
      cellUpdates.push({ row, col: idx.status + 1, value: candidate.proposedStatus! });
      continue;
    }
    cellUpdates.push(
      { row, col: idx.status + 1, value: "완료" },
      { row, col: idx.skuId + 1, value: candidate.wims.skuId },
      { row, col: idx.barcode + 1, value: candidate.wims.barcode },
      { row, col: idx.productName + 1, value: candidate.wims.productName }
    );
  }
  return cellUpdates.filter(update => String(sheetRows[update.row - 1]?.[update.col - 1] ?? "") !== update.value);
}

function verifyWrittenRows(before: string[][], after: string[][], updates: SheetCellUpdate[]): void {
  if (JSON.stringify(before[0]) !== JSON.stringify(after[0]) || before.length !== after.length) {
    throw new Error("반영 후 제품DB 구조가 달라져 검증하지 못했습니다. 제품DB를 다시 확인해주세요.");
  }
  const affectedRows = new Set(updates.map(update => update.row));
  for (const rowNumber of affectedRows) {
    const expected = [...(before[rowNumber - 1] || [])];
    for (const update of updates.filter(item => item.row === rowNumber)) expected[update.col - 1] = update.value;
    const actual = after[rowNumber - 1] || [];
    const width = Math.max(expected.length, actual.length);
    for (let index = 0; index < width; index += 1) {
      if (String(expected[index] ?? "") !== String(actual[index] ?? "")) {
        throw new Error("제품DB " + rowNumber + "행 반영 후 검증에 실패했습니다. 백업과 현재 행을 확인해주세요.");
      }
    }
  }
}

export async function applyWimsRegistrationAudit(
  wimsRows: WimsRegistrationRow[], expectedDryRunToken: string, includeReviewing = false
): Promise<WimsRegistrationApplyResult> {
  const audit = await buildWimsRegistrationAudit(wimsRows);
  if (!expectedDryRunToken || audit.dryRunToken !== expectedDryRunToken) throw new Error("WIMS 또는 제품DB 내용이 미리보기 이후 변경되었습니다. 다시 대조해주세요.");
  if (audit.approvedCandidateCount === 0 && (!includeReviewing || audit.reviewingCandidateCount === 0)) {
    return { applied: false, audit, writtenRowCount: 0, writtenCellCount: 0 };
  }
  const backup = await backupSheetWithinSpreadsheet(PRODUCT_DB_SHEET_NAME);
  const sheetRows = await fetchSheetRows(PRODUCT_DB_SHEET_NAME, { valueRenderOption: "FORMULA" });
  const historyRows = await readReregistrationHistory(sheetRows);
  const rechecked = buildWimsRegistrationAuditFromRows(wimsRows, sheetRows, historyRows);
  if (rechecked.dryRunToken !== audit.dryRunToken) throw new Error("제품DB가 백업 중 변경되었습니다. 다시 대조해주세요.");
  const cellUpdates = buildWimsRegistrationCellUpdates(sheetRows, rechecked, includeReviewing);
  if (cellUpdates.length === 0) return { applied: false, audit: rechecked, backupSheetName: backup.sheetName, writtenRowCount: 0, writtenCellCount: 0 };
  await updateSheetCells(PRODUCT_DB_SHEET_NAME, cellUpdates);
  const after = await fetchSheetRows(PRODUCT_DB_SHEET_NAME, { valueRenderOption: "FORMULA" });
  verifyWrittenRows(sheetRows, after, cellUpdates);
  return { applied: true, audit: rechecked, backupSheetName: backup.sheetName, writtenRowCount: new Set(cellUpdates.map(cell => cell.row)).size, writtenCellCount: cellUpdates.length };
}
