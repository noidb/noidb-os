import { getValidDriveAccessToken } from "./google-drive-oauth";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export interface OAuthDriveFileInfo {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size: string;
}

function escapeQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function driveFetch(url: string): Promise<Response> {
  const token = await getValidDriveAccessToken();
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(`Google Drive 조회 실패: ${data?.error?.message || `HTTP ${response.status}`}`);
  }
  return response;
}

async function findFolder(parentId: string, name: string): Promise<string> {
  const q = `'${escapeQuery(parentId)}' in parents and name='${escapeQuery(name)}' and mimeType='${FOLDER_MIME}' and trashed=false`;
  const params = new URLSearchParams({ q, fields: "files(id,name)", pageSize: "3", spaces: "drive" });
  const data = await (await driveFetch(`${DRIVE_API_BASE}/files?${params}`)).json();
  const files = data.files || [];
  if (files.length !== 1) throw new Error(files.length ? `'${name}' 폴더가 여러 개라 자동 선택하지 않았습니다.` : `'${name}' 폴더를 찾지 못했습니다.`);
  return String(files[0].id);
}

export async function resolveDriveFolderPath(parts: string[]): Promise<string> {
  let parentId = "root";
  for (const part of parts) parentId = await findFolder(parentId, part);
  return parentId;
}

/**
 * 여러 사용자용 폴더 상태를 한 번에 확인한다. 공통 상위 경로는 같은 Promise를 재사용해
 * `쿠팡데이터`를 카드 수만큼 반복 조회하지 않는다. 폴더 ID는 호출자에게 반환하지 않는다.
 */
export async function probeOAuthDriveFolderPaths(paths: Record<string, string[]>): Promise<Record<string, boolean>> {
  const prefixCache = new Map<string, Promise<string>>();

  function resolveWithSharedPrefixes(parts: string[]): Promise<string> {
    let parentPromise = Promise.resolve("root");
    const prefix: string[] = [];
    for (const part of parts) {
      prefix.push(part);
      const key = JSON.stringify(prefix);
      let next = prefixCache.get(key);
      if (!next) {
        next = parentPromise.then(parentId => findFolder(parentId, part));
        prefixCache.set(key, next);
      }
      parentPromise = next;
    }
    return parentPromise;
  }

  const entries = await Promise.all(Object.entries(paths).map(async ([key, parts]) => {
    try {
      await resolveWithSharedPrefixes(parts);
      return [key, true] as const;
    } catch {
      return [key, false] as const;
    }
  }));
  return Object.fromEntries(entries);
}

export async function listOAuthDriveFolderFiles(folderId: string): Promise<OAuthDriveFileInfo[]> {
  const q = `'${escapeQuery(folderId)}' in parents and trashed=false`;
  const files: OAuthDriveFileInfo[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ q, fields: "nextPageToken,files(id,name,mimeType,modifiedTime,size)", orderBy: "modifiedTime desc,name", pageSize: "1000", spaces: "drive" });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await (await driveFetch(`${DRIVE_API_BASE}/files?${params}`)).json();
    files.push(...(data.files || []));
    pageToken = String(data.nextPageToken || "");
  } while (pageToken);
  return files;
}

export async function downloadOAuthDriveFile(fileId: string): Promise<Buffer> {
  const response = await driveFetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`);
  return Buffer.from(await response.arrayBuffer());
}
