import { createSign } from "node:crypto";

/**
 * NOID WMS 전용 Google Sheets 읽기 전용 클라이언트.
 *
 * 기존 app/api/google-sheet/route.ts(Apps Script 웹훅) 방식과는 완전히 분리된
 * 별도 연동입니다. 서비스 계정으로 Google Sheets API v4를 직접 호출하며,
 * 쓰기(values.update / values.append 등) 함수는 이 파일에 존재하지 않습니다.
 *
 * 설정 방법: docs/GOOGLE_SHEETS_SETUP.md 참고.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

/** 사용자가 안내받은 스프레드시트("노이드비 상품DB")의 기본 ID. 환경변수로 덮어쓸 수 있다. */
const DEFAULT_SPREADSHEET_ID = "15JXGpVzk4xiwCCcGRKwCPbI7gnIcmVyvffdumbCyFpA";

export class WmsGoogleSheetsNotConfiguredError extends Error {
  constructor() {
    super("구글시트 연결이 아직 설정되지 않았습니다. 서비스 계정 환경변수를 등록해주세요.");
    this.name = "WmsGoogleSheetsNotConfiguredError";
  }
}

export type SheetValueRenderOption = "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA";

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

export function getWmsSpreadsheetId(): string {
  return process.env.GOOGLE_SHEETS_WMS_SPREADSHEET_ID?.trim() || DEFAULT_SPREADSHEET_ID;
}

/** 환경변수 존재 여부만 확인한다. 값 자체는 어디에도 로그/응답으로 노출하지 않는다. */
export function isWmsGoogleSheetsConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SHEETS_WMS_CLIENT_EMAIL &&
    process.env.GOOGLE_SHEETS_WMS_PRIVATE_KEY
  );
}

function base64url(input: Buffer | string): string {
  const buffer = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Vercel 등에 개행이 \n 문자열로 저장된 private key를 실제 개행으로 복원한다. */
function normalizePrivateKey(key: string): string {
  return key.includes("\\n") ? key.replace(/\\n/g, "\n") : key;
}

async function fetchAccessToken(): Promise<string> {
  const clientEmail = process.env.GOOGLE_SHEETS_WMS_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_SHEETS_WMS_PRIVATE_KEY;
  if (!clientEmail || !privateKey) throw new WmsGoogleSheetsNotConfiguredError();

  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 30) return cachedToken.accessToken;

  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claimSet = base64url(JSON.stringify({
    iss: clientEmail,
    scope: READONLY_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const signInput = `${header}.${claimSet}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signInput);
  signer.end();
  const signature = base64url(signer.sign(normalizePrivateKey(privateKey)));
  const jwt = `${signInput}.${signature}`;

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await response.json().catch(() => ({} as any));
  if (!response.ok || !data.access_token) {
    const detail = data?.error_description || data?.error || `HTTP ${response.status}`;
    throw new Error(`Google 인증 토큰 발급 실패: ${detail}`);
  }
  cachedToken = { accessToken: data.access_token, expiresAt: now + Number(data.expires_in || 3600) };
  return cachedToken.accessToken;
}

/** 지정한 시트 탭의 전체 값을 2차원 배열로 읽어온다 (읽기 전용). */
export async function fetchSheetRows(
  sheetName: string,
  options?: { valueRenderOption?: SheetValueRenderOption }
): Promise<string[][]> {
  const accessToken = await fetchAccessToken();
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

/** 첫 행을 헤더로 사용해 각 행을 { 헤더명: 값 } 객체로 변환한다. */
export function rowsToObjects(rows: string[][]): Record<string, string>[] {
  if (!rows.length) return [];
  const headers = rows[0].map(header => String(header || "").trim());
  return rows
    .slice(1)
    .filter(row => row.some(cell => String(cell ?? "").trim()))
    .map(row => Object.fromEntries(headers.map((header, index) => [header, String(row[index] ?? "").trim()])));
}
