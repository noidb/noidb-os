import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { getInboundDateResults } from "@/lib/wms/inbound-results";
import { buildCouponWorkbook, buildMissingWorkbook } from "@/lib/wms/inbound-output-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const results = await getInboundDateResults();
    return NextResponse.json({ success: true, results });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "입고결과를 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
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
    const couponName = `쿠폰발행리스트_입고일_${compact}.xlsx`;
    const missingName = `미입고_SKU리스트_입고일_${compact}.xlsx`;
    const zip = new JSZip();
    zip.file(couponName, coupon);
    zip.file(missingName, missing);
    const output = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const fileName = `입고결과_쿠폰_미입고_${compact}.zip`;
    return new NextResponse(output, { headers: {
      "Content-Type": "application/zip", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "X-NOIDB-File-Name": encodeURIComponent(fileName), "X-NOIDB-Coupon-Count": String(selected.couponItems.length),
      "X-NOIDB-Missing-Count": String(selected.missingItems.length), "X-NOIDB-Discount-Rate": String(discountRate),
    } });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "쿠폰·미입고 파일을 만들지 못했습니다." }, { status: 400 });
  }
}
