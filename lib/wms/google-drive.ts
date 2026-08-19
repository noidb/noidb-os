import { getWmsGoogleAccessToken } from "./google-service-account";

/**
 * NOID WMS 전용 Google Drive 업로드 클라이언트 (2026-08-19 신규 — 상품 상세 화면의
 * "사진 촬영/썸네일 교체" 기능용). 같은 서비스 계정에 drive.file 스코프를 추가로 요청해서 쓴다
 * — 이 스코프는 "이 앱이 만든 파일"에만 접근 가능한 최소 권한이라, 사용자의 기존 구글드라이브
 * 파일에는 전혀 접근할 수 없다.
 *
 * 기존 상품등록 기능이 쓰는 Apps Script(templates/구글시트_상품DB_연동.gs)의 이미지 업로드와는
 * 완전히 별개의 경로다 — 그 Apps Script는 여기서 수정하지 않는다.
 *
 * 필요 사전 준비: Google Cloud 콘솔에서 "Google Drive API"가 사용 설정되어 있어야 한다
 * (Sheets API를 켰던 것과 같은 방식). 켜지지 않았으면 업로드 시 안내 에러가 뜬다.
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
