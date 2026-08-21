import { getValidDriveAccessToken } from "@/lib/wms/google-drive-oauth";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export class ImageDriveNotConfiguredError extends Error {
  constructor() {
    super("GOOGLE_DRIVE_IMAGE_DB_FOLDER_ID 환경변수가 설정되지 않았습니다.");
    this.name = "ImageDriveNotConfiguredError";
  }
}

function rootFolderId() {
  const value = process.env.GOOGLE_DRIVE_IMAGE_DB_FOLDER_ID?.trim();
  if (!value) throw new ImageDriveNotConfiguredError();
  return value;
}

function escapeQuery(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function driveFetch(url: string, init: RequestInit = {}) {
  const token = await getValidDriveAccessToken();
  const response = await fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(`Google Drive 요청 실패: ${data?.error?.message || data?.raw || `HTTP ${response.status}`}`);
  return data;
}

export async function verifyImageDriveFolder() {
  const id = rootFolderId();
  const item = await driveFetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,trashed`);
  if (item.trashed || item.mimeType !== FOLDER_MIME) throw new Error("지정한 상품이미지DB 폴더가 없거나 사용할 수 없습니다.");
  return { id: item.id as string, name: item.name as string };
}

async function findOrCreateFolder(parentId: string, name: string) {
  const q = `'${escapeQuery(parentId)}' in parents and name='${escapeQuery(name)}' and mimeType='${FOLDER_MIME}' and trashed=false`;
  const params = new URLSearchParams({ q, fields: "files(id,name)", pageSize: "2" });
  const listed = await driveFetch(`${DRIVE_API_BASE}/files?${params}`);
  if (listed.files?.length) return listed.files[0].id as string;
  const created = await driveFetch(`${DRIVE_API_BASE}/files?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  return created.id as string;
}

async function resolvePath(folders: string[]) {
  let parentId = rootFolderId();
  for (const folder of folders) parentId = await findOrCreateFolder(parentId, folder);
  return parentId;
}

async function findExistingFile(parentId: string, name: string) {
  const q = `'${escapeQuery(parentId)}' in parents and name='${escapeQuery(name)}' and trashed=false`;
  const params = new URLSearchParams({ q, fields: "files(id)", pageSize: "1" });
  const listed = await driveFetch(`${DRIVE_API_BASE}/files?${params}`);
  return listed.files?.[0]?.id as string | undefined;
}

export async function uploadImageGeneratorFile(folders: string[], filename: string, buffer: Buffer, mimeType: string) {
  const parentId = await resolvePath(folders);
  const existingId = await findExistingFile(parentId, filename);
  const boundary = `noidb-image-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const metadata = existingId ? { name: filename } : { name: filename, parents: [parentId] };
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const url = existingId
    ? `${DRIVE_UPLOAD_BASE}/${encodeURIComponent(existingId)}?uploadType=multipart&fields=id`
    : `${DRIVE_UPLOAD_BASE}?uploadType=multipart&fields=id`;
  const result = await driveFetch(url, {
    method: existingId ? "PATCH" : "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  return result.id as string;
}
