import { getValidDriveAccessToken } from "./google-drive-oauth";
import { getStoredFolderId, saveFolderId } from "./google-drive-oauth-store";

/**
 * 사용자 OAuth로 실제 Drive 업로드를 수행하는 모듈 (2026-08-20 신규, google-drive.ts 대체).
 * 서비스 계정을 전혀 쓰지 않는다 — 모든 요청이 getValidDriveAccessToken()(사용자 refresh token
 * 기반 access token)으로 인증된다. 업로드된 파일은 사용자 본인 계정(noidb2017@gmail.com)의
 * "내 드라이브" 저장 용량을 쓴다.
 */

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3/files";
const UPLOAD_FOLDER_NAME = "NOID-B WMS 상품이미지";

export class DriveFolderAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DriveFolderAccessError";
  }
}

async function driveFetch(url: string, init: RequestInit): Promise<any> {
  const accessToken = await getValidDriveAccessToken();
  const response = await fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${accessToken}` },
  });
  const text = await response.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const detail = data?.error?.message || data?.raw || `HTTP ${response.status}`;
    throw new Error(`Google Drive 요청 실패: ${detail}`);
  }
  return data;
}

/**
 * 업로드 폴더를 결정한다. 우선순위:
 * 1. GOOGLE_DRIVE_UPLOAD_FOLDER_ID 환경변수가 있으면 그 폴더를 그대로 쓴다(접근 불가 시 오류).
 * 2. 이전에 이 앱이 찾았거나 만든 폴더 ID가 로컬에 저장돼 있으면 재사용한다.
 * 3. 없으면 사용자 계정에서 이름으로 검색한다 — 같은 이름이 여러 개면 임의로 고르지 않고 오류.
 * 4. 하나도 없으면 새로 만든다.
 * 서비스 계정이 예전에 만든 폴더는 사용자 OAuth 토큰으로는애초에 검색/접근되지 않으므로
 * (서로 다른 계정) 재사용될 일이 없다.
 */
export async function resolveUploadFolderId(): Promise<string> {
  const envFolderId = process.env.GOOGLE_DRIVE_UPLOAD_FOLDER_ID?.trim();
  if (envFolderId) {
    try {
      await driveFetch(`${DRIVE_API_BASE}/files/${envFolderId}?fields=id,name,trashed`, { method: "GET" });
    } catch (error) {
      throw new DriveFolderAccessError(
        `GOOGLE_DRIVE_UPLOAD_FOLDER_ID(${envFolderId})로 지정된 폴더에 접근할 수 없습니다: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    return envFolderId;
  }

  const savedFolderId = await getStoredFolderId();
  if (savedFolderId) {
    try {
      const info = await driveFetch(`${DRIVE_API_BASE}/files/${savedFolderId}?fields=id,name,trashed`, { method: "GET" });
      if (!info.trashed) return savedFolderId;
    } catch {
      // 저장된 폴더에 더 이상 접근할 수 없으면(삭제됨 등) 아래에서 다시 검색/생성한다.
    }
  }

  const query = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and name='${UPLOAD_FOLDER_NAME}' and trashed=false and 'me' in owners`
  );
  const list = await driveFetch(`${DRIVE_API_BASE}/files?q=${query}&fields=files(id,name)`, { method: "GET" });
  const found = list.files || [];
  if (found.length > 1) {
    throw new DriveFolderAccessError(
      `"${UPLOAD_FOLDER_NAME}" 폴더가 ${found.length}개 발견되어 어느 것을 쓸지 정할 수 없습니다. Google Drive에서 직접 정리하거나 GOOGLE_DRIVE_UPLOAD_FOLDER_ID 환경변수로 폴더를 직접 지정해주세요.`
    );
  }
  if (found.length === 1) {
    await saveFolderId(found[0].id);
    return found[0].id;
  }

  const created = await driveFetch(`${DRIVE_API_BASE}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: UPLOAD_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  await saveFolderId(created.id);
  return created.id as string;
}

export interface DriveUploadResult {
  fileId: string;
  /** 제품DB "이미지" 컬럼의 =IMAGE() 수식이 인식하는 뷰 URL. Google Sheets 자체 서버가 이 URL을
   *  직접 불러와 셀 안에 썸네일을 그리기 때문에(브라우저를 거치지 않음), 이 파일 하나만 링크가
   *  있으면 볼 수 있게 공개해야 한다 — OAuth 프록시로는 Sheets의 IMAGE() 렌더링을 대체할 수 없다. */
  url: string;
}

/**
 * 이미지 버퍼를 사용자 OAuth로 업로드 폴더에 저장하고, 이 파일 하나만 "링크가 있으면 볼 수 있음"
 * 권한을 부여한 뒤 뷰 URL을 돌려준다. 폴더 전체나 계정 전체를 공개하지 않는다.
 */
export async function uploadImageToDriveOAuth(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<DriveUploadResult> {
  const folderId = await resolveUploadFolderId();

  const boundary = `noidb-wms-${Date.now()}`;
  const metadata = { name: filename, parents: [folderId] };
  const bodyParts = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
  ];
  const closing = Buffer.from(`\r\n--${boundary}--`);
  const multipartBody = Buffer.concat([Buffer.from(bodyParts[0]), Buffer.from(bodyParts[1]), buffer, closing]);

  const created = await driveFetch(`${DRIVE_UPLOAD_BASE}?uploadType=multipart&fields=id`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body: multipartBody,
  });
  const fileId = created.id as string;

  await driveFetch(`${DRIVE_API_BASE}/files/${fileId}/permissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });

  return { fileId, url: `https://drive.google.com/uc?export=view&id=${fileId}` };
}
