import { NextRequest, NextResponse } from "next/server";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { mutateWeeklyWorkspace } from "@/lib/wms/weekly-work-store";
import { readPickingWaveStore } from "@/lib/wms/picking-wave/server-store";
import { reconcileIncompleteVendorRoutes } from "@/lib/wms/logistics-receipt-routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/** 미납분을 새로 발주하지 않고 이미 보낸 거래처 발주로 처리했다고 기록한다(되돌리기 가능). */
export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({ ok: false, error: "입고결과 화면에서 다시 진행해 주세요." }, { status: 403, headers });
  try {
    const body = await request.json() as Record<string, unknown>;
    const lineKey = typeof body.lineKey === "string" && body.lineKey.length <= 300 ? body.lineKey : "";
    if (!lineKey) throw new Error("처리할 상품을 확인해 주세요.");
    const text = (value: unknown, max = 300) => typeof value === "string" ? value.slice(0, max) : "";
    const vendorStore = await readPickingWaveStore().catch(() => null);
    const covered = await mutateWeeklyWorkspace(workspace => {
      if (vendorStore) reconcileIncompleteVendorRoutes(workspace, vendorStore);
      const current = { ...(workspace.coveredByVendorOrder || {}) };
      if (body.action === "undo") delete current[lineKey];
      else if (body.action === "cover") {
        const sent = workspace.logisticsReceiptRoutes?.[lineKey];
        if (sent) {
          const label = sent.decision === "vendor" ? "거래처발주" : sent.decision === "discontinue" ? "단종" : sent.decision === "reorder" ? "미납분 재발주요청" : "쿠폰·광고";
          throw new Error(sent.completed ? `이미 ${label}(으)로 보낸 상품입니다. 새로고침하면 목록에서 빠집니다.` : `${label} 저장이 아직 끝나지 않았습니다. 2분 뒤 새로고침한 다음 다시 골라 주세요.`);
        }
        current[lineKey] = { skuId: text(body.skuId, 20), productName: text(body.productName), shipmentNumber: text(body.shipmentNumber, 20),
          quantity: Number.isSafeInteger(body.quantity) ? Number(body.quantity) : 0,
          vendors: Array.isArray(body.vendors) ? body.vendors.map(value => text(value, 100)).slice(0, 10) : [],
          sentOn: text(body.sentOn, 10), at: new Date().toISOString() };
      } else throw new Error("처리 방법을 확인해 주세요.");
      workspace.coveredByVendorOrder = current;
      return current;
    });
    return NextResponse.json({ ok: true, coveredByVendorOrder: covered }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "저장하지 못했습니다." }, { status: 400, headers });
  }
}
