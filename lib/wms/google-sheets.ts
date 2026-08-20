import { getWmsGoogleAccessToken, isWmsGoogleConfigured, WmsGoogleNotConfiguredError } from "./google-service-account";

/**
 * NOID WMS 전용 Google Sheets 클라이언트.
 *
 * 기존 app/api/google-sheet/route.ts(Apps Script 웹훅) 방식과는 완전히 분리된
 * 별도 연동입니다. 서비스 계정으로 Google Sheets API v4를 직접 호출합니다.
 *
 * 2026-08-19까지: 읽기 전용(fetchSheetRows)만 존재했습니다.
 * 2026-08-19부터: 상품 상세 화면에서 사용자가 명시적으로 저장을 누른 항목만 지정된 셀에
 * targeted로 쓰는 updateSheetCells 함수가 추가되었습니다 — 이 함수는 사용자가 화면에서 직접
 * 트리거할 때만 호출되며, 시트 전체를 덮어쓰거나 임의의 범위를 자동으로 수정하지 않습니다.
 * 자세한 사용처는 lib/wms/product-catalog-write.ts 참고. 인증 토큰 발급은
 * lib/wms/google-service-account.ts가 전담한다.
 *
 * 2026-08-20부터: 이 서비스 계정은 Sheets 전용이다. 이미지 업로드는 서비스 계정의 Drive 저장
 * 할당량이 0이라 별도로 사용자 OAuth(lib/wms/google-drive-oauth.ts)로 옮겼다 — 더 이상
 * 이 모듈과 스코프를 공유하지 않는다.
 *
 * 설정 방법: docs/GOOGLE_SHEETS_SETUP.md 참고.
 */

const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

/** 사용자가 안내받은 스프레드시트("노이드비 상품DB")의 기본 ID. 환경변수로 덮어쓸 수 있다. */
const DEFAULT_SPREADSHEET_ID = "15JXGpVzk4xiwCCcGRKwCPbI7gnIcmVyvffdumbCyFpA";

export const WmsGoogleSheetsNotConfiguredError = WmsGoogleNotConfiguredError;
export const isWmsGoogleSheetsConfigured = isWmsGoogleConfigured;

export type SheetValueRenderOption = "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA";

export function getWmsSpreadsheetId(): string {
  return process.env.GOOGLE_SHEETS_WMS_SPREADSHEET_ID?.trim() || DEFAULT_SPREADSHEET_ID;
}

/** 지정한 시트 탭의 전체 값을 2차원 배열로 읽어온다 (읽기 전용). */
export async function fetchSheetRows(
  sheetName: string,
  options?: { valueRenderOption?: SheetValueRenderOption }
): Promise<string[][]> {
  const accessToken = await getWmsGoogleAccessToken();
  const spreadsheetId = getWmsSpreadsheetId();
  const range = encodeURIComponent(`'${sheetName}'`);
  const renderOption = options?.valueRenderOption || "FORMATTED_VALUE";
  const url = `${SHEETS_API_BASE}/${spreadsheetId}/values/${range}?valueRenderOption=${renderOption}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({} as any));
  if (!response.ok) {
    const detail = data?.error?.message || `HTTP ${response.status}`;
    throw new Error(`[${sheetName}] 구글시트 조회 실패: ${detail}`);
  }
  return (data.values as string[][]) || [];
}

export interface SheetCellUpdate {
  /** 1-based 행 번호 (헤더 행 포함, 시트에 보이는 행 번호 그대로) */
  row: number;
  /** 1-based 열 번호 (A=1, B=2, ...) */
  col: number;
  value: string;
}

/** 1-based 열 번호를 A1 표기 열 문자로 바꾼다 (1→A, 27→AA). */
function columnIndexToLetter(index: number): string {
  let n = index;
  let letters = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/**
 * 지정한 셀들만 정확히 골라서 업데이트한다 (values:batchUpdate, valueInputOption=RAW).
 * 시트 전체나 범위를 덮어쓰지 않고, 호출한 쪽이 명시한 (행, 열) 좌표의 셀만 건드린다.
 * 이 함수는 어디서도 자동으로 호출되지 않으며, 사용자가 화면에서 저장을 눌렀을 때만 호출된다.
 */
export async function updateSheetCells(sheetName: string, updates: SheetCellUpdate[]): Promise<void> {
  if (updates.length === 0) return;
  const accessToken = await getWmsGoogleAccessToken();
  const spreadsheetId = getWmsSpreadsheetId();
  const url = `${SHEETS_API_BASE}/${spreadsheetId}/values:batchUpdate`;

  const body = {
    valueInputOption: "RAW",
    data: updates.map(update => ({
      range: `'${sheetName}'!${columnIndexToLetter(update.col)}${update.row}`,
      values: [[update.value]],
    })),
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({} as any));
  if (!response.ok) {
    const detail = data?.error?.message || `HTTP ${response.status}`;
    throw new Error(`[${sheetName}] 구글시트 쓰기 실패: ${detail}`);
  }
}

/** 첫 행을 헤더로 사용해 각 행을 { 헤더명: 값 } 객체로 변환한다. */
export function rowsToObjects(rows: string[][]): Record<string, string>[] {
  if (!rows.length) return [];
  const headers = rows[0].map(header => String(header || "").trim());
  return rows
    .slice(1)
    .filter(row => row.some(cell => String(cell ?? "").trim()))
    .map(row => Object.fromEntries(headers.map((header, index) => [header, String(row[index] ?? "").trim()])));
}
