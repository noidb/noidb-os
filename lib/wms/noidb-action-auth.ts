import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export const NOIDB_ACTION_SESSION_COOKIE = "noidb_action_session";
export const NOIDB_ACTION_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function safeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left, "utf8").digest();
  const rightHash = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftHash, rightHash);
}

function configuredActionCode(): string {
  return process.env.QUICK_DRAFT_SYNC_CODE?.trim() || "";
}

function signingKey(): Buffer | null {
  const code = configuredActionCode();
  if (!code) return null;
  return createHash("sha256").update(`NOIDB_ACTION_SESSION:${code}`, "utf8").digest();
}

export function isNoidbActionAuthConfigured(): boolean {
  return configuredActionCode().length >= 8;
}

export function verifyNoidbActionCode(supplied: string): boolean {
  const expected = configuredActionCode();
  return expected.length >= 8 && supplied.length >= 8 && safeEqual(supplied, expected);
}

export function createNoidbActionSession(now = Date.now()): string {
  const key = signingKey();
  if (!key) throw new Error("NOID-B 관리자 연동번호가 설정되지 않았습니다.");
  const expiresAt = Math.floor(now / 1000) + NOIDB_ACTION_SESSION_MAX_AGE_SECONDS;
  const payload = `v1.${expiresAt}.${randomBytes(16).toString("hex")}`;
  const signature = createHmac("sha256", key).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

export function verifyNoidbActionSession(token: string, now = Date.now()): boolean {
  const key = signingKey();
  if (!key || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const [version, expiresAtText, nonce, signature] = parts;
  if (!/^\d+$/.test(expiresAtText) || !/^[a-f0-9]{32}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expiresAt = Number(expiresAtText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return false;
  const payload = `${version}.${expiresAtText}.${nonce}`;
  const expected = createHmac("sha256", key).update(payload).digest("hex");
  return safeEqual(signature, expected);
}

export function hasNoidbActionSession(request: NextRequest): boolean {
  return verifyNoidbActionSession(request.cookies.get(NOIDB_ACTION_SESSION_COOKIE)?.value || "");
}

/** 브라우저의 같은 출처 fetch만 허용한다. 세션 인증과 함께 CSRF를 차단한다. */
export function isSameOriginActionRequest(request: NextRequest): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;
  const origin = request.headers.get("origin");
  const forwardedHost = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "").split(",")[0].trim();
  if (!origin || !forwardedHost) return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.host.toLowerCase() === forwardedHost.toLowerCase();
  } catch {
    return false;
  }
}
