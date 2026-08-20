import { createSign } from "node:crypto";

/**
 * NOID WMS 서비스 계정 OAuth 토큰 발급 공용 모듈. google-sheets.ts(제품DB 시트 읽기/쓰기) 전용이다.
 *
 * 2026-08-20부터: 이미지 업로드는 더 이상 이 서비스 계정을 쓰지 않는다 — 서비스 계정은
 * Drive 저장 할당량이 0이라("Service Accounts do not have storage quota") 개인 계정의
 * "내 드라이브"에 파일을 직접 소유할 수 없다는 사실이 실제 Drive API 조회로 확인됐다.
 * 이미지 업로드는 lib/wms/google-drive-oauth.ts + google-drive-user.ts(사용자 OAuth,
 * drive.file 스코프)로 분리했다 — 사용자 본인 계정의 저장 용량을 쓴다.
 * 이 모듈의 스코프는 이제 spreadsheets 하나뿐이다.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"].join(" ");

export class WmsGoogleNotConfiguredError extends Error {
  constructor() {
    super("구글 연결이 아직 설정되지 않았습니다. 서비스 계정 환경변수를 등록해주세요.");
    this.name = "WmsGoogleNotConfiguredError";
  }
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

export function isWmsGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SHEETS_WMS_CLIENT_EMAIL && process.env.GOOGLE_SHEETS_WMS_PRIVATE_KEY);
}

function base64url(input: Buffer | string): string {
  const buffer = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Vercel 등에 개행이 \n 문자열로 저장된 private key를 실제 개행으로 복원한다. */
function normalizePrivateKey(key: string): string {
  return key.includes("\\n") ? key.replace(/\\n/g, "\n") : key;
}

export async function getWmsGoogleAccessToken(): Promise<string> {
  const clientEmail = process.env.GOOGLE_SHEETS_WMS_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_SHEETS_WMS_PRIVATE_KEY;
  if (!clientEmail || !privateKey) throw new WmsGoogleNotConfiguredError();

  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 30) return cachedToken.accessToken;

  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claimSet = base64url(
    JSON.stringify({ iss: clientEmail, scope: SCOPES, aud: TOKEN_URL, iat: now, exp: now + 3600 })
  );
  const signInput = `${header}.${claimSet}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signInput);
  signer.end();
  const signature = base64url(signer.sign(normalizePrivateKey(privateKey)));
  const jwt = `${signInput}.${signature}`;

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const data = await response.json().catch(() => ({} as any));
  if (!response.ok || !data.access_token) {
    const detail = data?.error_description || data?.error || `HTTP ${response.status}`;
    throw new Error(`Google 인증 토큰 발급 실패: ${detail}`);
  }
  cachedToken = { accessToken: data.access_token, expiresAt: now + Number(data.expires_in || 3600) };
  return cachedToken.accessToken;
}
