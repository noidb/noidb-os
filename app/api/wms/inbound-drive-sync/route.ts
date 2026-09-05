import { get } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { downloadOAuthDriveFile, listOAuthDriveFolderFiles, resolveDriveFolderPath, type OAuthDriveFileInfo } from "@/lib/wms/google-drive-oauth-reader";
import { DriveOAuthNotConnectedError, DriveOAuthTokenInvalidError } from "@/lib/wms/google-drive-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const INDEX_PATH = "noidb-wms/inbound-drive-index.json";
const FOLDER_PATH = ["쿠팡데이터", "입고상세내역 다운로드"];
const INBOUND_APPLY_LOCK_MESSAGE = "입고 중복 검토는 완료했습니다. 제품DB 반영은 셀별 변경 검증 후 사용할 수 있습니다. 기존 입고결과의 쿠폰·미입고 파일은 계속 생성할 수 있습니다.";

interface IndexEntry { modifiedTime: string; size: string; name: string; }
type SyncIndex = Record<string, IndexEntry>;

async function readIndex(): Promise<SyncIndex> {
  if (!process.env.VERCEL) return {};
  try {
    const result = await get(INDEX_PATH, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return {};
    return JSON.parse(await new Response(result.stream).text()) as SyncIndex;
  } catch { return {}; }
}

function descriptor(file: OAuthDriveFileInfo) {
  return { id: file.id, name: file.name, modifiedTime: file.modifiedTime, size: file.size };
}

async function callInboundPreview(origin: string, files: OAuthDriveFileInfo[]) {
  const form = new FormData();
  form.set("mode", "inboundHistory");
  form.set("dryRun", "true");
  for (const file of files) {
    const buffer = await downloadOAuthDriveFile(file.id);
    form.append("files", new File([new Uint8Array(buffer)], file.name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  }
  const response = await fetch(`${origin}/api/coupang-data`, { method: "POST", body: form, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || "입고상세내역 반영에 실패했습니다.");
  return data;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action === "apply" ? "apply" : "preview";
    if (action === "apply") {
      return NextResponse.json({
        success: false,
        code: "INBOUND_APPLY_LOCKED",
        error: INBOUND_APPLY_LOCK_MESSAGE,
      }, { status: 409 });
    }
    const folderId = await resolveDriveFolderPath(FOLDER_PATH);
    const allFiles = (await listOAuthDriveFolderFiles(folderId)).filter(file => /\.xlsx$/i.test(file.name));
    const index = await readIndex();
    const changed = allFiles.filter(file => !index[file.id] || index[file.id].modifiedTime !== file.modifiedTime || index[file.id].size !== file.size);
    const modified = changed.filter(file => Boolean(index[file.id]));
    const newFiles = changed.filter(file => !index[file.id]);
    if (modified.length) {
      return NextResponse.json({ success: true, canApply: false, newFiles: newFiles.map(descriptor), modifiedFiles: modified.map(descriptor), message: "기존 입고파일이 수정되어 중복 합산을 막았습니다. 수정 파일은 별도 확인이 필요합니다." });
    }
    if (!newFiles.length) return NextResponse.json({ success: true, canApply: false, newFiles: [], modifiedFiles: [], message: "새 입고파일이 없습니다." });
    const result = await callInboundPreview(request.nextUrl.origin, newFiles);
    return NextResponse.json({
      success: true,
      canApply: false,
      applied: false,
      backupCreated: false,
      newFiles: newFiles.map(descriptor),
      modifiedFiles: [],
      result,
      message: INBOUND_APPLY_LOCK_MESSAGE,
    });
  } catch (error) {
    if (error instanceof DriveOAuthNotConnectedError || error instanceof DriveOAuthTokenInvalidError) {
      return NextResponse.json(
        { success: false, code: "DRIVE_RECONNECT_REQUIRED", error: "Google Drive를 다시 연결해 주세요." },
        { status: 401 },
      );
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "입고파일 자동 확인에 실패했습니다." }, { status: 400 });
  }
}
