import { NextRequest, NextResponse } from "next/server";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { mutateWeeklyWorkspace } from "@/lib/wms/weekly-work-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/**
 * 입고결과 미납 SKU 리스트의 '재발주요청 제외'(2026-10-21).
 * 이미 단종했거나 아직 입고 전인 SKU를 미납분 재발주요청 파일에서 뺀다. 줄 키별로 기록하고 되돌릴 수 있다.
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({ ok: false, error: "입고결과 화면에서 다시 진행해 주세요." }, { status: 403, headers });
  try {
    const body = await request.json() as Record<string, unknown>;
    const lineKey = typeof body.lineKey === "string" && body.lineKey.length <= 300 ? body.lineKey : "";
    if (!lineKey) throw new Error("처리할 상품을 확인해 주세요.");
    const text = (value: unknown, max = 300) => typeof value === "string" ? value.slice(0, max) : "";
    const excluded = await mutateWeeklyWorkspace(workspace => {
      const current = { ...(workspace.reorderExcluded || {}) };
      if (body.action === "undo") delete current[lineKey];
      else if (body.action === "exclude") {
        if (workspace.logisticsReceiptRoutes?.[lineKey]) throw new Error("이미 처리한 상품입니다. 새로고침하면 목록에서 빠집니다.");
        current[lineKey] = { skuId: text(body.skuId, 20), productName: text(body.productName), shipmentNumber: text(body.shipmentNumber, 20),
          quantity: Number.isSafeInteger(body.quantity) ? Number(body.quantity) : 0, at: new Date().toISOString() };
      } else throw new Error("처리 방법을 확인해 주세요.");
      workspace.reorderExcluded = current;
      return current;
    });
    return NextResponse.json({ ok: true, reorderExcluded: excluded }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "저장하지 못했습니다." }, { status: 400, headers });
  }
}
