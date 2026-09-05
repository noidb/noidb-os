import { get, put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { downloadOAuthDriveFile, listOAuthDriveFolderFiles, resolveDriveFolderPath, type OAuthDriveFileInfo } from "@/lib/wms/google-drive-oauth-reader";
import { backupSheetWithinSpreadsheet } from "@/lib/wms/google-sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const INDEX_PATH = "noidb-wms/inbound-drive-index.json";
const FOLDER_PATH = ["쿠팡데이터", "입고상세내역 다운로드"];

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

async function writeIndex(index: SyncIndex): Promise<void> {
  if (!process.env.VERCEL) return;
  await put(INDEX_PATH, JSON.stringify(index), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
}

function descriptor(file: OAuthDriveFileInfo) {
  return { id: file.id, name: file.name, modifiedTime: file.modifiedTime, size: file.size };
}

async function callInboundImport(origin: string, files: OAuthDriveFileInfo[], dryRun: boolean) {
  const form = new FormData();
  form.set("mode", "inboundHistory");
  if (dryRun) form.set("dryRun", "true");
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
    if (action === "apply") {
      const expected = Array.isArray(body.expectedFileIds) ? body.expectedFileIds.map((value: unknown) => String(value || "")).sort() : [];
      const actual = newFiles.map(file => file.id).sort();
      if (expected.length !== actual.length || expected.some((id: string, index: number) => id !== actual[index])) {
        throw new Error("미리 확인한 파일과 현재 새 파일이 달라 반영을 중단했습니다. 다시 확인해 주세요.");
      }
      await backupSheetWithinSpreadsheet("제품DB");
    }
    const result = await callInboundImport(request.nextUrl.origin, newFiles, action === "preview");
    if (action === "apply") {
      for (const file of newFiles) index[file.id] = { modifiedTime: file.modifiedTime, size: file.size, name: file.name };
      await writeIndex(index);
    }
    return NextResponse.json({ success: true, canApply: action === "preview", applied: action === "apply", backupCreated: action === "apply", newFiles: newFiles.map(descriptor), modifiedFiles: [], result });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "입고파일 자동 확인에 실패했습니다." }, { status: 400 });
  }
}
