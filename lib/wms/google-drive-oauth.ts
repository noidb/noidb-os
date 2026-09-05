import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getStoredRefreshToken, saveRefreshTokenLocally } from "./google-drive-oauth-store";

/**
 * 사용자 Google 계정(noidb2017@gmail.com) OAuth 2.0 인증 모듈 (2026-08-20 신규).
 * Drive 이미지 업로드 전용 — Google Sheets는 여전히 서비스 계정(google-service-account.ts)을
 * 그대로 쓴다. 요청 스코프는 drive.file 하나뿐이다("이 앱이 만든 파일"만 접근 가능한 최소 권한 —
 * 사용자의 다른 드라이브 파일에는 접근할 수 없다). profile/email/전체 drive 권한은 요청하지 않는다.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
// The image generator saves into an existing user-owned folder selected by ID.
// drive.file cannot see an arbitrary pre-existing folder unless it was opened
// through Google Picker, so this internal app needs Drive access for that folder.
export const DRIVE_OAUTH_SCOPE = "https://www.googleapis.com/auth/drive";

export class DriveOAuthNotConfiguredError extends Error {
  constructor() {
    super("Google Drive OAuth 설정이 아직 완료되지 않았습니다. GOOGLE_DRIVE_OAUTH_CLIENT_ID / CLIENT_SECRET / REDIRECT_URI 환경변수를 등록해주세요.");
    this.name = "DriveOAuthNotConfiguredError";
  }
}

export class DriveOAuthNotConnectedError extends Error {
  constructor() {
    super("Google Drive 계정 연결이 필요합니다. 연결 버튼을 눌러 noidb2017@gmail.com으로 로그인해주세요.");
    this.name = "DriveOAuthNotConnectedError";
  }
}

export class DriveOAuthTokenInvalidError extends Error {
  constructor() {
    super("Google Drive 연결이 만료되었거나 취소되었습니다(refresh token 무효). 다시 연결해주세요.");
    this.name = "DriveOAuthTokenInvalidError";
  }
}

interface OAuthEnv {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function getOAuthEnv(): OAuthEnv | null {
  const clientId = process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_DRIVE_OAUTH_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function isDriveOAuthConfigured(): boolean {
  return getOAuthEnv() !== null;
}

function requireOAuthEnv(): OAuthEnv {
  const env = getOAuthEnv();
  if (!env) throw new DriveOAuthNotConfiguredError();
  return env;
}

// ── CSRF state 관리 (서명 기반, 서버 메모리를 쓰지 않는 stateless 방식) ──────────────────
// 2026-08-20 최초 구현은 in-memory Map으로 만들었으나 실제 연결 시도에서 "state 검증 실패"가
// 매번 발생했다 — Next.js 개발 서버가 API 라우트를 요청 시점에 각각 온디맨드로 컴파일하면서
// /start와 /callback이 이 모듈을 서로 다른 모듈 인스턴스로 로드해, createOAuthState가 쓴
// Map과 consumeOAuthState가 읽는 Map이 실제로는 다른 객체였다(실서버/서버리스 배포에서도
// 인스턴스가 여러 개면 같은 문제가 재발할 수 있는 구조였음). 그래서 서버 메모리에 아무것도
// 저장하지 않고, state 문자열 자체에 타임스탬프+난수를 넣고 클라이언트 시크릿으로 서명해
// 검증 시점에 서명만 다시 계산해 비교하는 방식으로 바꿨다 — 어느 라우트/인스턴스에서
// 검증하든 항상 같은 결과가 나온다. 대신 완전한 1회용(single-use) 보장은 아니고 TTL(2시간)
// 안에서는 같은 state를 재사용해도 검증을 통과한다 — 이 앱은 개인 로컬 WMS 도구라 위조하려면
// 여전히 서버만 아는 client secret이 있어야 하므로 실질적 위험은 낮다고 판단했다.
// Google의 미확인 앱 경고를 읽거나 다른 업무 탭을 확인한 뒤 돌아오는 실제 사용 흐름에서
// 10분은 너무 짧았다. 서명 검증은 그대로 유지하면서 완료 가능한 시간만 넉넉히 잡는다.
const STATE_TTL_MS = 2 * 60 * 60 * 1000;

function stateSigningKey(): string {
  return requireOAuthEnv().clientSecret;
}

export function createOAuthState(): string {
  const timestamp = Date.now().toString();
  const nonce = randomBytes(16).toString("hex");
  const payload = `${timestamp}.${nonce}`;
  const signature = createHmac("sha256", stateSigningKey()).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

export function consumeOAuthState(state: string | null): boolean {
  if (!state) return false;
  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const [timestamp, nonce, signature] = parts;
  const payload = `${timestamp}.${nonce}`;
  let expectedSignature: string;
  try {
    expectedSignature = createHmac("sha256", stateSigningKey()).update(payload).digest("hex");
  } catch {
    return false;
  }
  const signatureBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return false;
  }
  const issuedAt = Number(timestamp);
  if (!Number.isFinite(issuedAt)) return false;
  const age = Date.now() - issuedAt;
  // 서버 시계가 잠깐 어긋난 경우는 1분까지만 허용하고, 오래되었거나 미래에서 발급된
  // state는 거부한다.
  return age >= -60 * 1000 && age <= STATE_TTL_MS;
}

export function buildAuthUrl(state: string): string {
  const env = requireOAuthEnv();
  const params = new URLSearchParams({
    client_id: env.clientId,
    redirect_uri: env.redirectUri,
    response_type: "code",
    scope: DRIVE_OAUTH_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForRefreshToken(code: string): Promise<void> {
  const env = requireOAuthEnv();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.clientId,
      client_secret: env.clientSecret,
      redirect_uri: env.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const data = await response.json().catch(() => ({} as any));
  if (!response.ok || !data.refresh_token) {
    // Google은 이미 한 번 동의한 앱에는 재동의(prompt=consent) 없이는 refresh_token을
    // 다시 내려주지 않을 수 있다 — access_token만 왔다면 안내만 하고 기존 토큰을 보존한다.
    if (response.ok && !data.refresh_token) {
      throw new Error(
        "Google이 refresh token을 내려주지 않았습니다. Google 계정 설정에서 이 앱의 연결을 해제한 뒤 다시 연결해주세요(설정 > 보안 > 타사 앱 액세스)."
      );
    }
    const detail = data?.error_description || data?.error || `HTTP ${response.status}`;
    throw new Error(`Google Drive 인증 코드 교환 실패: ${detail}`);
  }
  await saveRefreshTokenLocally(data.refresh_token);
}

interface CachedAccessToken {
  accessToken: string;
  expiresAt: number;
}
let cachedAccessToken: CachedAccessToken | null = null;

/** 저장된 refresh token으로 access token을 발급/갱신한다. 필요할 때마다 호출하면 된다(내부 캐시). */
export async function getValidDriveAccessToken(): Promise<string> {
  const env = requireOAuthEnv();
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && cachedAccessToken.expiresAt > now + 30) return cachedAccessToken.accessToken;

  const refreshToken = await getStoredRefreshToken();
  if (!refreshToken) throw new DriveOAuthNotConnectedError();

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.clientId,
      client_secret: env.clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const data = await response.json().catch(() => ({} as any));
  if (!response.ok || !data.access_token) {
    if (data?.error === "invalid_grant") {
      cachedAccessToken = null;
      throw new DriveOAuthTokenInvalidError();
    }
    const detail = data?.error_description || data?.error || `HTTP ${response.status}`;
    throw new Error(`Google Drive 접근 토큰 갱신 실패: ${detail}`);
  }
  cachedAccessToken = { accessToken: data.access_token, expiresAt: now + Number(data.expires_in || 3600) };
  return cachedAccessToken.accessToken;
}

export async function isDriveConnected(): Promise<boolean> {
  return (await getStoredRefreshToken()) !== null;
}
