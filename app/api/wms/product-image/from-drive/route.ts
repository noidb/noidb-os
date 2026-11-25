import { NextRequest, NextResponse } from "next/server";
import { downloadDriveFile, searchDriveFilesByName } from "@/lib/wms/google-drive-reader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 2026-11-25 같은 이름의 고화질 파일이 둘 이상이고 그중 어느 쪽이 맞는지 사람이 눈으로 확인한 경우의 지정.
 * (wn00381SI: 98KB 흰 배경 펜던트 사진이 맞고, 162KB 검은 배경 착용컷은 다른 사진이라 쓰지 않는다.)
 * 키는 소문자 모델SKU, 값은 드라이브 파일 id.
 */
const PREFERRED_PHOTO_FILE_IDS: Record<string, string> = {
  wn00381si: "1gF7uRxWGoWIrKngmlv182QLJxfGw_5A1",
};

export async function GET(request: NextRequest) {
  const model = (request.nextUrl.searchParams.get("model") || "").trim();
  // 2026-11-25 exact=1: 파일명이 `모델SKU.jpg`(.jpeg/.png/.webp)로 정확히 같은 사진만 찾는다(거래처 발주서 고화질 사진용).
  // 없으면 다른 사진으로 대신하지 않고 404를 돌려, 호출한 쪽이 제품DB 이미지 주소로 되돌아가게 한다.
  const exactOnly = request.nextUrl.searchParams.get("exact") === "1";
  if (!/^[a-z0-9_-]{3,40}$/i.test(model)) {
    return NextResponse.json({ error: "올바른 모델명이 필요합니다." }, { status: 400 });
  }
  try {
    const files = await searchDriveFilesByName(model);
    const escapedModel = model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let image: (typeof files)[number] | undefined;
    if (exactOnly) {
      const images = files.filter(file => file.mimeType.startsWith("image/"));
      const preferredId = PREFERRED_PHOTO_FILE_IDS[model.toLowerCase()];
      const exactName = new RegExp(`^${escapedModel}\\.(jpe?g|png|webp)$`, "i");
      image = (preferredId ? images.find(file => file.id === preferredId) : undefined) || images.find(file => exactName.test(file.name));
      if (!image) {
        return NextResponse.json({ error: "Drive에서 같은 이름의 사진을 찾을 수 없습니다." }, { status: 404, headers: { "Cache-Control": "public, max-age=600" } });
      }
    } else {
      const exact = files.find(file => file.mimeType.startsWith("image/") && new RegExp(`(^|[^a-z0-9])${escapedModel}([^a-z0-9]|$)`, "i").test(file.name));
      // 검색 결과의 첫 이미지를 임의 사용하면 다른 옵션/모델 이미지가 섞일 수 있다. 파일명에
      // 요청한 모델SKU/모델명이 경계까지 정확히 포함된 실제 이미지 한 건만 허용한다.
      image = exact;
    }
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
