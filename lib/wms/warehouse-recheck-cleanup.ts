import { createHash } from "node:crypto";

/**
 * 창고재확인 탭 정리(사용자 확정 2026-10-08)
 * - 창고 확인결과가 비어 있으면: 아직 확인 중 → 그대로 둔다
 * - 거래처단종: 보관 탭으로 옮긴다(현재상태 = 거래처단종)
 * - 제품DB로 이동(재고있음): 제품DB 탭으로 옮기고 현재상태는 비운다.
 *   제품DB에 같은 SKU가 이미 있으면 새 행을 만들지 않고 그 행의 현재상태만 비운다.
 *   발주가능상태가 정상이 아니면 단종해제 대상에 넣는다.
 * - 그 밖의 결과: 기준이 없어 그대로 두고 알려 준다
 * 옮긴 행은 창고재확인 탭에서 지운다. 열은 같은 이름끼리 맞춰 넣는다.
 *
 * 보관 탭 = '_보관_비관리SKU_20261008'(사용자 확인 2026-10-19). 거래처단종은 이 탭으로 옮긴다.
 * 제품DB(사용자 확정 2026-10-19): 현재상태가 비관리(중복등록)·거래처단종·단종인 행은 보관 탭으로 옮기고 제품DB에서 지운다.
 *   판매중지·가품중단은 옮기지 않는다. 보관 탭에 같은 SKU가 이미 있으면 새로 붙이지 않고 제품DB에서만 지운다.
 */
export const RECHECK_TAB = "창고재확인";
export const STORAGE_TAB = "_보관_비관리SKU_20261008";
const STORAGE_LABEL = "보관" as const;

/** 시트 탭 이름 중 보관 탭을 고른다: 정확한 이름 → '보관_비관리'가 들어간 탭(백업 탭 제외) → 예전 '보관'. */
export function pickStorageTabTitle(titles: readonly string[]): string | null {
  const live = titles.filter(title => !title.startsWith("_백업_"));
  if (live.includes(STORAGE_TAB)) return STORAGE_TAB;
  const loose = live.find(title => /보관_?비관리/.test(title.replace(/\s+/g, "")));
  if (loose) return loose;
  return live.includes("보관") ? "보관" : null;
}

/** 제품DB에서 보관 탭으로 옮길 현재상태 */
export function isProductDbToStorageStatus(status: unknown): boolean {
  const key = String(status ?? "").replace(/\s+/g, "");
  return key === "거래처단종" || key === "단종" || key.startsWith("비관리");
}

const squash = (value: unknown) => String(value ?? "").replace(/\s+/g, "");
const find = (headers: string[], ...names: string[]) => headers.findIndex(header => names.some(name => squash(header) === squash(name)));

export interface CleanupMove { source: "창고재확인" | "보관" | "제품DB"; rowNumber: number; skuId: string; productName: string; result: string; orderableStatus: string; target: "보관" | "제품DB"; mode: "append" | "clear-status" | "delete-only"; productDbRow?: number; release: boolean }
export interface CleanupPlan {
  token: string;
  pending: number;
  moves: CleanupMove[];
  unknown: Array<{ rowNumber: number; skuId: string; productName: string; result: string }>;
  problems: string[];
}

function mapRow(sourceHeaders: string[], source: string[], targetHeaders: string[], overrides: Record<string, string>): string[] {
  return targetHeaders.map(header => {
    const key = squash(header);
    if (key in overrides) return overrides[key];
    const index = sourceHeaders.findIndex(value => squash(value) === key);
    return index >= 0 ? String(source[index] ?? "") : "";
  });
}

export function planWarehouseRecheckCleanup(recheck: string[][], productDb: string[][], storage: string[][] | null): CleanupPlan & { appendStorage: string[][]; appendProductDb: string[][]; clearStatusRows: number[]; deleteRows: number[]; deleteStorageRows: number[]; deleteProductDbRows: number[] } {
  const token = createHash("sha256").update(JSON.stringify([recheck, storage, productDb])).digest("hex").slice(0, 32);
  const problems: string[] = [];
  const headers = (recheck[0] || []).map(value => String(value ?? ""));
  const col = { result: find(headers, "창고 확인결과", "창고확인결과"), sku: find(headers, "SKU ID", "SKUID", "SKU"), name: find(headers, "상품명"), orderable: find(headers, "발주가능상태") };
  const hasRecheck = recheck.length > 1;
  if (hasRecheck && (col.result < 0 || col.sku < 0)) problems.push("창고재확인 탭에서 '창고 확인결과' 또는 'SKU ID' 열을 찾지 못했습니다.");
  const pdHeaders = (productDb[0] || []).map(value => String(value ?? ""));
  const pd = { sku: find(pdHeaders, "SKU ID", "SKUID"), status: find(pdHeaders, "현재상태"), orderable: find(pdHeaders, "발주가능상태") };
  if (pd.sku < 0 || pd.status < 0) problems.push("제품DB 탭에서 'SKU ID' 또는 '현재상태' 열을 찾지 못했습니다.");
  const stHeaders = (storage?.[0] || []).map(value => String(value ?? ""));
  const stSkuCol = find(stHeaders, "SKU ID", "SKUID", "SKU");
  const storageSkus = new Set<string>();
  if (storage && stSkuCol >= 0) storage.slice(1).forEach(row => { const sku = String(row[stSkuCol] ?? "").trim(); if (sku) storageSkus.add(sku); });
  const productDbRowBySku = new Map<string, number>();
  productDb.slice(1).forEach((row, index) => { const sku = String(row[pd.sku] ?? "").trim(); if (sku && !productDbRowBySku.has(sku)) productDbRowBySku.set(sku, index + 2); });
  const moves: CleanupMove[] = [], unknown: CleanupPlan["unknown"] = [];
  const appendStorage: string[][] = [], appendProductDb: string[][] = [], clearStatusRows: number[] = [], deleteRows: number[] = [];
  let pending = 0;
  if (!problems.length && hasRecheck) recheck.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    const result = String(row[col.result] ?? "").trim();
    const skuId = String(row[col.sku] ?? "").trim();
    const productName = col.name >= 0 ? String(row[col.name] ?? "").trim() : "";
    if (!skuId && !result) return;
    if (!result) { pending++; return; }
    const key = squash(result);
    const orderableHere = col.orderable >= 0 ? String(row[col.orderable] ?? "").trim() : "";
    if (key === "거래처단종") {
      if (!storage) { problems.push(`'${STORAGE_TAB}' 탭을 찾지 못했습니다.`); return; }
      // 보관 탭에 이미 같은 SKU가 있으면 다시 붙이지 않고 창고재확인에서만 지운다(중간에 실패한 뒤 다시 실행해도 중복되지 않게).
      const already = Boolean(skuId) && storageSkus.has(skuId);
      if (!already) { appendStorage.push(mapRow(headers, row, stHeaders, { "현재상태": "거래처단종" })); if (skuId) storageSkus.add(skuId); }
      moves.push({ source: "창고재확인", rowNumber, skuId, productName, result, orderableStatus: orderableHere, target: "보관", mode: already ? "delete-only" : "append", release: false });
      deleteRows.push(rowNumber);
    } else if (key === squash("제품DB로 이동(재고있음)")) {
      const existing = productDbRowBySku.get(skuId);
      const orderable = orderableHere || (existing && pd.orderable >= 0 ? String(productDb[existing - 1]?.[pd.orderable] ?? "").trim() : "");
      if (existing) clearStatusRows.push(existing);
      else appendProductDb.push(mapRow(headers, row, pdHeaders, { "현재상태": "" }));
      moves.push({ source: "창고재확인", rowNumber, skuId, productName, result, orderableStatus: orderable || "미확인", target: "제품DB", mode: existing ? "clear-status" : "append", productDbRow: existing, release: orderable !== "정상" });
      deleteRows.push(rowNumber);
    } else {
      unknown.push({ rowNumber, skuId, productName, result });
    }
  });
  // 보관 탭: 현재상태(또는 창고 확인결과)가 '제품DB로 이동(재고있음)'인 행 → 제품DB로(현재상태 비움), 보관 탭에서 삭제
  const deleteStorageRows: number[] = [];
  if (storage && !problems.length) {
    const st = { sku: find(stHeaders, "SKU ID", "SKUID", "SKU"), status: find(stHeaders, "현재상태"), result: find(stHeaders, "창고 확인결과", "창고확인결과"), name: find(stHeaders, "상품명"), orderable: find(stHeaders, "발주가능상태") };
    const planned = new Set(appendProductDb.map(row => String(row[pd.sku] ?? "").trim()));
    storage.slice(1).forEach((row, index) => {
      const rowNumber = index + 2;
      const marked = [st.status, st.result].some(column => column >= 0 && squash(row[column]) === squash("제품DB로 이동(재고있음)"));
      if (!marked) return;
      const skuId = st.sku >= 0 ? String(row[st.sku] ?? "").trim() : "";
      const productName = st.name >= 0 ? String(row[st.name] ?? "").trim() : "";
      const existing = productDbRowBySku.get(skuId);
      const orderableHere = st.orderable >= 0 ? String(row[st.orderable] ?? "").trim() : "";
      const orderable = orderableHere || (existing && pd.orderable >= 0 ? String(productDb[existing - 1]?.[pd.orderable] ?? "").trim() : "");
      if (existing) clearStatusRows.push(existing);
      else if (!planned.has(skuId)) { appendProductDb.push(mapRow(stHeaders, row, pdHeaders, { "현재상태": "", "창고확인결과": "" })); planned.add(skuId); }
      moves.push({ source: "보관", rowNumber, skuId, productName, result: "제품DB로 이동(재고있음)", orderableStatus: orderable || "미확인", target: "제품DB", mode: existing ? "clear-status" : "append", productDbRow: existing, release: orderable !== "정상" });
      deleteStorageRows.push(rowNumber);
    });
  }
  // 제품DB: 현재상태 비관리(중복등록)·거래처단종·단종 → 보관 탭, 제품DB에서 지움
  const deleteProductDbRows: number[] = [];
  if (!problems.length && pd.status >= 0) {
    const stSku = find(stHeaders, "SKU ID", "SKUID", "SKU");
    const inStorage = new Set<string>();
    const leavingStorage = new Set(deleteStorageRows);
    if (storage && stSku >= 0) storage.slice(1).forEach((row, index) => { if (!leavingStorage.has(index + 2)) inStorage.add(String(row[stSku] ?? "").trim()); });
    appendStorage.forEach(row => { if (stSku >= 0) inStorage.add(String(row[stSku] ?? "").trim()); });
    const keep = new Set(clearStatusRows);
    const pdName = find(pdHeaders, "상품명");
    productDb.slice(1).forEach((row, index) => {
      const rowNumber = index + 2;
      const status = String(row[pd.status] ?? "").trim();
      if (!isProductDbToStorageStatus(status) || keep.has(rowNumber)) return;
      if (!storage) { problems.push(`'${STORAGE_TAB}' 탭을 찾지 못했습니다.`); return; }
      const skuId = String(row[pd.sku] ?? "").trim();
      const already = Boolean(skuId) && inStorage.has(skuId);
      if (!already) { appendStorage.push(mapRow(pdHeaders, row, stHeaders, {})); if (skuId) inStorage.add(skuId); }
      moves.push({ source: "제품DB", rowNumber, skuId, productName: pdName >= 0 ? String(row[pdName] ?? "").trim() : "", result: status, orderableStatus: pd.orderable >= 0 ? String(row[pd.orderable] ?? "").trim() : "", target: STORAGE_LABEL, mode: already ? "delete-only" : "append", release: false });
      deleteProductDbRows.push(rowNumber);
    });
  }
  return { token, pending, moves, unknown, problems: [...new Set(problems)], appendStorage, appendProductDb, clearStatusRows: [...new Set(clearStatusRows)], deleteRows, deleteStorageRows, deleteProductDbRows };
}
