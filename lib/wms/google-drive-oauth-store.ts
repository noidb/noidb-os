import { promises as fs } from "node:fs";
import path from "node:path";
import { get, put } from "@vercel/blob";

/**
 * 사용자 Google Drive OAuth의 refresh token / 업로드 폴더 ID를 저장하는 전용 모듈
 * (2026-08-20 신규). 아래 우선순위로 읽는다:
 *
 * 1순위: GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN 환경변수 (Vercel 등 배포 환경용 — 이 값이 있으면
 *        로컬 파일보다 항상 우선한다)
 * 2순위: 로컬 전용 비밀파일 .secrets/google-drive-oauth.json (집 PC 로컬 개발 서버용)
 *
 * 이 모듈이 다루는 값은 절대 클라이언트로 반환하거나 서버 로그에 출력하지 않는다 — 호출하는
 * 쪽(API 라우트)에서 반환값을 그대로 응답 JSON에 넣지 않도록 주의해야 한다.
 *
 * 배포 환경(Vercel 등) 주의: 로컬 파일 저장은 그 서버 인스턴스가 살아있는 동안만 유지되고
 * 재배포/재시작 시 사라진다 — 영구 저장이 필요하면 GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN
 * 환경변수(또는 별도 Secret Storage)를 반드시 써야 한다.
 */

const SECRET_DIR = path.join(process.cwd(), ".secrets");
const SECRET_FILE = path.join(SECRET_DIR, "google-drive-oauth.json");
const BLOB_SECRET_PATH = "noidb-system/google-drive-oauth.json";

interface StoredOAuthState {
  refreshToken?: string;
  connectedAt?: string;
  folderId?: string;
}

async function readSecretFile(): Promise<StoredOAuthState> {
  try {
    const raw = await fs.readFile(SECRET_FILE, "utf8");
    return JSON.parse(raw) as StoredOAuthState;
  } catch {
    return {};
  }
}

async function readBlobSecret(): Promise<StoredOAuthState> {
  if (!process.env.VERCEL) return {};
  try {
    const result = await get(BLOB_SECRET_PATH, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return {};
    return JSON.parse(await new Response(result.stream).text()) as StoredOAuthState;
  } catch {
    return {};
  }
}

async function readStoredState(): Promise<StoredOAuthState> {
  return process.env.VERCEL ? readBlobSecret() : readSecretFile();
}

async function writeStoredState(state: StoredOAuthState): Promise<void> {
  if (process.env.VERCEL) {
    await put(BLOB_SECRET_PATH, JSON.stringify(state), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return;
  }
  await writeSecretFile(state);
}

async function writeSecretFile(state: StoredOAuthState): Promise<void> {
  await fs.mkdir(SECRET_DIR, { recursive: true });
  await fs.writeFile(SECRET_FILE, JSON.stringify(state, null, 2), "utf8");
}

/** 환경변수에 refresh token이 직접 설정되어 있는지 (배포 환경 우선순위 1). */
export function hasEnvRefreshToken(): boolean {
  return Boolean(process.env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN?.trim());
}

/** 실제 사용할 refresh token을 우선순위대로 가져온다. 없으면 null. */
export async function getStoredRefreshToken(): Promise<string | null> {
  const envToken = process.env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN?.trim();
  if (envToken) return envToken;
  const state = await readStoredState();
  return state.refreshToken?.trim() || null;
}

/**
 * OAuth 콜백에서 새로 발급받은 refresh token을 로컬 비밀파일에 저장한다. 환경변수는 코드에서
 * 쓸 수 없으므로(배포 환경변수는 사람이 직접 등록해야 함) 항상 로컬 파일에 저장하며,
 * 다음 조회 시 GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN 환경변수가 있으면 그 값이 여전히 우선한다.
 */
export async function saveRefreshTokenLocally(refreshToken: string): Promise<void> {
  const state = await readStoredState();
  await writeStoredState({ ...state, refreshToken, connectedAt: new Date().toISOString() });
}

/** 로컬 비밀파일에 저장된 refresh token만 제거한다. 환경변수 값은 여기서 지울 수 없다. */
export async function clearLocalRefreshToken(): Promise<void> {
  const state = await readStoredState();
  delete state.refreshToken;
  delete state.connectedAt;
  await writeStoredState(state);
}

export async function getConnectedAt(): Promise<string | null> {
  const state = await readStoredState();
  return state.connectedAt || null;
}

export async function getStoredFolderId(): Promise<string | null> {
  const state = await readStoredState();
  return state.folderId?.trim() || null;
}

export async function saveFolderId(folderId: string): Promise<void> {
  const state = await readStoredState();
  await writeStoredState({ ...state, folderId });
}
