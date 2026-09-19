import { NextRequest, NextResponse } from "next/server";
import { InvoiceGroupStoreBusyError, mutateInvoiceGroupStore, readInvoiceGroupStore } from "@/lib/wms/invoice-group/server-store";
import { isInvoiceGroupStoreMutation, type InvoiceGroupStoreMutation } from "@/lib/wms/invoice-group/shared-store-types";

/**
 * 발주묶음(InvoiceGroup) 전용 API — /api/wms/picking-waves와 완전히 독립된 저장소를 읽고 쓴다.
 * 발주확정 기록 → 한진 송장생성 → 쉽먼트 업로드 → 바코드/출력세트 생성까지, 웨이브 없이
 * 이 저장소 하나로 진행 상태를 추적한다.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET() {
  try {
    return NextResponse.json({ ok: true, snapshot: await readInvoiceGroupStore() }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "발주묶음을 불러오지 못했습니다." }, { status: 500, headers: noStoreHeaders });
  }
}

export async function POST(request: NextRequest) {
  try {
    const mutation: unknown = await request.json();
    if (!isInvoiceGroupStoreMutation(mutation)) {
      return NextResponse.json({ ok: false, error: "저장 요청 형식이 올바르지 않습니다." }, { status: 400, headers: noStoreHeaders });
    }
    return NextResponse.json({ ok: true, snapshot: await mutateInvoiceGroupStore(mutation as InvoiceGroupStoreMutation) }, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof InvoiceGroupStoreBusyError) {
      return NextResponse.json({ ok: false, error: "저장 서버가 잠시 혼잡합니다. 자동으로 다시 시도하고 있습니다." }, { status: 503, headers: { ...noStoreHeaders, "Retry-After": String(error.retryAfterSeconds) } });
    }
    console.error("[invoice-group-store]", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "발주묶음 저장에 실패했습니다." }, { status: 500, headers: noStoreHeaders });
  }
}
