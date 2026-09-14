import { NextRequest, NextResponse } from "next/server";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { loadConfirmedQuantityFiles } from "@/lib/wms/hanjin-shipment-auto";
import { inspectConfirmedFileLinks } from "@/lib/wms/po-confirm-file-link";
import { buildPurchaseOrderIndex, getCachedPurchaseOrderIndex } from "@/lib/wms/purchase-order-source/index";
import { readPickingWaveStore, mutatePickingWaveStore } from "@/lib/wms/picking-wave/server-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const headers = { "Cache-Control": "private, no-store, max-age=0" };

export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({ error: "출고작업 화면에서 다시 확인해 주세요." }, { status: 403, headers });
  const input = await request.json().catch(() => null);
  if (!input || typeof input.waveId !== "string" || !input.waveId.trim() || !["preview", "connect"].includes(input.action)) return NextResponse.json({ error: "확인할 출고작업을 선택해 주세요." }, { status: 400, headers });
  if (input.action === "connect" && (input.confirmed !== true || typeof input.token !== "string")) return NextResponse.json({ error: "확정파일의 발주와 수량을 확인한 뒤 연결해 주세요." }, { status: 400, headers });
  try {
    const snapshot = await readPickingWaveStore();
    // Legacy standalone Shipment screens have no Wave confirmation batch to repair.
    if (!snapshot.waves.some(wave => wave.id === input.waveId)) return NextResponse.json({ groups: [] }, { headers });
    const [index, files] = await Promise.all([
      input.action === "connect" ? buildPurchaseOrderIndex() : getCachedPurchaseOrderIndex(),
      loadConfirmedQuantityFiles(),
    ]);
    const groups = inspectConfirmedFileLinks(snapshot, input.waveId, index, files);
    if (input.action === "preview") return NextResponse.json({ groups }, { headers });
    const matches = groups.flatMap(group => group.candidates.map(candidate => ({ group, candidate }))).filter(({ candidate }) => candidate.token === input.token);
    if (matches.length !== 1) return NextResponse.json({ error: "파일 또는 발주 정보가 변경되었습니다. 다시 확인해 주세요." }, { status: 409, headers });
    const { group, candidate } = matches[0];
    const file = files.find(file => file.name === candidate.fileName)!;
    await mutatePickingWaveStore({
      action: "repairConfirmedFileLinks",
      before: snapshot.poConfirmationRecords.filter(record => group.purchaseOrderNumbers.includes(record.poNumber)),
      fileName: file.name, contentHash: file.contentHash!, now: new Date().toISOString(),
    });
    return NextResponse.json({ connected: true, fileName: file.name, purchaseOrderCount: group.purchaseOrderNumbers.length }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return NextResponse.json({ error: message.startsWith("다른 기기에서") ? message : "확정파일 연결을 확인하지 못했습니다. 발주서 완성파일 폴더의 연결을 확인해 주세요." }, { status: 409, headers });
  }
}
