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

export async function batchGet(sheetNames: string[], renderOption: SheetValueRenderOption): Promise<Map<string, string[][]>> {
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

export interface CodeLookupResult {
  /** 입력한 바코드 또는 SKU ID */
  code: string;
  matches: { skuId: string; productName: string; barcode: string; sheetName: string }[];
}

/**
 * 바코드나 SKU ID 목록으로 상품을 찾는다(2026-10-15 — 출력하고 남은 바코드 라벨로 단종서류 만들기).
 * 읽기 전용이라 전 탭을 본다(2026-10-19 — 보관 탭 '_보관_비관리SKU_…'으로 옮긴 SKU의 상품명이 안 나왔음).
 * 순서: 제품DB → 보관 탭 → 보이는 다른 탭 → '_' 이력·숨김 탭. 같은 SKU는 먼저 찾은 탭 값을 쓴다.
 * 탭마다 칸 이름이 조금 달라도(SKU / SKU ID, 상품명 / 제품명) 찾는다.
 */
export async function lookupCodesAnyTab(codes: string[]): Promise<CodeLookupResult[]> {
  const all = await fetchSpreadsheetTabs();
  const rank = (tab: { title: string; hidden?: boolean }) => tab.title === PRODUCT_DB_SHEET_NAME ? 0 : tab.title.includes("보관") ? 1 : !tab.hidden && !tab.title.startsWith("_") ? 2 : 3;
  const ordered = [...all].sort((a, b) => rank(a) - rank(b)).map(tab => tab.title);
  if (!ordered.includes(PRODUCT_DB_SHEET_NAME)) ordered.unshift(PRODUCT_DB_SHEET_NAME);
  const values = await batchGet(ordered, "FORMATTED_VALUE");
  if (!(values.get(PRODUCT_DB_SHEET_NAME) || []).length) throw new Error("제품DB를 읽을 수 없습니다.");
  const squash = (value: unknown) => String(value ?? "").replace(/\s+/g, "");
  const findColumn = (headers: string[], exact: string[], loose?: (header: string) => boolean) => {
    const hit = headers.findIndex(header => exact.some(name => squash(header) === squash(name)));
    return hit >= 0 || !loose ? hit : headers.findIndex(header => loose(squash(header)));
  };
  const skuHeader = (header: string) => /SKU/i.test(header) && !/모델|새|이전|신규|교체/.test(header);
  const bySku = new Map<string, CodeLookupResult["matches"][number]>();
  const byBarcode = new Map<string, CodeLookupResult["matches"]>();
  for (const sheetName of ordered) {
    const rows = values.get(sheetName) || [];
    const headerRowIndex = rows.slice(0, HEADER_SCAN_ROWS).findIndex(row => (row || []).some(cell => skuHeader(squash(cell))));
    if (headerRowIndex < 0) continue;
    const headers = rows[headerRowIndex].map(value => String(value ?? "").trim());
    const skuColumn = findColumn(headers, ["SKU ID", "SKUID"], skuHeader);
    const nameColumn = findColumn(headers, ["상품명", "제품명"], header => header.includes("상품명") || header.includes("제품명"));
    const barcodeColumn = findColumn(headers, ["바코드"], header => header.includes("바코드"));
    if (skuColumn < 0) continue;
    for (const row of rows.slice(headerRowIndex + 1)) {
      const skuId = normalizeSkuId(row?.[skuColumn]);
      if (!/^\d{1,20}$/.test(skuId)) continue;
      const productName = String(nameColumn >= 0 ? row?.[nameColumn] ?? "" : "").trim();
      const found = bySku.get(skuId);
      if (found) { if (!found.productName && productName) found.productName = productName; continue; } // 먼저 찾은 탭 값을 쓰되, 상품명이 비었으면 채운다.
      const entry = { skuId, productName, barcode: String(barcodeColumn >= 0 ? row?.[barcodeColumn] ?? "" : "").trim().toUpperCase(), sheetName };
      bySku.set(skuId, entry);
      if (entry.barcode) byBarcode.set(entry.barcode, [...(byBarcode.get(entry.barcode) || []), entry]);
    }
  }
  return codes.map(code => {
    const trimmed = code.trim().toUpperCase();
    const viaBarcode = byBarcode.get(trimmed);
    if (viaBarcode?.length) return { code, matches: viaBarcode };
    const viaSku = bySku.get(normalizeSkuId(trimmed));
    return { code, matches: viaSku ? [viaSku] : [] };
  });
}
