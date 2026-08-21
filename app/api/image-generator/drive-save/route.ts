import { NextRequest, NextResponse } from "next/server";
import { ImageDriveNotConfiguredError, uploadImageGeneratorFile, verifyImageDriveFolder } from "@/lib/image-generator/google-drive-storage";
import { DriveOAuthNotConfiguredError, DriveOAuthNotConnectedError, DriveOAuthTokenInvalidError, isDriveOAuthConfigured } from "@/lib/wms/google-drive-oauth";

export const runtime = "nodejs";

function cleanSegment(value: unknown) {
  return String(value || "").trim().replace(/[\\/:*?"<>|]/g, "-").slice(0, 120);
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Google Drive 저장 중 오류가 발생했습니다.";
  if (error instanceof ImageDriveNotConfiguredError || error instanceof DriveOAuthNotConfiguredError) return NextResponse.json({ success: false, code: "not_configured", error: message }, { status: 400 });
  if (error instanceof DriveOAuthNotConnectedError || error instanceof DriveOAuthTokenInvalidError) return NextResponse.json({ success: false, code: "not_connected", error: message }, { status: 401 });
  return NextResponse.json({ success: false, code: "drive_failed", error: message }, { status: 500 });
}

export async function GET() {
  try {
    if (!isDriveOAuthConfigured()) throw new DriveOAuthNotConfiguredError();
    const folder = await verifyImageDriveFolder();
    return NextResponse.json({ success: true, folderName: folder.name });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    if (!isDriveOAuthConfigured()) throw new DriveOAuthNotConfiguredError();
    const body = await request.json();
    const folders = Array.isArray(body.folders) ? body.folders.map(cleanSegment).filter(Boolean) : [];
    const filename = cleanSegment(body.filename);
    if (!filename || folders.length > 8) return NextResponse.json({ success: false, code: "invalid_path", error: "저장 경로가 올바르지 않습니다." }, { status: 400 });
    let buffer: Buffer;
    let mimeType = cleanSegment(body.mimeType) || "application/octet-stream";
    if (typeof body.dataUrl === "string") {
      const match = body.dataUrl.match(/^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/);
      if (!match) return NextResponse.json({ success: false, code: "invalid_file", error: "파일 데이터 형식이 올바르지 않습니다." }, { status: 400 });
      mimeType = match[1]; buffer = Buffer.from(match[2], "base64");
    } else if (typeof body.text === "string") buffer = Buffer.from(body.text, "utf8");
    else return NextResponse.json({ success: false, code: "invalid_file", error: "저장할 파일이 없습니다." }, { status: 400 });
    if (buffer.length > 4 * 1024 * 1024) return NextResponse.json({ success: false, code: "too_large", error: "파일 한 개의 용량이 4MB를 초과합니다." }, { status: 413 });
    const fileId = await uploadImageGeneratorFile(folders, filename, buffer, mimeType);
    return NextResponse.json({ success: true, fileId });
  } catch (error) { return errorResponse(error); }
}
