import { NextRequest, NextResponse } from "next/server";
import { uploadImageToDrive } from "@/lib/wms/google-drive";
import { isWmsGoogleSheetsConfigured } from "@/lib/wms/google-sheets";

/**
 * 상품 상세 화면의 "사진 촬영/썸네일 교체"가 올린 이미지를 구글드라이브에 저장하고
 * 뷰 URL만 돌려준다. 제품DB 시트에 값을 쓰지는 않는다 — 그건 사용자가 저장을 누른 뒤
 * /api/wms/product-catalog/update가 별도로 처리한다. 원본 사진을 시트 셀에 base64로
 * 직접 저장하지 않는다(2026-08-19 사용자 확정).
 */
export const runtime = "nodejs";

function decodeDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string } | null {
  const match = dataUrl.match(/^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
}

export async function POST(request: NextRequest) {
  try {
    if (!isWmsGoogleSheetsConfigured()) {
      return NextResponse.json({ success: false, error: "구글시트 연결이 설정되지 않았습니다." }, { status: 400 });
    }

    const body = await request.json();
    const dataUrl: string = body.dataUrl || "";
    const skuId: string = body.skuId || "image";
    const decoded = decodeDataUrl(dataUrl);
    if (!decoded) {
      return NextResponse.json({ success: false, error: "이미지 데이터 형식이 올바르지 않습니다." }, { status: 400 });
    }
    if (decoded.buffer.length > 8 * 1024 * 1024) {
      return NextResponse.json({ success: false, error: "이미지 용량이 너무 큽니다(8MB 초과)." }, { status: 400 });
    }

    const extension = decoded.mimeType.includes("png") ? "png" : "jpg";
    const filename = `SKU_${skuId}_${Date.now()}.${extension}`;
    const result = await uploadImageToDrive(decoded.buffer, filename, decoded.mimeType);

    return NextResponse.json({ success: true, url: result.url });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "이미지 업로드 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
