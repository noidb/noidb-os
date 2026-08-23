import { inferCategory, inferGender } from "./category-order";
import { fetchSheetRows, updateSheetCells, type SheetCellUpdate } from "./google-sheets";
import { PRODUCT_DB_SHEET_NAME } from "./product-catalog";

export interface ClassificationBackfillPlan {
  rowCount: number; updates: SheetCellUpdate[]; genderUpdates: number; categoryUpdates: number;
  unclassifiedGenderCount: number; unclassifiedCategoryCount: number;
  examples: { row: number; skuId: string; productName: string; gender?: string; category?: string }[];
}
function column(headers: string[], name: string) { const index = headers.indexOf(name); if (index < 0) throw new Error(`제품DB 시트에 '${name}' 헤더가 없습니다.`); return index; }

export function planClassificationBackfill(rows: string[][]): ClassificationBackfillPlan {
  if (!rows.length) throw new Error("제품DB 시트가 비어 있습니다.");
  const headers = rows[0].map(value => String(value || "").trim());
  const skuCol = column(headers, "SKU ID");
  const nameCol = column(headers, "상품명");
  const genderCol = column(headers, "성별");
  const categoryCol = column(headers, "카테고리");
  const updates: SheetCellUpdate[] = [];
  const examples: ClassificationBackfillPlan["examples"] = [];
  let genderUpdates = 0; let categoryUpdates = 0; let unclassifiedGenderCount = 0; let unclassifiedCategoryCount = 0;
  rows.slice(1).forEach((row, index) => {
    const sheetRow = index + 2; const productName = String(row[nameCol] || "").trim(); const skuId = String(row[skuCol] || "").trim();
    const genderBlank = !String(row[genderCol] || "").trim(); const categoryBlank = !String(row[categoryCol] || "").trim();
    const gender = genderBlank ? inferGender(productName) : ""; const category = categoryBlank ? inferCategory(productName) : "";
    if (genderBlank && gender) { updates.push({ row: sheetRow, col: genderCol + 1, value: gender }); genderUpdates += 1; }
    else if (genderBlank) unclassifiedGenderCount += 1;
    if (categoryBlank && category) { updates.push({ row: sheetRow, col: categoryCol + 1, value: category }); categoryUpdates += 1; }
    else if (categoryBlank) unclassifiedCategoryCount += 1;
    if ((gender || category) && examples.length < 10) examples.push({ row: sheetRow, skuId, productName, ...(gender ? { gender } : {}), ...(category ? { category } : {}) });
  });
  return { rowCount: rows.length - 1, updates, genderUpdates, categoryUpdates, unclassifiedGenderCount, unclassifiedCategoryCount, examples };
}

export async function previewClassificationBackfill() { return planClassificationBackfill(await fetchSheetRows(PRODUCT_DB_SHEET_NAME)); }
export async function applyClassificationBackfill() {
  const before = await previewClassificationBackfill();
  console.info("[제품DB 분류 자동보완] 적용 전", { targetCells: before.updates.length, genderUpdates: before.genderUpdates, categoryUpdates: before.categoryUpdates, examples: before.examples });
  await updateSheetCells(PRODUCT_DB_SHEET_NAME, before.updates);
  const after = await previewClassificationBackfill();
  return { appliedCount: before.updates.length, genderAppliedCount: before.genderUpdates, categoryAppliedCount: before.categoryUpdates, unclassifiedGenderCount: after.unclassifiedGenderCount, unclassifiedCategoryCount: after.unclassifiedCategoryCount, examples: before.examples };
}
