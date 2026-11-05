import { NextRequest, NextResponse } from "next/server";
import { ensureDriveChildFolder } from "@/lib/wms/google-drive-oauth-writer";
import { getValidDriveAccessToken } from "@/lib/wms/google-drive-oauth";
import { listOAuthDriveFolderFiles, resolveDriveFolderPath } from "@/lib/wms/google-drive-oauth-reader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const FOLDER = ["쿠팡데이터", "쉽먼트업로드완성", "쉽먼트출력세트"];
const UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3/files";
// 사이트 서버는 한 번에 약 4.5MB까지만 받는다. 화면이 2.5MB(=256KiB×10)씩 나눠 보내면 base64로 약 3.5MB다.
const MAX_CHUNK_BYTES = 2_621_440;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
};

/**
 * 2026-11-05(사용자 요청): 출력세트(부착문서·동봉내역서·바코드)를 컴퓨터로 내려받지 않고(탐색기 저장 창 없이)
 * G드라이브 '쉽먼트출력세트/입고예정일(YYYYMMDD)' 폴더에 바로 저장한다. 쿠팡 PDF가 저장된 날짜 폴더와 같은 곳이다.
 * - start: 날짜 폴더를 찾거나 만들고(미리 있으면 그 안에) 구글 '이어 올리기' 주소를 받는다. 같은 이름이 있으면 덮어쓰지 않고 _02를 붙인다.
 * - chunk: 화면이 나눠 보낸 조각을 그 주소로 이어 올린다. 마지막 조각이 끝나면 저장 완료.
 */
function dateToken(value: unknown) {
  const digits = typeof value === "string" ? value.replace(/\D/g, "") : "";
  return /^20\d{6}$/.test(digits) ? digits : "";
}

function nextAvailableName(requested: string, existing: Set<string>): string {
  if (!existing.has(requested)) return requested;
  const dot = requested.lastIndexOf(".");
  const stem = dot > 0 ? requested.slice(0, dot) : requested;
  const extension = dot > 0 ? requested.slice(dot) : "";
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${stem}_${String(index).padStart(2, "0")}${extension}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error("같은 이름의 파일이 너무 많아 새 파일명을 만들지 못했습니다.");
}

function fail(error: unknown, status = 400) {
  return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status, headers });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;

    if (body.action === "start") {
      const token = dateToken(body.expectedDate);
      if (!token) throw new Error("입고예정일이 올바르지 않습니다.");
      const requested = typeof body.fileName === "string" ? body.fileName.trim() : "";
      const extension = requested.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase() || "";
      if (!/^[0-9A-Za-z가-힣 _.()-]{1,120}$/.test(requested) || !MIME_BY_EXTENSION[extension]) throw new Error("저장할 파일 이름이 올바르지 않습니다.");
      const size = Number(body.size);
      if (!Number.isInteger(size) || size < 1 || size > MAX_FILE_BYTES) throw new Error("파일 크기가 올바르지 않습니다.");

      const parentId = await resolveDriveFolderPath(FOLDER);
      const dated = await ensureDriveChildFolder(parentId, token);
      const existing = new Set((dated.created ? [] : await listOAuthDriveFolderFiles(dated.id)).map(file => file.name));
      const fileName = nextAvailableName(requested, existing);
      const accessToken = await getValidDriveAccessToken();
      const response = await fetch(`${UPLOAD_BASE}?uploadType=resumable&fields=id,name`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": MIME_BY_EXTENSION[extension],
          "X-Upload-Content-Length": String(size),
        },
        body: JSON.stringify({ name: fileName, parents: [dated.id] }),
      });
      const sessionUri = response.headers.get("location") || "";
      if (!response.ok || !sessionUri) {
        const data = await response.json().catch(() => ({}));
        throw new Error(`Google Drive 저장을 시작하지 못했습니다: ${data?.error?.message || `HTTP ${response.status}`}`);
      }
      return NextResponse.json({ ok: true, sessionUri, fileName, folder: token }, { headers });
    }

    // 2026-11-05: 출력 화면의 '폴더 열기·부착문서·동봉내역서·바코드' 버튼용. 폴더가 없으면 만들지 않고 없다고만 알려 준다.
    if (body.action === "links") {
      const token = dateToken(body.expectedDate);
      if (!token) throw new Error("입고예정일이 올바르지 않습니다.");
      let folderId = "";
      try { folderId = await resolveDriveFolderPath([...FOLDER, token]); } catch { folderId = ""; }
      if (!folderId) return NextResponse.json({ ok: true, found: false }, { headers });
      const files = await listOAuthDriveFolderFiles(folderId); // 최근 수정 순
      const latest = (prefix: string) => files.find(file => file.name.startsWith(prefix));
      const fileUrl = (prefix: string) => { const file = latest(prefix); return file ? `https://drive.google.com/file/d/${file.id}/view` : ""; };
      return NextResponse.json({
        ok: true, found: true, folder: token,
        folderUrl: `https://drive.google.com/drive/folders/${folderId}`,
        labelsUrl: fileUrl("01_"), manifestsUrl: fileUrl("02_"), barcodeUrl: fileUrl("03_"),
      }, { headers });
    }

    if (body.action === "chunk") {
      const sessionUri = typeof body.sessionUri === "string" ? body.sessionUri : "";
      // 구글 이어 올리기 주소만 허용한다(다른 주소로 보내지 못하게).
      if (!sessionUri.startsWith(`${UPLOAD_BASE}?`) || !sessionUri.includes("upload_id=")) throw new Error("저장 주소가 올바르지 않습니다.");
      const start = Number(body.start);
      const total = Number(body.total);
      const base64 = typeof body.base64 === "string" ? body.base64 : "";
      if (!base64) throw new Error("저장할 내용이 없습니다.");
      const buffer = Buffer.from(base64, "base64");
      if (buffer.length < 1 || buffer.length > MAX_CHUNK_BYTES) throw new Error("한 번에 보낼 수 있는 크기를 넘었습니다.");
      if (!Number.isInteger(start) || !Number.isInteger(total) || start < 0 || start + buffer.length > total) throw new Error("저장 위치가 올바르지 않습니다.");
      const end = start + buffer.length - 1;
      const response = await fetch(sessionUri, {
        method: "PUT",
        redirect: "manual",
        headers: { "Content-Range": `bytes ${start}-${end}/${total}`, "Content-Type": "application/octet-stream" },
        body: new Uint8Array(buffer),
      });
      if (response.status === 308) return NextResponse.json({ ok: true, done: false }, { headers });
      const data = await response.json().catch(() => ({}));
      if (response.status === 200 || response.status === 201) return NextResponse.json({ ok: true, done: true, fileName: String(data?.name || "") }, { headers });
      throw new Error(`Google Drive 저장 실패: ${data?.error?.message || `HTTP ${response.status}`}`);
    }

    throw new Error("알 수 없는 요청입니다.");
  } catch (error) {
    return fail(error);
  }
}
