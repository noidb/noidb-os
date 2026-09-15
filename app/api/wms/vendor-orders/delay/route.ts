import { NextRequest, NextResponse } from "next/server";
import { mutatePickingWaveStore } from "@/lib/wms/picking-wave/server-store";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
export const runtime = "nodejs", dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({success:false,error:"거래처 발주 화면에서 진행해 주세요."},{status:403});
  try {
    const body=await request.json();
    if(typeof body.lineId!=="string" || !body.lineId || typeof body.expectedUpdatedAt!=="string" || typeof body.delayed!=="boolean" || typeof body.memo!=="string" || body.memo.length>500) throw new Error("입고지연 상품과 메모를 확인해 주세요.");
    const saved=await mutatePickingWaveStore({action:"setSentVendorDelay",lineId:body.lineId,expectedUpdatedAt:body.expectedUpdatedAt,delayed:body.delayed,memo:body.memo,now:new Date().toISOString()});
    return NextResponse.json({success:true,line:saved.vendorOrderLines.find(line=>line.id===body.lineId)},{headers:{"Cache-Control":"no-store"}});
  } catch(error) { return NextResponse.json({success:false,error:error instanceof Error?error.message:"입고지연 저장에 실패했습니다."},{status:409}); }
}
