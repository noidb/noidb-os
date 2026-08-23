import { NextRequest, NextResponse } from "next/server";
import { downloadDriveFile, searchDriveFilesByName } from "@/lib/wms/google-drive-reader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const model = (request.nextUrl.searchParams.get("model") || "").trim();
  if (!/^[a-z0-9_-]{3,40}$/i.test(model)) {
    return NextResponse.json({ error: "올바른 모델명이 필요합니다." }, { status: 400 });
  }
  try {
    const files = await searchDriveFilesByName(model);
    const exact = files.find(file => file.mimeType.startsWith("image/") && new RegExp(`(^|[^a-z0-9])${model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(file.name));
    // 검색 결과의 첫 이미지를 임의 사용하면 다른 옵션/모델 이미지가 섞일 수 있다. 파일명에
    // 요청한 모델SKU/모델명이 경계까지 정확히 포함된 실제 이미지 한 건만 허용한다.
    const image = exact;
    if (!image) return NextResponse.json({ error: "Drive에서 모델 이미지를 찾을 수 없습니다." }, { status: 404 });
    const buffer = await downloadDriveFile(image.id);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": image.mimeType.startsWith("image/") ? image.mimeType : "image/jpeg",
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Drive 이미지 조회에 실패했습니다." }, { status: 500 });
  }
}
