import { NextRequest, NextResponse } from "next/server";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { isDriveReaderConfigured, shouldRequireDriveReader } from "@/lib/wms/google-drive-reader";
import { downloadOAuthDriveFile, listOAuthDriveFolderFiles, resolveDriveFolderPath, type OAuthDriveFileInfo } from "@/lib/wms/google-drive-oauth-reader";
import {
  loadShipmentPrintWorkbookSources,
  selectShipmentPrintWorkbook,
  ShipmentPrintWorkbookSelectionError,
} from "@/lib/wms/shipment-print-workbook-source";

export const runtime = "nodejs";

interface SourceFile { name: string; modifiedTime: string; buffer: Buffer }

async function localFiles(directory: string): Promise<SourceFile[]> {
  const names = await readdir(directory);
  const files = await Promise.all(names.filter(name => !name.startsWith("~$")).map(async name => {
    const fullPath = path.join(directory, name);
    const info = await stat(fullPath);
    if (!info.isFile()) return null;
    return { name, modifiedTime: info.mtime.toISOString(), buffer: await readFile(fullPath) };
  }));
  return files.filter((file) => file !== null);
}

/** 같은 서버에서 방금 받은 PDF는 다시 내려받지 않는다(파일 아이디·수정시각이 같을 때만). */
const downloadMemory = new Map<string, Buffer>();
async function cachedDownload(file: OAuthDriveFileInfo): Promise<Buffer> {
  const key = `${file.id}|${file.modifiedTime}`;
  const hit = downloadMemory.get(key);
  if (hit) return hit;
  const buffer = await downloadOAuthDriveFile(file.id);
  if (downloadMemory.size > 300) downloadMemory.delete(downloadMemory.keys().next().value!);
  downloadMemory.set(key, buffer);
  return buffer;
}

/**
 * 2026-10-21(사용자 요청): G드라이브 전체에서 파일 이름으로 찾느라 오래 걸렸다.
 * 이제 'G:\내 드라이브\쿠팡데이터\쉽먼트업로드완성\쉽먼트출력세트\입고예정일(YYYYMMDD)' 폴더 안의 PDF만 읽는다.
 * (쿠팡 쉽먼트 확장이 받은 PDF를 이 날짜 폴더에 저장한다.)
 */
const PRINT_SET_FOLDER = ["쿠팡데이터", "쉽먼트업로드완성", "쉽먼트출력세트"];
async function datedDriveFiles(dateTokens: string[]): Promise<SourceFile[]> {
  const folders = await Promise.all(dateTokens.map(async token => {
    try { return await resolveDriveFolderPath([...PRINT_SET_FOLDER, token]); }
    catch { throw new Error(`G드라이브 쉽먼트출력세트/${token} 폴더가 없습니다. 쿠팡 쉽먼트 화면의 확장에서 이 날짜 Label·내역서를 먼저 받아 주세요.`); }
  }));
  const files = (await Promise.all(folders.map(listOAuthDriveFolderFiles))).flat()
    .filter(file => /^shipment_(Label|ManiFest)_document\(/.test(file.name) && /\.pdf$/i.test(file.name));
  return Promise.all(files.map(async file => ({ name: file.name, modifiedTime: file.modifiedTime, buffer: await cachedDownload(file) })));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const waveId = String(body.waveId || "").trim();
    const dateTokens = [...new Set<string>((Array.isArray(body.dateTokens) ? body.dateTokens : [body.dateToken])
      .map((value: unknown) => String(value || "").replace(/\D/g, ""))
      .filter((value: string) => /^20\d{6}$/.test(value)))];
    const expectedWorkbookName = String(body.expectedWorkbookName || "").trim().normalize("NFC");
    const expectedPurchaseOrders = new Set<string>((Array.isArray(body.expectedPurchaseOrderNumbers) ? body.expectedPurchaseOrderNumbers : []).map((value: unknown) => String(value).trim()).filter((value: string) => Boolean(value)));
    if (!waveId) return NextResponse.json({ error: "웨이브 ID가 없습니다." }, { status: 400 });
    if (!dateTokens.length) return NextResponse.json({ error: "출력 PDF 입고예정일이 올바르지 않습니다." }, { status: 400 });
    if (!expectedWorkbookName) return NextResponse.json({ error: "현재 Shipment가 사용한 쉽먼트 XLSX 파일명이 없습니다." }, { status: 400 });

    let pdfFiles: SourceFile[];
    let workbookFiles: Awaited<ReturnType<typeof loadShipmentPrintWorkbookSources>>;
    if (isDriveReaderConfigured() || shouldRequireDriveReader()) {
      const [datedPdfs, workbooks] = await Promise.all([
        datedDriveFiles(dateTokens),
        loadShipmentPrintWorkbookSources(expectedWorkbookName),
      ]);
      pdfFiles = datedPdfs;
      workbookFiles = workbooks;
    } else {
      const root = process.env.WMS_SHIPMENT_PRINT_SOURCE_DIR || "G:\\내 드라이브\\쿠팡데이터\\쉽먼트업로드완성\\쉽먼트출력세트";
      const [datedPdfFiles, workbooks] = await Promise.all([
        Promise.all(dateTokens.map(dateToken => localFiles(path.join(root, dateToken)))),
        loadShipmentPrintWorkbookSources(expectedWorkbookName),
      ]);
      pdfFiles = datedPdfFiles.flat();
      workbookFiles = workbooks;
    }

    // 로컬·Drive 모두 입고예정일 폴더에서만 읽는다. 파일명 날짜는 다운로드일이라 다시 거르지 않는다.
    // 최종 범위는 클라이언트가 PDF 내부 발주번호와 generation PO 집합을 정확히 대조해 제한한다.
    const labels = pdfFiles.filter(file => file.name.startsWith("shipment_Label_document(") && file.name.toLocaleLowerCase("ko").endsWith(".pdf"));
    const manifests = pdfFiles.filter(file => file.name.startsWith("shipment_ManiFest_document(") && file.name.toLocaleLowerCase("ko").endsWith(".pdf"));
    if (!labels.length || !manifests.length) {
      return NextResponse.json({ error: `쉽먼트출력세트/${dateTokens.join(", ")} 폴더에서 Label PDF와 내역서 PDF를 모두 찾지 못했습니다. 쿠팡 쉽먼트 화면의 확장에서 이 날짜 Label·내역서를 받아 주세요.` }, { status: 400 });
    }
    let selectedWorkbook: SourceFile;
    try {
      selectedWorkbook = await selectShipmentPrintWorkbook(workbookFiles, [...expectedPurchaseOrders], { expectedWorkbookName, strictName: true });
    } catch (error) {
      if (error instanceof ShipmentPrintWorkbookSelectionError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    // 2026-10-21: 같은 쉽먼트 PDF가 직접 저장본·확장 자동저장본으로 두 개 있을 수 있어, 최신 파일이 먼저 오게 보낸다(사이트가 최신 1개만 씀).
    const encode = (file: SourceFile) => ({ name: file.name, modifiedTime: file.modifiedTime, base64: file.buffer.toString("base64") });
    const newestFirst = (a: SourceFile, b: SourceFile) => String(b.modifiedTime || "").localeCompare(String(a.modifiedTime || ""));
    labels.sort(newestFirst);
    manifests.sort(newestFirst);
    return NextResponse.json({
      labels: labels.map(encode),
      manifests: manifests.map(encode),
      workbook: encode(selectedWorkbook),
      sourceSummary: `${dateTokens.join(",")} PDF ${labels.length + manifests.length}개 / ${selectedWorkbook.name}`,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "출력세트 원본을 자동으로 불러오지 못했습니다." }, { status: 500 });
  }
}
