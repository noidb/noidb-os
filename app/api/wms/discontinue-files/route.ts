import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import {
  buildDiscontinueWorkbook,
  buildReleaseWorkbook,
  koreaDateParts,
  loadDiscontinueTemplate,
  loadDiscontinueLetterTemplate,
  loadReleaseTemplate,
  normalizedDiscontinueItems,
  type DiscontinueFileItem,
} from "@/lib/wms/discontinue-files";
import { generatedDriveSaveHeaders } from "@/lib/wms/google-drive-oauth-writer";
import { buildDiscontinueLetterFromTemplate } from "@/lib/wms/discontinue-letter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const kind = body.kind === "release" ? "release" : body.kind === "discontinue" ? "discontinue" : "";
    if (!kind) return NextResponse.json({ success: false, error: "지원하지 않는 파일 종류입니다." }, { status: 400 });
    const items = normalizedDiscontinueItems((Array.isArray(body.items) ? body.items : []).map((item: DiscontinueFileItem) => ({
      skuId: String(item?.skuId || "").trim(), productName: String(item?.productName || "").trim(),
    })));
    const date = koreaDateParts();
    const format = kind === "discontinue" && (body.format === "bundle" || body.format === "pdf") ? body.format : "xlsx";
    // Complete both in-memory artifacts from one SKU set and one KST date before
    // saving either. A PDF failure never returns an XLSX-only "complete" bundle.
    const pdf = format !== "xlsx"
      ? Buffer.from(await buildDiscontinueLetterFromTemplate(await loadDiscontinueLetterTemplate(), items, date.iso))
      : null;
    const pdfBaseName = `로켓배송_단종요청_공문_${date.compact}.pdf`;
    const folder = ["쿠팡데이터", "단종 및 해제"];
    if (format === "pdf" && pdf) {
      const saved = await generatedDriveSaveHeaders(pdf, pdfBaseName, "application/pdf", folder);
      const fileName = decodeURIComponent(saved["X-NOIDB-Drive-File-Name"] || encodeURIComponent(pdfBaseName));
      return new NextResponse(pdf, { headers: {
        ...saved, "Content-Type": "application/pdf", "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "X-NOIDB-File-Name": encodeURIComponent(fileName), "X-NOIDB-Item-Count": String(items.length),
        "X-NOIDB-Preserved-Template": "true", "X-NOIDB-Document-Date": date.iso,
      } });
    }
    const result = kind === "discontinue"
      ? await buildDiscontinueWorkbook(await loadDiscontinueTemplate(), items, date.iso)
      : await buildReleaseWorkbook(await loadReleaseTemplate(), items);
    const baseName = kind === "discontinue"
      ? `판매중지_SKU_영구생산중단_${date.compact}.xlsx`
      : `이메일발송용_노이드비_단종해제 SKU리스트_${date.compact}.xlsx`;
    const driveHeaders = await generatedDriveSaveHeaders(
      result.buffer,
      baseName,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      folder,
    );
    const fileName = decodeURIComponent(driveHeaders["X-NOIDB-Drive-File-Name"] || encodeURIComponent(baseName));
    if (format === "bundle" && pdf) {
      const pdfSaved = await generatedDriveSaveHeaders(pdf, pdfBaseName, "application/pdf", folder);
      const pdfName = decodeURIComponent(pdfSaved["X-NOIDB-Drive-File-Name"] || encodeURIComponent(pdfBaseName));
      const bundle = new JSZip();
      bundle.file(fileName, result.buffer);
      bundle.file(pdfName, pdf);
      const zipName = `단종신청_엑셀_공문_${date.compact}.zip`;
      const warnings = [driveHeaders, pdfSaved].map(headers => decodeURIComponent(headers["X-NOIDB-Drive-Save-Warning"] || "")).filter(Boolean);
      return new NextResponse(await bundle.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }), { headers: {
        "Content-Type": "application/zip", "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`,
        "X-NOIDB-File-Name": encodeURIComponent(zipName), "X-NOIDB-XLSX-File-Name": encodeURIComponent(fileName),
        "X-NOIDB-PDF-File-Name": encodeURIComponent(pdfName), "X-NOIDB-Item-Count": String(items.length),
        "X-NOIDB-Preserved-Template": "true", "X-NOIDB-Document-Date": date.iso,
        "X-NOIDB-Drive-Saved": driveHeaders["X-NOIDB-Drive-Saved"] === "true" && pdfSaved["X-NOIDB-Drive-Saved"] === "true" ? "true" : "false",
        ...(warnings.length ? { "X-NOIDB-Drive-Save-Warning": encodeURIComponent([...new Set(warnings)].join(" ")) } : {}),
      } });
    }
    return new NextResponse(result.buffer, {
      status: 200,
      headers: {
        ...driveHeaders,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "X-NOIDB-File-Name": encodeURIComponent(fileName),
        "X-NOIDB-Item-Count": String(result.itemCount),
        "X-NOIDB-Preserved-Template": result.preservedWorksheetXml ? "true" : "false",
        "X-NOIDB-Document-Date": date.iso,
      },
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "단종 관련 파일을 만들지 못했습니다.",
    }, { status: 400 });
  }
}
