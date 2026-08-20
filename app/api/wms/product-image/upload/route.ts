import { NextRequest, NextResponse } from "next/server";
import { uploadImageToDriveOAuth, DriveFolderAccessError } from "@/lib/wms/google-drive-user";
import { isDriveOAuthConfigured, DriveOAuthNotConfiguredError, DriveOAuthNotConnectedError, DriveOAuthTokenInvalidError } from "@/lib/wms/google-drive-oauth";

/**
 * 상품 상세 화면의 "사진 촬영/썸네일 교체"가 올린 이미지를 구글드라이브에 저장하고
 * 뷰 URL만 돌려준다. 제품DB 시트에 값을 쓰지는 않는다 — 그건 사용자가 저장을 누른 뒤
 * /api/wms/product-catalog/update가 별도로 처리한다. 원본 사진을 시트 셀에 base64로
 * 직접 저장하지 않는다(2026-08-19 사용자 확정).
 *
 * 2026-08-20부터: 업로드는 서비스 계정이 아니라 사용자 OAuth(lib/wms/google-drive-user.ts)를
 * 쓴다 — 서비스 계정은 Drive 저장 할당량이 0이라 업로드가 항상 실패했다. 에러는 화면에서
 * 구분해 보여줄 수 있도록 code 필드를 함께 내려준다.
 */
export const runtime = "nodejs";

function decodeDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string } | null {
  const match = dataUrl.match(/^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
}

export async function POST(request: NextRequest) {
  try {
    if (!isDriveOAuthConfigured()) {
      return NextResponse.json(
        { success: false, code: "oauth_not_configured", error: "Google Drive 연결이 아직 설정되지 않았습니다(관리자 설정 필요)." },
        { status: 400 }
      );
    }

    const body = await request.json();
    const dataUrl: string = body.dataUrl || "";
    const skuId: string = body.skuId || "image";
    const decoded = decodeDataUrl(dataUrl);
    if (!decoded) {
      return NextResponse.json({ success: false, code: "invalid_image", error: "이미지 데이터 형식이 올바르지 않습니다." }, { status: 400 });
    }
    if (decoded.buffer.length > 8 * 1024 * 1024) {
      return NextResponse.json({ success: false, code: "too_large", error: "이미지 용량이 너무 큽니다(8MB 초과)." }, { status: 400 });
    }

    const extension = decoded.mimeType.includes("png") ? "png" : "jpg";
    const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_");
    const filename = `${skuId}_${timestamp}.${extension}`;
    const result = await uploadImageToDriveOAuth(decoded.buffer, filename, decoded.mimeType);

    return NextResponse.json({ success: true, url: result.url });
  } catch (error) {
    if (error instanceof DriveOAuthNotConfiguredError) {
      return NextResponse.json({ success: false, code: "oauth_not_configured", error: error.message }, { status: 400 });
    }
    if (error instanceof DriveOAuthNotConnectedError) {
      return NextResponse.json({ success: false, code: "not_connected", error: error.message }, { status: 401 });
    }
    if (error instanceof DriveOAuthTokenInvalidError) {
      return NextResponse.json({ success: false, code: "token_invalid", error: error.message }, { status: 401 });
    }
    if (error instanceof DriveFolderAccessError) {
      return NextResponse.json({ success: false, code: "folder_access_failed", error: error.message }, { status: 500 });
    }
    return NextResponse.json(
      { success: false, code: "upload_failed", error: error instanceof Error ? error.message : "이미지 업로드 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
