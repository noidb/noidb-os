import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const allowedOrigin = "https://advertising.coupang.com";

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin === allowedOrigin ? allowedOrigin : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-NOIDB-Collector",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);
  try {
    if (origin !== allowedOrigin || req.headers.get("x-noidb-collector") !== "v1") {
      return NextResponse.json({ ok: false, error: "허용되지 않은 요청입니다." }, { status: 403, headers });
    }
    const body = await req.json();
    const items = (Array.isArray(body?.items) ? body.items : []).slice(0, 5000).map((item: any) => ({
      imageUrl: String(item?.imageUrl || "").trim(),
      itemId: String(item?.itemId || item?.skuId || "").trim(),
      productName: String(item?.productName || "").trim(),
      productId: String(item?.productId || "").trim(),
      productLink: String(item?.productLink || "").trim(),
      exposedProductId: String(item?.exposedProductId || "").trim(),
      optionId: String(item?.optionId || item?.productId || "").trim(),
      inventory: Number(item?.inventory || 0),
      salePrice: Number(item?.salePrice || 0),
      clicks: Number(item?.clicks || 0),
      sales: Number(item?.sales || 0),
    })).filter((item: any) => item.productId || item.productName);
    if (!items.length) throw new Error("수집된 쿠팡 상품이 없습니다.");

    const webhookUrl = process.env.GOOGLE_SHEETS_WEB_APP_URL;
    if (!webhookUrl) throw new Error("Google 시트 연결 주소가 설정되지 않았습니다.");
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "replaceLiveCoupangInventory",
        secret: process.env.GOOGLE_SHEETS_WEBHOOK_SECRET || "",
        items,
      }),
    });
    const responseText = await response.text();
    let result: any;
    try { result = JSON.parse(responseText); } catch { result = { error: responseText }; }
    if (!response.ok || result?.ok === false) throw new Error(String(result?.error || `Google 시트 응답 오류 (${response.status})`));
    return NextResponse.json({ ok: true, rows: items.length, sheet: result.sheet, updatedAt: result.updatedAt }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "쿠팡 재고 갱신 실패" }, { status: 500, headers });
  }
}
