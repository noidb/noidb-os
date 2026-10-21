import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { uploadGeneratedFileToDrive } from "@/lib/wms/google-drive-oauth-writer";
import { listOAuthDriveFolderFiles, resolveDriveFolderPath } from "@/lib/wms/google-drive-oauth-reader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const FOLDER = ["쿠팡데이터", "쉽먼트업로드완성", "쉽먼트출력세트"];
// Vercel 요청 크기 한도(약 4.5MB)를 넘지 않게, 받은 PDF는 3.2MB까지만 받는다.
const MAX_BYTES = 3_200_000;

/**
 * 쉽먼트 확장(0.9.10, 2026-10-21)이 쿠팡에서 받은 Label·내역서 PDF를 G드라이브 출력세트 폴더에 저장한다.
 * - PDF(%PDF)만 받는다. 이름은 출력세트가 찾는 형식(shipment_Label_document(…)·shipment_ManiFest_document(…))으로 맞춘다.
 * - 같은 내용의 PDF를 다시 받으면 새로 저장하지 않는다(파일 이름 끝의 내용 확인값으로 구분).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { name?: unknown; kind?: unknown; base64?: unknown };
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
    const folderId = await resolveDriveFolderPath(FOLDER);
    const existing = await listOAuthDriveFolderFiles(folderId);
    const same = existing.find(file => file.name.endsWith(`_${hash}.pdf`));
    if (same) return NextResponse.json({ ok: true, skipped: true, fileName: same.name }, { headers });
    const saved = await uploadGeneratedFileToDrive(buffer, fileName, "application/pdf", FOLDER);
    return NextResponse.json({ ok: true, fileName: saved.fileName }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "PDF를 저장하지 못했습니다." }, { status: 400, headers });
  }
}
