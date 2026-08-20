import { getWmsGoogleAccessToken } from "./google-service-account";

/**
 * @deprecated 2026-08-20부터 사용 안 함 — 이 파일의 서비스 계정 업로드 방식은 더 이상 어떤
 * API 라우트에서도 호출되지 않는다. 실제 Drive API로 확인한 결과 서비스 계정은
 * storageQuota.limit이 항상 "0"이라("Service Accounts do not have storage quota")
 * 개인 "내 드라이브"에 파일을 소유할 수 없어 업로드가 실패했다(2026-08-19 실사용 테스트에서
 * 확인된 오류의 근본 원인).
 *
 * 대체 경로: lib/wms/google-drive-oauth.ts(사용자 OAuth 인증) + lib/wms/google-drive-user.ts
 * (사용자 OAuth로 실제 업로드) — 사용자 본인 계정(noidb2017@gmail.com)의 저장 용량을 쓴다.
 * app/api/wms/product-image/upload/route.ts는 이제 이 파일이 아니라 google-drive-user.ts를
 * 호출한다.
 *
 * 이 파일은 과거 동작을 참고할 수 있도록 즉시 삭제하지 않고 남겨둔다(사용자 지시,
 * 2026-08-20). 다른 어떤 파일도 이 파일을 import하지 않는 것이 확인되면 이후 정리 대상이다.
 */

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3/files";
const UPLOAD_FOLDER_NAME = "NOID-B WMS 상품이미지";

let cachedFolderId: string | null = null;

async function driveFetch(url: string, init: RequestInit): Promise<any> {
  const accessToken = await getWmsGoogleAccessToken();
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

/** 이 서비스 계정이 이전에 만든 업로드 폴더를 찾거나, 없으면 새로 만든다. */
async function findOrCreateUploadFolder(): Promise<string> {
  if (cachedFolderId) return cachedFolderId;

  const query = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and name='${UPLOAD_FOLDER_NAME}' and trashed=false`
  );
  const list = await driveFetch(`${DRIVE_API_BASE}/files?q=${query}&fields=files(id,name)`, { method: "GET" });
  if (list.files && list.files.length > 0) {
    cachedFolderId = list.files[0].id;
    return cachedFolderId!;
  }

  const created = await driveFetch(`${DRIVE_API_BASE}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: UPLOAD_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  cachedFolderId = created.id;
  return cachedFolderId!;
}

export interface DriveUploadResult {
  fileId: string;
  /** 제품DB "이미지" 컬럼의 =IMAGE() 수식 파싱 로직(extractImageUrl)이 인식하는 형태의 뷰 URL */
  url: string;
}

/**
 * 이미지 버퍼를 업로드 폴더에 저장하고, 링크가 있으면 누구나 볼 수 있게 공유 설정한 뒤
 * 뷰 URL을 돌려준다. 사용자가 화면에서 사진을 저장할 때만 호출된다.
 */
export async function uploadImageToDrive(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<DriveUploadResult> {
  const folderId = await findOrCreateUploadFolder();

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
