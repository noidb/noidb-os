import { NextRequest, NextResponse } from "next/server";
import { fetchSheetRows } from "@/lib/wms/google-sheets";
import { legacyNameScore, legacyNameTokens } from "@/lib/wms/legacy-sku-match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const clean = (value: unknown) => String(value ?? "").trim();

/**
 * 반려된 재등록 모델의 상품명으로 '_SKU마스터'(쿠팡 상품공급상태의 전체 SKU)에서 예전 SKU 후보를 찾는다(읽기 전용).
 * 몸체: { names: string[] } → { candidates: [{ skuId, productName, barcode, orderableStatus, score }] }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { names?: unknown };
    const names = Array.isArray(body.names) ? body.names.map(clean).filter(Boolean).slice(0, 30) : [];
    const queries = names.map(legacyNameTokens).filter(tokens => tokens.length >= 2);
    if (!queries.length) return NextResponse.json({ ok: true, candidates: [] }, { headers });
    const rows = await fetchSheetRows("_SKU마스터");
    const head = (rows[0] || []).map(clean);
    const sku = head.indexOf("SKU ID"), name = head.indexOf("상품명"), barcode = head.indexOf("바코드"), status = head.indexOf("발주가능상태");
    if (sku < 0 || name < 0) throw new Error("_SKU마스터 탭의 SKU ID·상품명 열을 찾지 못했습니다.");
    const candidates = rows.slice(1).map(row => {
      const tokens = legacyNameTokens(clean(row[name]));
      const score = Math.max(...queries.map(query => legacyNameScore(query, tokens)));
      return { skuId: clean(row[sku]), productName: clean(row[name]), barcode: barcode >= 0 ? clean(row[barcode]).toUpperCase() : "", orderableStatus: status >= 0 ? clean(row[status]) : "", score };
    }).filter(item => /^\d{5,20}$/.test(item.skuId) && item.score >= 0.6)
      .sort((a, b) => b.score - a.score || a.skuId.localeCompare(b.skuId))
      .slice(0, 15);
    return NextResponse.json({ ok: true, candidates }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "예전 SKU를 찾지 못했습니다." }, { status: 500, headers });
  }
}
