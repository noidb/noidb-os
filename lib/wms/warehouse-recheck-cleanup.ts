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
 */
export const RECHECK_TAB = "창고재확인";
export const STORAGE_TAB = "보관";

const squash = (value: unknown) => String(value ?? "").replace(/\s+/g, "");
const find = (headers: string[], ...names: string[]) => headers.findIndex(header => names.some(name => squash(header) === squash(name)));

export interface CleanupMove { rowNumber: number; skuId: string; productName: string; result: string; orderableStatus: string; target: "보관" | "제품DB"; mode: "append" | "clear-status"; productDbRow?: number; release: boolean }
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

export function planWarehouseRecheckCleanup(recheck: string[][], productDb: string[][], storage: string[][] | null): CleanupPlan & { appendStorage: string[][]; appendProductDb: string[][]; clearStatusRows: number[]; deleteRows: number[] } {
  const token = createHash("sha256").update(JSON.stringify(recheck)).digest("hex").slice(0, 32);
  const problems: string[] = [];
  const headers = (recheck[0] || []).map(value => String(value ?? ""));
  const col = { result: find(headers, "창고 확인결과", "창고확인결과"), sku: find(headers, "SKU ID", "SKUID", "SKU"), name: find(headers, "상품명"), orderable: find(headers, "발주가능상태") };
  if (col.result < 0 || col.sku < 0) problems.push("창고재확인 탭에서 '창고 확인결과' 또는 'SKU ID' 열을 찾지 못했습니다.");
  const pdHeaders = (productDb[0] || []).map(value => String(value ?? ""));
  const pd = { sku: find(pdHeaders, "SKU ID", "SKUID"), status: find(pdHeaders, "현재상태"), orderable: find(pdHeaders, "발주가능상태") };
  if (pd.sku < 0 || pd.status < 0) problems.push("제품DB 탭에서 'SKU ID' 또는 '현재상태' 열을 찾지 못했습니다.");
  const stHeaders = (storage?.[0] || []).map(value => String(value ?? ""));
  const productDbRowBySku = new Map<string, number>();
  productDb.slice(1).forEach((row, index) => { const sku = String(row[pd.sku] ?? "").trim(); if (sku && !productDbRowBySku.has(sku)) productDbRowBySku.set(sku, index + 2); });
  const moves: CleanupMove[] = [], unknown: CleanupPlan["unknown"] = [];
  const appendStorage: string[][] = [], appendProductDb: string[][] = [], clearStatusRows: number[] = [], deleteRows: number[] = [];
  let pending = 0;
  if (!problems.length) recheck.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    const result = String(row[col.result] ?? "").trim();
    const skuId = String(row[col.sku] ?? "").trim();
    const productName = col.name >= 0 ? String(row[col.name] ?? "").trim() : "";
    if (!skuId && !result) return;
    if (!result) { pending++; return; }
    const key = squash(result);
    const orderableHere = col.orderable >= 0 ? String(row[col.orderable] ?? "").trim() : "";
    if (key === "거래처단종") {
      if (!storage) { problems.push("'보관' 탭을 찾지 못했습니다."); return; }
      appendStorage.push(mapRow(headers, row, stHeaders, { "현재상태": "거래처단종" }));
      moves.push({ rowNumber, skuId, productName, result, orderableStatus: orderableHere, target: "보관", mode: "append", release: false });
      deleteRows.push(rowNumber);
    } else if (key === squash("제품DB로 이동(재고있음)")) {
      const existing = productDbRowBySku.get(skuId);
      const orderable = orderableHere || (existing && pd.orderable >= 0 ? String(productDb[existing - 1]?.[pd.orderable] ?? "").trim() : "");
      if (existing) clearStatusRows.push(existing);
      else appendProductDb.push(mapRow(headers, row, pdHeaders, { "현재상태": "" }));
      moves.push({ rowNumber, skuId, productName, result, orderableStatus: orderable || "미확인", target: "제품DB", mode: existing ? "clear-status" : "append", productDbRow: existing, release: orderable !== "정상" });
      deleteRows.push(rowNumber);
    } else {
      unknown.push({ rowNumber, skuId, productName, result });
    }
  });
  return { token, pending, moves, unknown, problems: [...new Set(problems)], appendStorage, appendProductDb, clearStatusRows, deleteRows };
}
