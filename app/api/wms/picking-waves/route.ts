import { NextRequest, NextResponse } from "next/server";
import { mutatePickingWaveStore, PickingWaveStoreBusyError, readPickingWaveStore } from "@/lib/wms/picking-wave/server-store";
import type { PickingWaveStoreMutation } from "@/lib/wms/picking-wave/shared-store-types";
import { isPickingWaveStoreMutation } from "@/lib/wms/picking-wave/shared-store-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET() {
  try {
    return NextResponse.json({ ok: true, snapshot: await readPickingWaveStore() }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "웨이브를 불러오지 못했습니다." }, { status: 500, headers: noStoreHeaders });
  }
}

export async function POST(request: NextRequest) {
  try {
    const mutation: unknown = await request.json();
    if (!isPickingWaveStoreMutation(mutation)) {
      return NextResponse.json({ ok: false, error: "저장 요청 형식이 올바르지 않습니다." }, { status: 400, headers: noStoreHeaders });
    }
    // Filing requires the dedicated work-center confirmation and same-origin checks.
    if (mutation.action === "setOutboundWorkState") {
      return NextResponse.json({ ok: false, error: "작업센터에서 변경 내용을 확인한 뒤 저장해 주세요." }, { status: 403, headers: noStoreHeaders });
    }
    return NextResponse.json({ ok: true, snapshot: await mutatePickingWaveStore(mutation as PickingWaveStoreMutation) }, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof PickingWaveStoreBusyError) {
      return NextResponse.json({ ok: false, error: "저장 서버가 잠시 혼잡합니다. 자동으로 다시 시도하고 있습니다." }, { status: 503, headers: { ...noStoreHeaders, "Retry-After": String(error.retryAfterSeconds) } });
    }
    console.error("[picking-wave-store]", error);
    return NextResponse.json({ ok: false, error: "웨이브를 저장하지 못했습니다. 기존 데이터는 변경되지 않았습니다. 잠시 후 다시 시도해주세요." }, { status: 500, headers: noStoreHeaders });
  }
}
