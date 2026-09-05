import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { getInboundDateResults } from "@/lib/wms/inbound-results";
import { buildCouponWorkbook, buildMissingWorkbook } from "@/lib/wms/inbound-output-files";
import { generatedDriveSaveHeaders } from "@/lib/wms/google-drive-oauth-writer";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  try {
    const results = await getInboundDateResults();
    return NextResponse.json({ success: true, results });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "입고결과를 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({ success: false, error: "입고결과 화면에서 파일 생성을 다시 눌러 주세요." }, { status: 403 });
  try {
    const body = await request.json();
    const actualDate = String(body.actualDate || "").trim();
    const discountRate = Number(body.discountRate);
    const results = await getInboundDateResults();
    const selected = results.find(result => result.actualDate === actualDate);
    if (!selected) throw new Error("선택한 실제 입고일의 자료를 찾지 못했습니다.");
    if (selected.nameConflicts.length) throw new Error(`상품명이 충돌하는 SKU ${selected.nameConflicts.length}개를 먼저 확인해 주세요.`);
    const [coupon, missing] = await Promise.all([
      buildCouponWorkbook(selected.couponItems, discountRate), buildMissingWorkbook(selected.missingItems),
    ]);
    const compact = actualDate.replace(/-/g, "");
    const couponBaseName = `쿠폰발행리스트_입고일_${compact}.xlsx`;
    const missingBaseName = `미입고_SKU리스트_입고일_${compact}.xlsx`;
    // Both workbooks must finish before saving either. New files only: reuse the
    // existing Drive writer's non-overwrite suffixes, without changing receipt/stock state.
    const folder = ["쿠팡데이터", "마케팅", "쿠폰관리"];
    const mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const [couponSaved, missingSaved] = await Promise.all([
      generatedDriveSaveHeaders(coupon, couponBaseName, mimeType, folder),
      generatedDriveSaveHeaders(missing, missingBaseName, mimeType, folder),
    ]);
    const couponName = decodeURIComponent(couponSaved["X-NOIDB-Drive-File-Name"] || encodeURIComponent(couponBaseName));
    const missingName = decodeURIComponent(missingSaved["X-NOIDB-Drive-File-Name"] || encodeURIComponent(missingBaseName));
    const driveSaved = couponSaved["X-NOIDB-Drive-Saved"] === "true" && missingSaved["X-NOIDB-Drive-Saved"] === "true";
    const zip = new JSZip();
    zip.file(couponName, coupon);
    zip.file(missingName, missing);
    const output = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const fileName = `입고결과_쿠폰_미입고_${compact}.zip`;
    return new NextResponse(output, { headers: {
      "Content-Type": "application/zip", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "X-NOIDB-File-Name": encodeURIComponent(fileName), "X-NOIDB-Coupon-Count": String(selected.couponItems.length),
      "X-NOIDB-Missing-Count": String(selected.missingItems.length), "X-NOIDB-Discount-Rate": String(discountRate),
      "Cache-Control": "no-store",
      "X-NOIDB-Coupon-File-Name": encodeURIComponent(couponName),
      "X-NOIDB-Missing-File-Name": encodeURIComponent(missingName),
      "X-NOIDB-Drive-Saved": String(driveSaved),
      ...(!driveSaved ? { "X-NOIDB-Drive-Save-Warning": encodeURIComponent("파일 두 개는 모두 생성했습니다. Drive 자동저장이 완료되지 않아 내려받은 ZIP 파일도 보관해 주세요. 파일폴더 연결을 확인해 주세요.") } : {}),
    } });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "쿠폰·미입고 파일을 만들지 못했습니다." }, { status: 400 });
  }
}
