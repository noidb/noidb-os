import { NextRequest, NextResponse } from "next/server";
import { readWeeklyWorkspace } from "@/lib/wms/weekly-work-store";
import { assertWeeklyCurrentRules, requireWeeklyRun, weeklySelectedCoupons } from "@/lib/wms/weekly-work-state";
import { loadWeeklyAdvertisingSelection } from "@/lib/wms/weekly-advertising-source";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;
export async function GET(request:NextRequest) {
  try {
    const params=request.nextUrl.searchParams;
    const revision=params.has("expectedRevision")?Number(params.get("expectedRevision")):undefined;
    if(revision!==undefined&&(!Number.isSafeInteger(revision)||revision<0))throw new Error("최신 쿠폰 선택을 확인한 뒤 다시 진행해 주세요.");
    const run=requireWeeklyRun(await readWeeklyWorkspace(),params.get("runId"),revision);
    assertWeeklyCurrentRules(run);
    const selection=await loadWeeklyAdvertisingSelection(run);
    const current=requireWeeklyRun(await readWeeklyWorkspace(),run.id);
    if(JSON.stringify(weeklySelectedCoupons(current).map(item=>item.skuId))!==JSON.stringify(weeklySelectedCoupons(run).map(item=>item.skuId)))throw new Error("쿠폰 선택이 변경됐습니다. 광고 옵션 ID를 다시 확인해 주세요.");
    return NextResponse.json({success:true,...selection},{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){return NextResponse.json({success:false,error:error instanceof Error?error.message:"광고 옵션 ID를 확인하지 못했습니다."},{status:409,headers:{"Cache-Control":"private, no-store"}});}
}
