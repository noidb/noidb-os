import { backupSheetWithinSpreadsheet, fetchSheetRows, updateSheetCells, type SheetCellUpdate } from "./google-sheets";
import { PRODUCT_DB_SHEET_NAME } from "./product-catalog";

export const REGISTRATION_FILE_CREATED_STATUS = "등록파일생성";

function normalize(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function findHeader(headers: string[], candidates: string[]): number {
  return headers.findIndex(header => candidates.some(candidate => normalize(header) === normalize(candidate)));
}

export function buildRegistrationFileStageUpdates(
  sheetRows: string[][],
  model: string,
  expectedModelSkus: string[]
): SheetCellUpdate[] {
  const headers = (sheetRows[0] || []).map(value => String(value ?? "").trim());
  const statusIndex = findHeader(headers, ["현재상태", "상태"]);
  const modelIndex = findHeader(headers, ["모델명/품번", "모델명"]);
  const modelSkuIndex = findHeader(headers, ["모델SKU"]);
  if ([statusIndex, modelIndex, modelSkuIndex].some(index => index < 0)) throw new Error("제품DB에서 현재상태·모델명/품번·모델SKU 열을 찾지 못했습니다.");

  const expected = [...new Set(expectedModelSkus.map(normalize).filter(Boolean))];
  if (!model.trim() || expected.length === 0) throw new Error("등록파일생성 상태로 표시할 모델 또는 모델SKU가 없습니다.");
  const candidates = sheetRows.slice(1).map((row, index) => ({ row, sheetRowNumber: index + 2 }))
    .filter(({ row }) => normalize(row[modelIndex]) === normalize(model));
  if (candidates.length !== expected.length) throw new Error(`${model}: 생성된 제품DB 행 ${candidates.length}개와 예상 모델SKU ${expected.length}개가 다릅니다.`);
  const actualKeys = new Set(candidates.map(({ row }) => normalize(row[modelSkuIndex])));
  if (actualKeys.size !== expected.length || expected.some(key => !actualKeys.has(key))) throw new Error(`${model}: 모델SKU가 중복되거나 누락되어 상태를 변경하지 않았습니다.`);

  const allowedStatuses = new Set(["", "신상승인대기", REGISTRATION_FILE_CREATED_STATUS]);
  for (const { row } of candidates) {
    const status = String(row[statusIndex] ?? "").trim();
    if (!allowedStatuses.has(status)) throw new Error(`${model}: 보호해야 할 기존 상태 "${status}"가 있어 변경하지 않았습니다.`);
  }
  return candidates.filter(({ row }) => String(row[statusIndex] ?? "").trim() !== REGISTRATION_FILE_CREATED_STATUS)
    .map(({ sheetRowNumber }) => ({ row: sheetRowNumber, col: statusIndex + 1, value: REGISTRATION_FILE_CREATED_STATUS }));
}

/** 새 모델의 파일 생성 직후에만 호출한다. 제품DB 신규행을 다시 만들지 않고 생성된 행의 상태만 표시한다. */
export async function markRegistrationFilesCreated(model: string, expectedModelSkus: string[]) {
  const before = await fetchSheetRows(PRODUCT_DB_SHEET_NAME, { valueRenderOption: "FORMULA" });
  const updates = buildRegistrationFileStageUpdates(before, model, expectedModelSkus);
  if (updates.length === 0) return { updatedRows: 0 };
  const backup = await backupSheetWithinSpreadsheet(PRODUCT_DB_SHEET_NAME);
  const rechecked = await fetchSheetRows(PRODUCT_DB_SHEET_NAME, { valueRenderOption: "FORMULA" });
  const recheckedUpdates = buildRegistrationFileStageUpdates(rechecked, model, expectedModelSkus);
  if (JSON.stringify(recheckedUpdates) !== JSON.stringify(updates)) throw new Error("제품DB가 상태 확인 중 변경되었습니다. 다시 저장해주세요.");
  await updateSheetCells(PRODUCT_DB_SHEET_NAME, updates);
  return { updatedRows: updates.length, backupSheetName: backup.sheetName };
}
