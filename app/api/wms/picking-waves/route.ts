import { NextRequest, NextResponse } from "next/server";
import { mutatePickingWaveStore, readPickingWaveStore } from "@/lib/wms/picking-wave/server-store";
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
    return NextResponse.json({ ok: true, snapshot: await mutatePickingWaveStore(mutation as PickingWaveStoreMutation) }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "웨이브를 저장하지 못했습니다." }, { status: 500, headers: noStoreHeaders });
  }
}
