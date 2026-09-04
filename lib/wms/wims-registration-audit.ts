import { createHash } from "node:crypto";
import { fetchSheetRows } from "./google-sheets";
import { backupSheetWithinSpreadsheet, updateSheetCells, type SheetCellUpdate } from "./google-sheets";
import { PRODUCT_DB_SHEET_NAME } from "./product-catalog";
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
  message: string;
}

export interface WimsRegistrationAudit {
  readOnly: true;
  dryRunToken: string;
  rows: WimsAuditResultRow[];
  approvedCandidateCount: number;
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

const PENDING = new Set(["신상승인대기", "기존상품승인대기"]);
const REJECTION_DECISIONS = new Set(["등록불가", "재등록시도"]);

function normalize(value: unknown): string {
  return String(value ?? "").trim().toUpperCase().replace(/[\s_-]+/g, "");
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

export async function buildWimsRegistrationAudit(wimsRows: WimsRegistrationRow[]): Promise<WimsRegistrationAudit> {
  const sheetRows = await fetchSheetRows(PRODUCT_DB_SHEET_NAME, { valueRenderOption: "FORMULA" });
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
    if (normalize(product.modelSku)) byModelSku.set(normalize(product.modelSku), [...(byModelSku.get(normalize(product.modelSku)) || []), product]);
    if (normalize(product.skuId)) bySkuId.set(normalize(product.skuId), [...(bySkuId.get(normalize(product.skuId)) || []), product]);
    if (normalizeProductName(product.productName)) byProductName.set(normalizeProductName(product.productName), [...(byProductName.get(normalizeProductName(product.productName)) || []), product]);
  }

  const matchedSheetRows = new Set<number>();
  const rows: WimsAuditResultRow[] = [];
  for (const wims of wimsRows) {
    const skuMatches = wims.skuId ? bySkuId.get(normalize(wims.skuId)) || [] : [];
    const modelMatches = wims.modelSku ? byModelSku.get(normalize(wims.modelSku)) || [] : [];
    const rejectedNameMatches = wims.status === "rejected" ? byProductName.get(normalizeProductName(wims.productName, wims.modelSku)) || [] : [];
    const matches = skuMatches.length > 0 ? skuMatches : modelMatches.length > 0 ? modelMatches : rejectedNameMatches;
    if (matches.length !== 1) {
      rows.push({ type: matches.length > 1 ? "conflict" : "unmatched", wims, message: matches.length > 1 ? `제품DB 후보가 ${matches.length}행이라 자동 연결할 수 없습니다.` : "제품DB에서 동일 SKU ID 또는 모델SKU 행을 찾지 못했습니다." });
      continue;
    }
    const product = matches[0];
    matchedSheetRows.add(product.sheetRowNumber);
    const base = { wims, sheetRowNumber: product.sheetRowNumber, productDbModelSku: product.modelSku, productDbSkuId: product.skuId, productDbStatus: product.status, productDbProductName: product.productName, productDbBarcode: product.barcode };
    if (wims.status === "rejected") {
      rows.push({ ...base, type: "rejected", message: "WIMS 반려 건입니다. SKU·바코드를 자동 반영하지 않습니다." });
    } else if (wims.status === "reviewing") {
      rows.push({ ...base, type: "reviewing", message: "WIMS에서 실제 검수중인 등록 건입니다." });
    } else if (wims.status !== "approved" || !wims.skuId || !wims.barcode) {
      rows.push({ ...base, type: "unmatched", message: "검수완료 여부 또는 SKU·R바코드를 확인해야 합니다." });
    } else if (product.skuId && normalize(product.skuId) !== normalize(wims.skuId)) {
      rows.push({ ...base, type: "conflict", message: `제품DB SKU ${product.skuId}와 WIMS SKU ${wims.skuId}가 다릅니다.` });
    } else if (product.barcode && normalize(product.barcode) !== normalize(wims.barcode)) {
      rows.push({ ...base, type: "conflict", message: `불변 바코드가 다릅니다: 제품DB ${product.barcode} / WIMS ${wims.barcode}` });
    } else if (product.skuId && product.barcode) {
      rows.push({ ...base, type: "already_linked", message: "제품DB에 같은 SKU·바코드가 이미 연결되어 있습니다." });
    } else {
      rows.push({ ...base, type: "approved_candidate", message: `기존 제품DB ${product.sheetRowNumber}행에 SKU·바코드를 채울 수 있습니다.` });
    }
  }

  const pendingNotInWims = products.filter(product => PENDING.has(product.status) && !matchedSheetRows.has(product.sheetRowNumber)).map(product => ({ sheetRowNumber: product.sheetRowNumber, modelSku: product.modelSku, productName: product.productName }));
  const auditWithoutToken: Omit<WimsRegistrationAudit, "dryRunToken"> = {
    readOnly: true,
    rows,
    approvedCandidateCount: rows.filter(row => row.type === "approved_candidate").length,
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
  const target = audit.rows.find(row => row.wims.status === "rejected" && row.sheetRowNumber === sheetRowNumber);
  if (!target) throw new Error("정확히 연결된 반려 제품DB 행을 찾지 못했습니다.");

  const sheetRows = await fetchSheetRows(PRODUCT_DB_SHEET_NAME, { valueRenderOption: "FORMULA" });
  const headers = (sheetRows[0] || []).map(value => String(value ?? "").trim());
  const statusIndex = headerIndex(headers, ["현재상태", "상태"]);
  if (statusIndex < 0) throw new Error("제품DB 현재상태 열을 찾지 못했습니다.");
  const currentStatus = String(sheetRows[sheetRowNumber - 1]?.[statusIndex] ?? "").trim();
  const allowed = new Set(["신상승인대기", "기존상품승인대기", "등록파일생성", "등록불가", "재등록시도"]);
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
  const identityUnchanged = normalize(finalModelSku) === normalize(target.productDbModelSku)
    && normalize(finalSkuId) === normalize(target.productDbSkuId)
    && normalizeProductName(finalProductName) === normalizeProductName(target.productDbProductName || "")
    && normalize(finalBarcode) === normalize(target.productDbBarcode);
  if (!identityUnchanged) throw new Error("최종 확인에서 대상 제품DB 행의 식별정보가 바뀌어 상태를 수정하지 않았습니다.");
  if (finalStatus !== currentStatus) throw new Error(`현재상태가 ${currentStatus || "빈값"}에서 ${finalStatus || "빈값"}(으)로 바뀌어 덮어쓰지 않았습니다.`);
  await updateSheetCells(PRODUCT_DB_SHEET_NAME, [{ row: sheetRowNumber, col: finalStatusIndex + 1, value: decision }]);
  return { applied: true, decision, sheetRowNumber, backupSheetName: backup.sheetName };
}

export async function applyWimsRegistrationAudit(wimsRows: WimsRegistrationRow[], expectedDryRunToken: string): Promise<WimsRegistrationApplyResult> {
  const audit = await buildWimsRegistrationAudit(wimsRows);
  if (!expectedDryRunToken || audit.dryRunToken !== expectedDryRunToken) throw new Error("WIMS 또는 제품DB 내용이 미리보기 이후 변경되었습니다. 다시 대조해주세요.");
  const candidates = audit.rows.filter(row => row.type === "approved_candidate" && row.sheetRowNumber);
  if (candidates.length === 0) return { applied: false, audit, writtenRowCount: 0, writtenCellCount: 0 };

  const backup = await backupSheetWithinSpreadsheet(PRODUCT_DB_SHEET_NAME);
  const rechecked = await buildWimsRegistrationAudit(wimsRows);
  if (rechecked.dryRunToken !== audit.dryRunToken) throw new Error("제품DB가 백업 중 변경되었습니다. 다시 대조해주세요.");

  const sheetRows = await fetchSheetRows(PRODUCT_DB_SHEET_NAME, { valueRenderOption: "FORMULA" });
  const headers = (sheetRows[0] || []).map(value => String(value ?? "").trim());
  const idx = {
    status: headerIndex(headers, ["현재상태", "상태"]),
    skuId: headerIndex(headers, ["SKU ID", "SKU"]),
    barcode: headerIndex(headers, ["쿠팡 바코드", "Seller SKU Barcode", "쿠팡바코드", "바코드"]),
    productName: headerIndex(headers, ["상품명"]),
  };
  const cellUpdates: SheetCellUpdate[] = [];
  for (const candidate of rechecked.rows.filter(row => row.type === "approved_candidate" && row.sheetRowNumber)) {
    const row = candidate.sheetRowNumber!;
    cellUpdates.push(
      { row, col: idx.status + 1, value: "완료" },
      { row, col: idx.skuId + 1, value: candidate.wims.skuId },
      { row, col: idx.barcode + 1, value: candidate.wims.barcode },
      { row, col: idx.productName + 1, value: candidate.wims.productName }
    );
  }
  await updateSheetCells(PRODUCT_DB_SHEET_NAME, cellUpdates);
  return { applied: true, audit: rechecked, backupSheetName: backup.sheetName, writtenRowCount: candidates.length, writtenCellCount: cellUpdates.length };
}
