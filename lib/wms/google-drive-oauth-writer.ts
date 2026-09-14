import { getValidDriveAccessToken } from "./google-drive-oauth";
import { listOAuthDriveFolderFiles, resolveDriveFolderPath } from "./google-drive-oauth-reader";

const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3/files";

function safeFileName(value: string): string {
  const name = value.trim().replace(/[\\/]/g, "_");
  if (!name || name === "." || name === "..") throw new Error("저장할 파일명이 올바르지 않습니다.");
  return name;
}

function nextAvailableName(requested: string, existing: Set<string>): string {
  if (!existing.has(requested)) return requested;
  const dot = requested.lastIndexOf(".");
  const stem = dot > 0 ? requested.slice(0, dot) : requested;
  const extension = dot > 0 ? requested.slice(dot) : "";
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${stem}_${String(index).padStart(2, "0")}${extension}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error("같은 이름의 생성파일이 너무 많아 새 파일명을 만들지 못했습니다.");
}

/** 원본을 덮어쓰지 않고 지정한 사용자 Drive 폴더에 비공개 파일을 저장한다. */
export async function uploadGeneratedFileToDrive(
  buffer: Buffer | Uint8Array | ArrayBuffer,
  requestedFileName: string,
  mimeType: string,
  folderPath: string[],
): Promise<{ fileName: string }> {
  const folderId = await resolveDriveFolderPath(folderPath);
  const existing = new Set((await listOAuthDriveFolderFiles(folderId)).map(file => file.name));
  const fileName = nextAvailableName(safeFileName(requestedFileName), existing);
  const boundary = `noidb-generated-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const metadata = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: fileName, parents: [folderId] })}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  let payload: Buffer;
  if (Buffer.isBuffer(buffer)) payload = buffer;
  else if (buffer instanceof ArrayBuffer) payload = Buffer.from(buffer);
  else payload = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const body = Buffer.concat([metadata, payload, Buffer.from(`\r\n--${boundary}--`)]);
  const token = await getValidDriveAccessToken();
  const response = await fetch(`${DRIVE_UPLOAD_BASE}?uploadType=multipart&fields=id,name`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error?.message || `HTTP ${response.status}`);
  }
  return { fileName };
}

export async function generatedDriveSaveHeaders(
  buffer: Buffer | Uint8Array | ArrayBuffer,
  fileName: string,
  mimeType: string,
  folderPath: string[],
): Promise<Record<string, string>> {
  try {
    const saved = await uploadGeneratedFileToDrive(buffer, fileName, mimeType, folderPath);
    return {
      "X-NOIDB-Drive-Saved": "true",
      "X-NOIDB-Drive-File-Name": encodeURIComponent(saved.fileName),
    };
  } catch {
    // 생성파일 다운로드는 보존하되 자동저장 실패를 화면에서 분명히 알린다.
    return {
      "X-NOIDB-Drive-Saved": "false",
      "X-NOIDB-Drive-Save-Warning": encodeURIComponent("Drive 자동저장에 실패했습니다. 파일폴더 연결을 확인해 주세요."),
    };
  }
}
