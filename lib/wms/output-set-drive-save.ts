/**
 * 2026-11-05: 출력세트 파일을 G드라이브 '쉽먼트출력세트/입고예정일' 폴더에 저장한다(브라우저에서 호출).
 * 서버가 한 번에 약 4.5MB까지만 받으므로 파일을 2.5MB씩 나눠 보낸다(/api/wms/shipment-print/output-set-save).
 */
const CHUNK_BYTES = 2_621_440; // 256KiB × 10 — 구글 이어 올리기는 마지막 조각 외에는 256KiB의 배수여야 한다.

export interface OutputSetFile {
  name: string;
  bytes: Uint8Array;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(index, index + 0x8000)));
  return btoa(binary);
}

async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch("/api/wms/shipment-print/output-set-save", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || !data.ok) throw new Error(String(data.error || `저장 실패(HTTP ${response.status})`));
  return data;
}

/** 파일을 차례로 저장하고, 저장된 파일 이름과 폴더 이름(YYYYMMDD)을 돌려준다. 하나라도 실패하면 오류를 던진다. */
export async function saveOutputSetToDrive(
  expectedDate: string,
  files: OutputSetFile[],
  onProgress?: (message: string) => void,
): Promise<{ folder: string; fileNames: string[] }> {
  const fileNames: string[] = [];
  let folder = "";
  for (const [index, file] of files.entries()) {
    onProgress?.(`G드라이브에 저장하는 중… (${index + 1}/${files.length}) ${file.name}`);
    const started = await post({ action: "start", expectedDate, fileName: file.name, size: file.bytes.length });
    folder = String(started.folder || folder);
    const sessionUri = String(started.sessionUri || "");
    let savedName = String(started.fileName || file.name);
    for (let start = 0; start < file.bytes.length; start += CHUNK_BYTES) {
      const part = file.bytes.subarray(start, Math.min(start + CHUNK_BYTES, file.bytes.length));
      const result = await post({ action: "chunk", sessionUri, start, total: file.bytes.length, base64: toBase64(part) });
      if (result.done && result.fileName) savedName = String(result.fileName);
    }
    fileNames.push(savedName);
  }
  return { folder, fileNames };
}
