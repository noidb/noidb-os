import { fetchSheetRows, updateSheetCells, type SheetCellUpdate } from "./google-sheets";
import { PRODUCT_DB_SHEET_NAME } from "./product-catalog";
import { normalizeSkuId } from "./sku-normalize";
import type { DiscontinueMarkResult } from "./discontinue-mark-message";
export type { DiscontinueMarkResult };

/**
 * 단종서류(단종신청 엑셀·공문)를 만든 SKU가 제품DB에 있으면 현재상태를 '거래처단종'으로 적는다(사용자 요청 2026-10-19).
 * - 이미 거래처단종·단종(같은 취급)이면 그대로 둔다.
 * - 판매중지·가품중단은 뜻이 달라(재등록 끝난 옛 SKU·가품) 덮어쓰지 않는다.
 * - 제품DB에 없는 SKU는 건드리지 않는다.
 */
export const DISCONTINUE_MARK_STATUS = "거래처단종";
const KEEP_STATUSES = ["거래처단종", "단종", "판매중지", "가품중단"];
const squash = (value: unknown) => String(value ?? "").replace(/\s+/g, "");

export type DiscontinueMarkPlan = { updates: SheetCellUpdate[]; marked: string[]; kept: { skuId: string; status: string }[]; notInDb: string[]; problem?: string };

export function planDiscontinueMark(rows: readonly (readonly unknown[])[], skuIds: readonly string[]): DiscontinueMarkPlan {
  const wanted = [...new Set(skuIds.map(id => normalizeSkuId(id)).filter(Boolean))];
  const headers = (rows[0] || []).map(squash);
  const skuCol = headers.findIndex(header => header === "SKUID");
  const statusCol = headers.findIndex(header => header === "현재상태");
  if (skuCol < 0 || statusCol < 0) return { updates: [], marked: [], kept: [], notInDb: wanted, problem: "제품DB에서 'SKU ID' 또는 '현재상태' 열을 찾지 못했습니다." };
  const rowsBySku = new Map<string, number[]>();
  rows.slice(1).forEach((row, index) => {
    const sku = normalizeSkuId(String(row[skuCol] ?? ""));
    if (sku) rowsBySku.set(sku, [...(rowsBySku.get(sku) || []), index + 2]);
  });
  const plan: DiscontinueMarkPlan = { updates: [], marked: [], kept: [], notInDb: [] };
  for (const skuId of wanted) {
    const rowNumbers = rowsBySku.get(skuId);
    if (!rowNumbers) { plan.notInDb.push(skuId); continue; }
    let changed = false;
    for (const row of rowNumbers) {
      const status = String(rows[row - 1]?.[statusCol] ?? "").trim();
      if (KEEP_STATUSES.some(keep => squash(keep) === squash(status))) { if (/판매중지|가품중단/.test(status)) plan.kept.push({ skuId, status }); continue; }
      plan.updates.push({ row, col: statusCol + 1, value: DISCONTINUE_MARK_STATUS });
      changed = true;
    }
    if (changed) plan.marked.push(skuId);
  }
  return plan;
}

/** 파일 만들기는 이미 끝났으므로, 여기서 실패해도 오류로 막지 않고 안내만 돌려준다. */
export async function markDiscontinuedInProductDb(skuIds: readonly string[]): Promise<DiscontinueMarkResult> {
  try {
    const rows = await fetchSheetRows(PRODUCT_DB_SHEET_NAME);
    const plan = planDiscontinueMark(rows, skuIds);
    if (plan.problem) return { marked: 0, kept: [], notInDb: plan.notInDb.length, warning: plan.problem };
    await updateSheetCells(PRODUCT_DB_SHEET_NAME, plan.updates);
    return { marked: plan.marked.length, kept: plan.kept, notInDb: plan.notInDb.length };
  } catch (error) {
    return { marked: 0, kept: [], notInDb: 0, warning: `제품DB 현재상태를 적지 못했습니다(${error instanceof Error ? error.message : "알 수 없는 오류"}). 다시 만들거나 직접 적어 주세요.` };
  }
}
