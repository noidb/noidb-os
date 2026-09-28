import { randomBytes } from "node:crypto";
import { get, put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREFIX = "product-detail-previews/v1/";
const MAX_JPEG_BYTES = 3 * 1024 * 1024;

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "사이트 화면에서만 공유할 수 있습니다." }, { status: 403 });
  }
  if (Number(request.headers.get("content-length") || 0) > MAX_JPEG_BYTES * 1.5) {
    return NextResponse.json({ error: "상세이미지가 너무 큽니다." }, { status: 413 });
  }
  try {
    const body = await request.json() as { model?: string; dataUrl?: string };
    const model = String(body.model || "").trim();
    const match = String(body.dataUrl || "").match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
    if (!/^[A-Za-z0-9_-]{2,40}$/.test(model) || !match) {
      return NextResponse.json({ error: "모델명 또는 상세이미지가 올바르지 않습니다." }, { status: 400 });
    }
    const bytes = Buffer.from(match[1], "base64");
    if (!bytes.length || bytes.length > MAX_JPEG_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      return NextResponse.json({ error: "상세이미지 파일을 확인해주세요." }, { status: 413 });
    }
    const id = randomBytes(18).toString("base64url");
    await put(`${PREFIX}${id}.jpg`, bytes, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: "image/jpeg",
    });
    return NextResponse.json({ url: `${request.nextUrl.origin}/api/detail-preview-share?id=${id}` });
  } catch {
    return NextResponse.json({ error: "미리보기 링크를 만들지 못했습니다." }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id") || "";
  if (!/^[A-Za-z0-9_-]{24}$/.test(id)) return new NextResponse(null, { status: 404 });
  try {
    const result = await get(`${PREFIX}${id}.jpg`, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) return new NextResponse(null, { status: 404 });
    return new NextResponse(result.stream, {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Disposition": "inline; filename=detail-preview.jpg",
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}
