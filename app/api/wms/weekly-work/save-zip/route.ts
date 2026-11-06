import { NextRequest, NextResponse } from "next/server";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { generatedDriveSaveHeaders } from "@/lib/wms/google-drive-oauth-writer";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const headers = { "Cache-Control": "private, no-store" };
const MARKETING_FOLDER = ["쿠팡데이터", "마케팅"];
/** 2026-11-06: 주간작업에서 화면이 완성한 쿠폰·광고 zip을 G드라이브 마케팅 폴더에 저장한다. */
export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({ success: false, error: "주간 업무 화면에서 저장해 주세요." }, { status: 403, headers });
  try {
    const rawName = decodeURIComponent(request.headers.get("x-noidb-file-name") || "");
    const fileName = rawName.replace(/[\\/:*?"<>|]/g, "_").trim();
    if (!/\.zip$/i.test(fileName)) throw new Error("저장할 파일 이름을 확인해 주세요.");
    const buffer = Buffer.from(await request.arrayBuffer());
    if (!buffer.length) throw new Error("저장할 파일이 비어 있습니다.");
    const saved = await generatedDriveSaveHeaders(buffer, fileName, "application/zip", MARKETING_FOLDER);
    const driveSaved = saved["X-NOIDB-Drive-Saved"] === "true";
    return NextResponse.json({ success: true, driveSaved, driveFolder: MARKETING_FOLDER.join("\\"), driveFileName: driveSaved ? decodeURIComponent(saved["X-NOIDB-Drive-File-Name"] || "") : "", driveWarning: driveSaved ? "" : decodeURIComponent(saved["X-NOIDB-Drive-Save-Warning"] || "") }, { headers });
  } catch (error) { return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "저장하지 못했습니다." }, { status: 409, headers }); }
}
