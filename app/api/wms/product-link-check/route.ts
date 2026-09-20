import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 5000;

function allowedProductHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "coupang.com" || host === "www.coupang.com";
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("url")?.trim() || "";
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ ok: false, state: "invalid", message: "링크 형식이 올바르지 않습니다." }, { status: 400 });
  }
  if (target.protocol !== "https:" || !allowedProductHost(target.hostname) || !target.pathname.startsWith("/vp/products/")) {
    return NextResponse.json({ ok: false, state: "invalid", message: "쿠팡 상품 링크만 확인할 수 있습니다." }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(target.toString(), {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "Mozilla/5.0 NOID-B link check" },
    });
    const finalUrl = response.url || target.toString();
    if (response.status === 404) {
      return NextResponse.json({ ok: true, state: "not_found", status: response.status, finalUrl, message: "쿠팡에서 상품 페이지를 찾지 못했습니다." });
    }
    if (response.status === 401 || response.status === 403 || response.status === 429) {
      return NextResponse.json({ ok: true, state: "restricted", status: response.status, finalUrl, message: "쿠팡이 자동 확인을 제한했습니다. 링크를 직접 열어 확인해주세요." });
    }
    if (!response.ok) {
      return NextResponse.json({ ok: true, state: "error", status: response.status, finalUrl, message: `쿠팡 응답 오류 (HTTP ${response.status})` });
    }
    return NextResponse.json({ ok: true, state: "reachable", status: response.status, finalUrl, message: "쿠팡 상품 페이지 응답을 확인했습니다." });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return NextResponse.json({ ok: true, state: timedOut ? "timeout" : "error", message: timedOut ? "5초 안에 응답하지 않았습니다." : "상품 페이지 연결을 확인하지 못했습니다." });
  } finally {
    clearTimeout(timeout);
  }
}
