import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Attempt to fetch og:image / product images from a 1688 offer page.
 * Browser cannot download due to CORS; this server proxy tries HTML scrape.
 * If 1688 blocks the request, returns a clear error (no fake success).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const url = String(body.url || "").trim();
    if (!/^https?:\/\/(detail\.)?1688\.com\//i.test(url) && !/1688\.com\/offer\//i.test(url)) {
      return NextResponse.json(
        { error: "유효한 1688 상품 URL을 입력해주세요. 예: https://detail.1688.com/offer/....html" },
        { status: 400 }
      );
    }

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,ko;q=0.7",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      return NextResponse.json(
        {
          error: `1688 페이지를 열 수 없습니다 (${res.status}). 브라우저에서 이미지를 직접 저장한 뒤 "1688 이미지 직접 추가"를 사용해주세요.`,
        },
        { status: 502 }
      );
    }

    const html = await res.text();
    const urls = new Set<string>();

    const og = html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
    if (og?.[1]) urls.add(og[1]);

    const imgRe = /https?:\/\/[^"'\\\s>]+\.(?:jpg|jpeg|png|webp)/gi;
    const matches = html.match(imgRe) || [];
    for (const m of matches) {
      if (/avatar|logo|icon|sprite|qrcode/i.test(m)) continue;
      if (/alicdn|1688|cbu01|img\.alicdn/i.test(m)) urls.add(m.split("?")[0]);
      if (urls.size >= 8) break;
    }

    const imageList = [...urls].slice(0, 6);
    if (!imageList.length) {
      return NextResponse.json(
        {
          error:
            "1688에서 이미지를 추출하지 못했습니다(로그인·지역차단 가능). 이미지를 직접 다운로드한 뒤 업로드해주세요.",
        },
        { status: 404 }
      );
    }

    const images: { dataUrl: string; sourceUrl: string }[] = [];
    for (const imageUrl of imageList) {
      try {
        const imgRes = await fetch(imageUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            Referer: "https://detail.1688.com/",
          },
        });
        if (!imgRes.ok) continue;
        const buf = Buffer.from(await imgRes.arrayBuffer());
        if (buf.length < 800) continue;
        const ct = imgRes.headers.get("content-type") || "image/jpeg";
        const mime = ct.includes("png") ? "image/png" : "image/jpeg";
        images.push({
          dataUrl: `data:${mime};base64,${buf.toString("base64")}`,
          sourceUrl: imageUrl,
        });
        if (images.length >= 4) break;
      } catch {
        // skip failed image
      }
    }

    if (!images.length) {
      return NextResponse.json(
        {
          error:
            "이미지 URL은 찾았지만 다운로드에 실패했습니다. 1688에서 직접 저장 후 업로드해주세요.",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ images, count: images.length });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "1688 이미지 가져오기 실패. 직접 업로드를 사용해주세요.",
      },
      { status: 500 }
    );
  }
}
