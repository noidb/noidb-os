/**
 * SKU 한 줄 찾기 (사용자 요청 2026-10-14).
 * 제품DB에서 먼저 찾고, 없으면 보관·창고재확인·재등록SKU 등 'SKU ID' 열이 있는 다른 보이는 탭을 모두 찾아본다.
 * 단종됐다가 다시 입고된 상품은 제품DB가 아니라 다른 탭에만 있을 수 있기 때문이다.
 * '_'로 시작하는 숨김 이력 탭은 보지 않는다.
 */
import { fetchSheetRows, fetchSpreadsheetTabs, getWmsSpreadsheetId, type SheetValueRenderOption } from "./google-sheets";
import { getWmsGoogleAccessToken } from "./google-service-account";
import { normalizeSkuId, PRODUCT_DB_SHEET_NAME } from "./product-catalog";

export interface ProductRowMatch {
  sheetName: string;
  /** 1-based 시트 행 번호 */
  rowNumber: number;
  /** 0-based 헤더 행 위치 (보통 0) */
  headerRowIndex: number;
  headers: string[];
  values: string[];
  /** 찾은 탭의 전체 값 */
  rows: string[][];
}

const HEADER_SCAN_ROWS = 5;

/** 탭 값에서 SKU를 찾는다. 같은 탭 안 중복은 쓰기 사고를 막기 위해 오류로 멈춘다. */
export function findSkuInRows(sheetName: string, rows: string[][], skuId: string): ProductRowMatch | null {
  const target = normalizeSkuId(skuId);
  const headerRowIndex = rows.slice(0, HEADER_SCAN_ROWS).findIndex(row => (row || []).some(cell => String(cell ?? "").trim() === "SKU ID"));
  if (!target || headerRowIndex < 0) return null;
  const headers = rows[headerRowIndex].map(value => String(value ?? "").trim());
  const skuColumn = headers.indexOf("SKU ID");
  const matches = rows.map((row, index) => ({ row, index }))
    .filter(entry => entry.index > headerRowIndex && normalizeSkuId(entry.row?.[skuColumn]) === target);
  if (!matches.length) return null;
  if (matches.length > 1) throw new Error(`${sheetName} 탭에 SKU ID "${skuId}"가 ${matches.length}건 중복되어 쓰기를 중단했습니다.`);
  return { sheetName, rowNumber: matches[0].index + 1, headerRowIndex, headers, values: (matches[0].row || []).map(v => String(v ?? "")), rows };
}

async function batchGet(sheetNames: string[], renderOption: SheetValueRenderOption): Promise<Map<string, string[][]>> {
  const result = new Map<string, string[][]>();
  if (!sheetNames.length) return result;
  const ranges = sheetNames.map(name => `ranges=${encodeURIComponent(`'${name.replace(/'/g, "''")}'`)}`).join("&");
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${getWmsSpreadsheetId()}/values:batchGet?${ranges}&valueRenderOption=${renderOption}`, {
    headers: { Authorization: `Bearer ${await getWmsGoogleAccessToken()}` }, cache: "no-store",
  });
  const data = await response.json().catch(() => ({} as any));
  if (!response.ok) throw new Error(`전체 탭 조회 실패: ${data?.error?.message || `HTTP ${response.status}`}`);
  (data.valueRanges || []).forEach((range: any, index: number) => result.set(sheetNames[index], (range?.values as string[][]) || []));
  return result;
}

/** 제품DB → 다른 보이는 탭 순서로 SKU를 찾는다. 어디에도 없으면 null. */
export async function findProductRowAnyTab(skuId: string, options: { valueRenderOption?: SheetValueRenderOption } = {}): Promise<ProductRowMatch | null> {
  const renderOption = options.valueRenderOption || "FORMATTED_VALUE";
  const productRows = await fetchSheetRows(PRODUCT_DB_SHEET_NAME, { valueRenderOption: renderOption });
  if (!productRows.length) throw new Error("제품DB를 읽을 수 없습니다.");
  const inProductDb = findSkuInRows(PRODUCT_DB_SHEET_NAME, productRows, skuId);
  if (inProductDb) return inProductDb;
  const others = (await fetchSpreadsheetTabs())
    .filter(tab => !tab.hidden && tab.title !== PRODUCT_DB_SHEET_NAME && !tab.title.startsWith("_"))
    .map(tab => tab.title);
  const values = await batchGet(others, renderOption);
  for (const name of others) {
    const match = findSkuInRows(name, values.get(name) || [], skuId);
    if (match) return match;
  }
  return null;
}

export function notFoundAnyTabMessage(skuId: string) {
  return `제품DB와 다른 탭 어디에서도 SKU ID "${skuId}"를 찾을 수 없습니다.`;
}
