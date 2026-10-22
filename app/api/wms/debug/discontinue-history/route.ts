import { NextResponse } from "next/server";
import { collectSiteDiscontinueHistory } from "@/lib/wms/discontinue-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 읽기 전용(2026-10-22): 단종으로 보낸 기록을 SKU별로 모아 보는 확인용. */
export async function GET() {
  const { events, errors } = await collectSiteDiscontinueHistory();
  const skus = Object.fromEntries([...events.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([skuId, set]) => [skuId, [...set].sort().join(", ")]));
  return NextResponse.json({ ok: true, count: events.size, errors, skus }, { headers: { "Cache-Control": "private, no-store" } });
}
