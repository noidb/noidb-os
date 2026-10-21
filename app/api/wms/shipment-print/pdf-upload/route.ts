import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { ensureDriveChildFolder, moveDriveFile, uploadGeneratedFileToDrive } from "@/lib/wms/google-drive-oauth-writer";
import { listOAuthDriveFolderFiles, resolveDriveFolderPath } from "@/lib/wms/google-drive-oauth-reader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const FOLDER = ["쿠팡데이터", "쉽먼트업로드완성", "쉽먼트출력세트"];
// Vercel 요청 크기 한도(약 4.5MB)를 넘지 않게, 받은 PDF는 3.2MB까지만 받는다.
const MAX_BYTES = 3_200_000;

/**
 * 쉽먼트 확장(0.9.10~, 2026-10-21)이 쿠팡에서 받은 Label·내역서 PDF를 G드라이브 출력세트 폴더에 저장한다.
 * - PDF(%PDF)만 받는다. 이름은 출력세트가 찾는 형식(shipment_Label_document(…)·shipment_ManiFest_document(…))으로 맞춘다.
 * - 같은 내용의 PDF를 다시 받으면 새로 저장하지 않는다(파일 이름 끝의 내용 확인값으로 구분).
 * - 0.9.13(2026-10-21): 확장이 쿠팡 목록에서 찾은 입고예정일을 보내면 '쉽먼트출력세트/YYYYMMDD' 폴더에 저장한다
 *   (폴더가 미리 있으면 그 안에, 없으면 새로 만듦). 예전에 출력세트 폴더 바로 아래 저장된 같은 PDF는 날짜 폴더로 옮긴다.
 */
function dateToken(value: unknown) {
  const digits = typeof value === "string" ? value.replace(/\D/g, "") : "";
  return /^20\d{6}$/.test(digits) ? digits : "";
}
const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;

/** 쉽먼트 칸 '저장 폴더 열기': 입고예정일 폴더가 있으면 그 폴더, 없으면 출력세트 폴더 주소(새로 만들지 않음). */
export async function GET(request: NextRequest) {
  try {
    const token = dateToken(request.nextUrl.searchParams.get("date"));
    const parentId = await resolveDriveFolderPath(FOLDER);
    if (token) {
      try { return NextResponse.json({ ok: true, dated: true, folderUrl: folderUrl(await resolveDriveFolderPath([...FOLDER, token])) }, { headers }); } catch { /* 날짜 폴더 없음 */ }
    }
    return NextResponse.json({ ok: true, dated: false, folderUrl: folderUrl(parentId) }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "폴더를 찾지 못했습니다." }, { status: 400, headers });
  }
}
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { name?: unknown; kind?: unknown; base64?: unknown; expectedDate?: unknown };
    const kind = body.kind === "ManiFest" ? "ManiFest" : body.kind === "Label" ? "Label" : "";
    if (!kind) throw new Error("Label 또는 내역서 PDF만 저장할 수 있습니다.");
    const base64 = typeof body.base64 === "string" ? body.base64 : "";
    if (!base64 || base64.length > Math.ceil(MAX_BYTES * 4 / 3) + 8) throw new Error("PDF가 너무 커서 자동 저장하지 못했습니다. 이 파일은 G드라이브 폴더에 직접 저장해 주세요.");
    const buffer = Buffer.from(base64, "base64");
    if (buffer.length < 5 || buffer.subarray(0, 4).toString("latin1") !== "%PDF") throw new Error("PDF 파일이 아닙니다.");
    const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 10);
    const prefix = `shipment_${kind}_document(`;
    const original = String(body.name || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\.pdf$/i, "").replace(/\s*\(\d+\)$/, "").trim().slice(0, 120);
    const inner = original.startsWith(prefix) ? original.slice(prefix.length).replace(/\)$/, "") : original || new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace(/\D/g, "");
    const fileName = `${prefix}${inner})_${hash}.pdf`;
    const parentId = await resolveDriveFolderPath(FOLDER);
    const token = dateToken(body.expectedDate);
    const isSame = (file: { name: string }) => file.name.endsWith(`_${hash}.pdf`);
    if (!token) {
      const same = (await listOAuthDriveFolderFiles(parentId)).find(isSame);
      if (same) return NextResponse.json({ ok: true, skipped: true, fileName: same.name, folder: "" }, { headers });
      const saved = await uploadGeneratedFileToDrive(buffer, fileName, "application/pdf", FOLDER);
      return NextResponse.json({ ok: true, fileName: saved.fileName, folder: "" }, { headers });
    }
    const dated = await ensureDriveChildFolder(parentId, token);
    const [inDated, inParent] = await Promise.all([dated.created ? Promise.resolve([]) : listOAuthDriveFolderFiles(dated.id), listOAuthDriveFolderFiles(parentId)]);
    const same = inDated.find(isSame);
    if (same) return NextResponse.json({ ok: true, skipped: true, fileName: same.name, folder: token }, { headers });
    const loose = inParent.find(isSame);
    if (loose) {
      await moveDriveFile(loose.id, parentId, dated.id);
      return NextResponse.json({ ok: true, skipped: true, moved: true, fileName: loose.name, folder: token }, { headers });
    }
    const saved = await uploadGeneratedFileToDrive(buffer, fileName, "application/pdf", [...FOLDER, token]);
    return NextResponse.json({ ok: true, fileName: saved.fileName, folder: token }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "PDF를 저장하지 못했습니다." }, { status: 400, headers });
  }
}
