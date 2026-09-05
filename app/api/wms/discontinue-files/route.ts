import { NextRequest, NextResponse } from "next/server";
import {
  buildDiscontinueWorkbook,
  buildReleaseWorkbook,
  koreaDateParts,
  loadDiscontinueTemplate,
  loadReleaseTemplate,
  type DiscontinueFileItem,
} from "@/lib/wms/discontinue-files";
import { generatedDriveSaveHeaders } from "@/lib/wms/google-drive-oauth-writer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const kind = body.kind === "release" ? "release" : body.kind === "discontinue" ? "discontinue" : "";
    if (!kind) return NextResponse.json({ success: false, error: "지원하지 않는 파일 종류입니다." }, { status: 400 });
    const items = (Array.isArray(body.items) ? body.items : []).map((item: DiscontinueFileItem) => ({
      skuId: String(item?.skuId || "").trim(), productName: String(item?.productName || "").trim(),
    }));
    const date = koreaDateParts();
    const result = kind === "discontinue"
      ? await buildDiscontinueWorkbook(await loadDiscontinueTemplate(), items, date.iso)
      : await buildReleaseWorkbook(await loadReleaseTemplate(), items);
    const fileName = kind === "discontinue"
      ? `판매중지_SKU_영구생산중단_${date.compact}.xlsx`
      : `이메일발송용_노이드비_단종해제 SKU리스트_${date.compact}.xlsx`;
    const driveHeaders = await generatedDriveSaveHeaders(
      result.buffer,
      fileName,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ["쿠팡데이터", "단종 및 해제"],
    );
    return new NextResponse(result.buffer, {
      status: 200,
      headers: {
        ...driveHeaders,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
