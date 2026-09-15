import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * 사이트 로그인 세션 쿠키의 발급/검증만 담당한다. 이 모듈은 아직 어떤 API route에도
 * 연결되어 있지 않다 — 기존 상품등록/WMS/쿠팡 API는 이 단계에서 건드리지 않는다.
 */

export const SESSION_COOKIE_NAME = "noidb_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7일

export class SessionConfigError extends Error {}

type SessionPayload = {
  iat: number;
  exp: number;
  nonce: string;
};

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new SessionConfigError("SESSION_SECRET 환경변수가 설정되지 않았습니다.");
  return secret;
}

function getSiteAccessPassword(): string {
  const password = process.env.SITE_ACCESS_PASSWORD;
  if (!password) throw new SessionConfigError("SITE_ACCESS_PASSWORD 환경변수가 설정되지 않았습니다.");
  return password;
}

// 길이가 다른 입력도 고정 길이 해시로 바꿔 timingSafeEqual에 안전하게 넘긴다
// (quick-drafts 업로드 API의 safeEqual과 동일한 방식).
function safeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left, "utf8").digest();
  const rightHash = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftHash, rightHash);
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** 입력한 비밀번호가 SITE_ACCESS_PASSWORD와 일치하는지 안전하게 비교한다. */
export function verifySiteAccessPassword(candidate: string): boolean {
  const expected = getSiteAccessPassword();
  return Boolean(candidate) && safeEqual(candidate, expected);
}

/** 서명된 세션 토큰을 새로 만든다. 쿠키 값으로 그대로 저장한다. */
export function createSessionToken(): string {
  const secret = getSessionSecret();
  const issuedAt = Date.now();
  const payload: SessionPayload = {
    iat: issuedAt,
    exp: issuedAt + SESSION_MAX_AGE_SECONDS * 1000,
    nonce: randomBytes(9).toString("base64url"),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = sign(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

/**
 * 쿠키에서 읽은 세션 토큰이 위조되지 않았고 만료되지 않았는지 검증한다.
 * SESSION_SECRET이 없으면(설정 오류) 항상 무효로 취급한다 — 예외를 던지지 않는다.
 */
export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  let secret: string;
  try {
    secret = getSessionSecret();
  } catch {
    return false;
  }

  const separatorIndex = token.lastIndexOf(".");
  if (separatorIndex <= 0) return false;
  const encodedPayload = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);
  if (!encodedPayload || !signature) return false;

  const expectedSignature = sign(encodedPayload, secret);
  if (!safeEqual(signature, expectedSignature)) return false;

  try {
    const decoded = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (typeof decoded.exp !== "number" || typeof decoded.iat !== "number") return false;
    if (Date.now() > decoded.exp) return false;
    return true;
  } catch {
    return false;
  }
}

/** 로그인/로그아웃 API에서 그대로 재사용할 쿠키 옵션. */
export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
