import { createSign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

export interface DriveFileInfo {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
}

export class DriveReaderNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`Google Drive 읽기 설정이 없습니다: ${missing.join(", ")}`);
    this.name = "DriveReaderNotConfiguredError";
  }
}

function base64url(input: Buffer | string): string {
  const buffer = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function normalizePrivateKey(key: string): string {
  return key.includes("\\n") ? key.replace(/\\n/g, "\n") : key;
}

export function isDriveReaderConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_DRIVE_READER_CLIENT_EMAIL?.trim() &&
      process.env.GOOGLE_DRIVE_READER_PRIVATE_KEY?.trim()
  );
}

export function shouldRequireDriveReader(): boolean {
  return Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production";
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function getDriveReaderAccessToken(): Promise<string> {
  const clientEmail = process.env.GOOGLE_DRIVE_READER_CLIENT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_DRIVE_READER_PRIVATE_KEY?.trim();
  const missing = [
    !clientEmail ? "GOOGLE_DRIVE_READER_CLIENT_EMAIL" : "",
    !privateKey ? "GOOGLE_DRIVE_READER_PRIVATE_KEY" : "",
  ].filter(Boolean);
  if (!clientEmail || !privateKey) throw new DriveReaderNotConfiguredError(missing);

  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 30) return cachedToken.accessToken;

  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claimSet = base64url(
    JSON.stringify({ iss: clientEmail, scope: DRIVE_READONLY_SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claimSet}`);
  signer.end();
  const signature = base64url(signer.sign(normalizePrivateKey(privateKey)));
  const assertion = `${header}.${claimSet}.${signature}`;

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const data = await response.json().catch(() => ({} as any));
  if (!response.ok || !data.access_token) {
    throw new Error(`Google Drive 읽기 인증 실패: ${data?.error_description || data?.error || `HTTP ${response.status}`}`);
  }
  cachedToken = { accessToken: data.access_token, expiresAt: now + Number(data.expires_in || 3600) };
  return cachedToken.accessToken;
}

async function driveFetch(url: string): Promise<Response> {
  const token = await getDriveReaderAccessToken();
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!response.ok) {
    const data = await response.json().catch(() => ({} as any));
    throw new Error(`Google Drive 조회 실패: ${data?.error?.message || `HTTP ${response.status}`}`);
  }
  return response;
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function listDriveFolderFiles(folderId: string): Promise<DriveFileInfo[]> {
  if (!folderId.trim()) throw new Error("Google Drive 폴더 ID가 비어 있습니다.");
  const files: DriveFileInfo[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      q: `'${escapeDriveQuery(folderId.trim())}' in parents and trashed=false`,
      fields: "nextPageToken,files(id,name,mimeType,modifiedTime,size)",
      orderBy: "modifiedTime desc,name",
      pageSize: "1000",
      spaces: "drive",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await driveFetch(`${DRIVE_API_BASE}/files?${params}`);
    const data = await response.json();
    files.push(...((data.files || []) as DriveFileInfo[]));
    pageToken = String(data.nextPageToken || "");
  } while (pageToken);
  return files;
}

export async function downloadDriveFile(fileId: string): Promise<Buffer> {
  const response = await driveFetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`);
  return Buffer.from(await response.arrayBuffer());
}

export async function listDriveFilesFromEnv(envName: string): Promise<DriveFileInfo[]> {
  const folderId = process.env[envName]?.trim();
  if (!folderId) throw new DriveReaderNotConfiguredError([envName]);
  return listDriveFolderFiles(folderId);
}
