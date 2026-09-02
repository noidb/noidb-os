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

export const runtime = "nodejs";

interface SourceFile { name: string; modifiedTime: string; buffer: Buffer }

async function workbookPurchaseOrders(buffer: Buffer): Promise<Set<string>> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  for (const sheet of workbook.worksheets) {
    const headers = new Map<string, number>();
    sheet.getRow(1).eachCell((cell, column) => headers.set(String(cell.value ?? "").trim(), column));
    const poColumn = headers.get("발주번호") ?? headers.get("발주번호(PO ID)");
    if (!poColumn) continue;
    const purchaseOrders = new Set<string>();
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const value = String(sheet.getRow(rowNumber).getCell(poColumn).value ?? "").trim().replace(/\.0$/, "");
      if (/^\d{9}$/.test(value)) purchaseOrders.add(value);
    }
    if (purchaseOrders.size) return purchaseOrders;
  }
  return new Set();
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every(value => right.has(value));
}

function dateParts(token: string): string {
  return `${token.slice(0, 4)}_${token.slice(4, 6)}_${token.slice(6, 8)}`;
}

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
    const dateToken = String(body.dateToken || "").replace(/\D/g, "");
    const expectedWorkbookName = String(body.expectedWorkbookName || "").trim().normalize("NFC");
    const expectedPurchaseOrders = new Set<string>((Array.isArray(body.expectedPurchaseOrderNumbers) ? body.expectedPurchaseOrderNumbers : []).map((value: unknown) => String(value).trim()).filter((value: string) => Boolean(value)));
    if (!waveId) return NextResponse.json({ error: "웨이브 ID가 없습니다." }, { status: 400 });
    if (!/^20\d{6}$/.test(dateToken)) return NextResponse.json({ error: "출력 PDF 날짜가 올바르지 않습니다." }, { status: 400 });

    let pdfFiles: SourceFile[];
    let workbookFiles: SourceFile[];
    if (isDriveReaderConfigured() || shouldRequireDriveReader()) {
      const [labels, manifests, workbooks] = await Promise.all([
        driveFiles("shipment_Label_document"),
        driveFiles("shipment_ManiFest_document"),
        driveFiles("쉽먼트생성_업로드파일_", file => {
          const normalizedName = file.name.normalize("NFC").toLocaleLowerCase("ko");
          return normalizedName.startsWith("쉽먼트생성_업로드파일_") && normalizedName.endsWith(".xlsx") && !file.mimeType.startsWith("application/vnd.google-apps.");
        }),
      ]);
      pdfFiles = [...labels, ...manifests];
      workbookFiles = workbooks;
    } else {
      const root = process.env.WMS_SHIPMENT_PRINT_SOURCE_DIR || "G:\\내 드라이브\\쿠팡데이터\\쉽먼트업로드완성\\쉽먼트출력세트";
      const outputRoot = process.env.WMS_SHIPMENT_OUTPUT_DIR || "G:\\내 드라이브\\쿠팡데이터\\쉽먼트업로드완성";
      pdfFiles = await localFiles(path.join(root, dateToken));
      workbookFiles = await localFiles(outputRoot);
    }

    const pdfDate = dateParts(dateToken);
    const labels = pdfFiles.filter(file => file.name.startsWith("shipment_Label_document(") && file.name.includes(`_${pdfDate}.pdf`));
    const manifests = pdfFiles.filter(file => file.name.startsWith("shipment_ManiFest_document(") && file.name.includes(`_${pdfDate}.pdf`));
    const workbooks = workbookFiles.filter(file => {
      const normalizedName = file.name.normalize("NFC").toLocaleLowerCase("ko");
      return normalizedName.startsWith("쉽먼트생성_업로드파일_") && normalizedName.endsWith(".xlsx");
    })
      .sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
    if (!labels.length || !manifests.length) {
      return NextResponse.json({ error: `${dateToken} 폴더에서 Label PDF와 ManiFest PDF를 모두 찾지 못했습니다.` }, { status: 400 });
    }
    if (!workbooks.length) {
      return NextResponse.json({ error: `${dateToken}에 생성된 쉽먼트 업로드 XLSX를 찾지 못했습니다.` }, { status: 400 });
    }
    let selectedWorkbook = workbooks[0];
    if (expectedPurchaseOrders.size) {
      const inspected = await Promise.all(workbooks.map(async file => ({ file, purchaseOrders: await workbookPurchaseOrders(file.buffer) })));
      const exact = inspected.filter(candidate => sameSet(candidate.purchaseOrders, expectedPurchaseOrders));
      if (exact.length === 0) {
        const counts = inspected.map(candidate => `${candidate.file.name.normalize("NFC")}: ${candidate.purchaseOrders.size}건`).join(" / ");
        return NextResponse.json({ error: `현재 묶음 발주번호 ${expectedPurchaseOrders.size}건과 정확히 일치하는 쉽먼트 XLSX가 없습니다. ${counts}` }, { status: 400 });
      }
      const named = expectedWorkbookName ? exact.find(candidate => candidate.file.name.normalize("NFC") === expectedWorkbookName) : undefined;
      selectedWorkbook = (named || exact[0]).file;
    }

    const encode = (file: SourceFile) => ({ name: file.name, base64: file.buffer.toString("base64") });
    return NextResponse.json({
      labels: labels.map(encode),
      manifests: manifests.map(encode),
      workbook: encode(selectedWorkbook),
      sourceSummary: `${dateToken} PDF ${labels.length + manifests.length}개 / ${selectedWorkbook.name}`,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "출력세트 원본을 자동으로 불러오지 못했습니다." }, { status: 500 });
  }
}
