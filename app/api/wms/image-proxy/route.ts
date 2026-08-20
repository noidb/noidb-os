import { NextRequest, NextResponse } from "next/server";

/**
 * 거래처 발주서 이미지(카카오톡 공유/이미지 저장) 생성 시 Canvas에 그리기 위한 이미지 프록시.
 *
 * 근본 원인(2026-08-19 3차 실사용 테스트 확인): 화면의 <img> 태그는 CORS 없이도 잘 보이지만,
 * Canvas에 픽셀 단위로 그려 canvas.toBlob()으로 내보내려면 crossOrigin="anonymous"로 이미지를
 * 불러와야 한다. 구글드라이브(drive.google.com/uc?export=view)와 쿠팡 CDN은 CORS 허용 헤더
 * (Access-Control-Allow-Origin)를 보내지 않아, crossOrigin="anonymous" 로딩이 항상 실패하고
 * 모든 상품이 "이미지 미등록"으로 보였다. 이 라우트가 서버에서 대신 이미지를 받아 우리 origin으로
 * 그대로 전달하면, 브라우저 입장에서는 같은 origin 이미지가 되어 CORS 문제 없이 Canvas에 그릴 수
 * 있다 — 외부 서비스를 새로 추가하는 것이 아니라 우리 서버가 이미 참조 중인 이미지 주소를 그대로
 * 중계할 뿐이다. SSRF 방지를 위해 실제로 쓰이는 이미지 호스트만 허용한다.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_HOST_SUFFIXES = ["drive.google.com", "googleusercontent.com", "coupangcdn.com"];

function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some(suffix => host === suffix || host.endsWith(`.${suffix}`));
}

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url");
  if (!rawUrl) {
    return NextResponse.json({ error: "url 파라미터가 필요합니다." }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "잘못된 이미지 주소입니다." }, { status: 400 });
  }

  if (target.protocol !== "https:" || !isAllowedHost(target.hostname)) {
    return NextResponse.json({ error: "허용되지 않은 이미지 주소입니다." }, { status: 400 });
  }

  try {
    const upstream = await fetch(target.toString(), { cache: "no-store" });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: `이미지 조회 실패 (HTTP ${upstream.status})` }, { status: 502 });
    }
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const buffer = await upstream.arrayBuffer();
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "이미지 프록시 조회 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
