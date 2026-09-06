import { NextRequest, NextResponse } from "next/server";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { mutatePickingWaveStore } from "@/lib/wms/picking-wave/server-store";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({error:"검수·포장 화면에서 다시 시도해 주세요."},{status:403});
  const input = await request.json().catch(() => null);
  if (!input || typeof input.waveId !== "string" || typeof input.generationKey !== "string" || !Array.isArray(input.rows) || !Array.isArray(input.checkedKeys) || !(input.dispatchedShipmentNumbers === undefined || Array.isArray(input.dispatchedShipmentNumbers)) || !(input.expectedUpdatedAt === null || typeof input.expectedUpdatedAt === "string") || typeof input.dispatched !== "boolean" || (input.dispatched && input.confirmed !== true)) return NextResponse.json({error:"검수 저장 요청을 확인해 주세요."},{status:400});
  try {
    const snapshot = await mutatePickingWaveStore({action:"savePackingProgress",waveId:input.waveId,generationKey:input.generationKey,rows:input.rows,checkedKeys:input.checkedKeys,dispatchedShipmentNumbers:input.dispatchedShipmentNumbers,expectedUpdatedAt:input.expectedUpdatedAt,dispatched:input.dispatched,now:new Date().toISOString()});
    return NextResponse.json({progress:snapshot.packingProgress?.[input.waveId]});
  } catch(error) { return NextResponse.json({error:error instanceof Error ? error.message : "검수 기록 저장에 실패했습니다."},{status:409}); }
}
