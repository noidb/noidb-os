import { NextRequest, NextResponse } from "next/server";
import { fetchSheetRows } from "@/lib/wms/google-sheets";
import { STORAGE_TAB } from "@/lib/wms/warehouse-recheck-cleanup";
import { loadReregistrationLookup } from "@/lib/wms/reregistration-lookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const clean = (value: unknown) => String(value ?? "").trim();

/**
 * 제품DB에 없는 SKU의 상품명 찾기(2026-10-21, 입고결과 누적 화면).
 * 재등록을 마친 옛 SKU·가품중단 등은 보관 탭으로 옮겨져 제품DB에 없어서 상품명이 비어 보였다.
 * 보관 탭에서 먼저 찾고, 없으면 재등록SKU 탭·_SKU교체이력의 상품명을 쓴다. 읽기만 한다.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { skuIds?: unknown };
    const wanted = new Set(Array.isArray(body.skuIds) ? body.skuIds.map(clean).filter(id => /^\d{5,20}$/.test(id)).slice(0, 5000) : []);
    if (!wanted.size) return NextResponse.json({ ok: true, items: [] }, { headers });
    const [storage, reregistration] = await Promise.all([
      fetchSheetRows(STORAGE_TAB).catch(() => [] as string[][]),
      loadReregistrationLookup().catch(() => ({ reregisteredSkuIds: new Set<string>(), names: {} as Record<string, string>, loaded: false })),
    ]);
    const found = new Map<string, { skuId: string; productName: string; optionLabel: string; currentStatus: string }>();
    const head = (storage[0] || []).map(clean);
    const skuColumn = head.indexOf("SKU ID"), nameColumn = head.indexOf("상품명"), optionColumn = head.indexOf("색상"), statusColumn = head.indexOf("현재상태");
    if (skuColumn >= 0) for (const row of storage.slice(1)) {
      const skuId = clean(row[skuColumn]);
      if (!wanted.has(skuId) || found.has(skuId)) continue;
      found.set(skuId, { skuId, productName: nameColumn >= 0 ? clean(row[nameColumn]) : "", optionLabel: optionColumn >= 0 ? clean(row[optionColumn]) : "", currentStatus: statusColumn >= 0 ? clean(row[statusColumn]) : "" });
    }
    for (const skuId of wanted) {
      if (found.get(skuId)?.productName) continue;
      const name = reregistration.names[skuId];
      if (name) found.set(skuId, { skuId, productName: name, optionLabel: found.get(skuId)?.optionLabel || "", currentStatus: found.get(skuId)?.currentStatus || "" });
    }
    return NextResponse.json({ ok: true, items: [...found.values()] }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "상품명을 찾지 못했습니다." }, { status: 500, headers });
  }
}
