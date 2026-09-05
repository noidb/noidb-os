import { NextRequest, NextResponse } from "next/server";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  downloadDriveFile,
  isDriveReaderConfigured,
  searchDriveFilesByName,
  shouldRequireDriveReader,
  type DriveFileInfo,
} from "@/lib/wms/google-drive-reader";
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
  return files.filter((file): file is SourceFile => file !== null);
}

async function driveFiles(fragment: string, accept: (file: DriveFileInfo) => boolean = () => true): Promise<SourceFile[]> {
  const files = (await searchDriveFilesByName(fragment)).filter(accept);
  return Promise.all(files.map(async (file: DriveFileInfo) => ({
    name: file.name,
    modifiedTime: file.modifiedTime,
    buffer: await downloadDriveFile(file.id),
  })));
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

    let pdfFiles: SourceFile[];
    let workbookFiles: Awaited<ReturnType<typeof loadShipmentPrintWorkbookSources>>;
    if (isDriveReaderConfigured() || shouldRequireDriveReader()) {
      const [labels, manifests, workbooks] = await Promise.all([
        driveFiles("shipment_Label_document"),
        driveFiles("shipment_ManiFest_document"),
        loadShipmentPrintWorkbookSources(),
      ]);
      pdfFiles = [...labels, ...manifests];
      workbookFiles = workbooks;
    } else {
      const root = process.env.WMS_SHIPMENT_PRINT_SOURCE_DIR || "G:\\내 드라이브\\쿠팡데이터\\쉽먼트업로드완성\\쉽먼트출력세트";
      const [datedPdfFiles, workbooks] = await Promise.all([
        Promise.all(dateTokens.map(dateToken => localFiles(path.join(root, dateToken)))),
        loadShipmentPrintWorkbookSources(),
      ]);
      pdfFiles = datedPdfFiles.flat();
      workbookFiles = workbooks;
    }

    // 로컬은 입고예정일 폴더(dateTokens)에서 이미 범위를 제한한다. Drive에서는 파일명 날짜가
    // 입고예정일이 아니라 다운로드일로 저장되므로 날짜 문자열로 다시 거르면 정상 PDF가 누락된다.
    // 최종 범위는 클라이언트가 PDF 내부 발주번호와 generation PO 집합을 정확히 대조해 제한한다.
    const labels = pdfFiles.filter(file => file.name.startsWith("shipment_Label_document(") && file.name.toLocaleLowerCase("ko").endsWith(".pdf"));
    const manifests = pdfFiles.filter(file => file.name.startsWith("shipment_ManiFest_document(") && file.name.toLocaleLowerCase("ko").endsWith(".pdf"));
    if (!labels.length || !manifests.length) {
      return NextResponse.json({ error: `입고예정일 ${dateTokens.join(", ")}의 Label PDF와 ManiFest PDF를 모두 찾지 못했습니다.` }, { status: 400 });
    }
    let selectedWorkbook: SourceFile;
    try {
      selectedWorkbook = await selectShipmentPrintWorkbook(workbookFiles, [...expectedPurchaseOrders], { expectedWorkbookName });
    } catch (error) {
      if (error instanceof ShipmentPrintWorkbookSelectionError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    const encode = (file: SourceFile) => ({ name: file.name, base64: file.buffer.toString("base64") });
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
