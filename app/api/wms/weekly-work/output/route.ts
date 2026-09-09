import { NextRequest, NextResponse } from "next/server";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { readWeeklyWorkspace } from "@/lib/wms/weekly-work-store";
import { requireWeeklyRun, assertWeeklyCouponEligibility, assertWeeklyReviewEligibility, assertWeeklyCurrentRules, assertWeeklyReorderEligibility, weeklyReorderRows, weeklySelectedCoupons } from "@/lib/wms/weekly-work-state";
import { readWeeklyOperationalToken } from "@/lib/wms/weekly-work-source";
import { readWeeklyFile, saveWeeklyFile } from "@/lib/wms/weekly-work-files";
import { buildWeeklyOutput, weeklyOutputKey, type WeeklyOutput, type WeeklyOutputKind } from "@/lib/wms/weekly-work-output";
import { loadWeeklyAdvertisingSelection } from "@/lib/wms/weekly-advertising-source";
import { assertWeeklyAdvertisingSelection } from "@/lib/wms/weekly-advertising";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;
export async function POST(request:NextRequest) {
  if(!isSameOriginActionRequest(request))return NextResponse.json({success:false,error:"주간 업무 화면에서 파일을 생성해 주세요."},{status:403});
  try {
    const body=await request.json();
    if(!["all","coupon","vendors","discontinue","reorder","marketing"].includes(body.kind))throw new Error("파일 종류를 선택해 주세요.");
    if(!Number.isSafeInteger(body.expectedRevision)||Number(body.expectedRevision)<0)throw new Error("업무의 최신 검토 상태를 확인하지 못했습니다. 새로고침 후 다시 진행해 주세요.");
    const workspace=await readWeeklyWorkspace();
    const run=requireWeeklyRun(workspace,body.runId,body.expectedRevision);
    assertWeeklyCurrentRules(run);
    const includesCoupons=body.kind==="all"||body.kind==="coupon"||body.kind==="marketing";
    const includesAdvertising=(body.kind==="all"||body.kind==="marketing")&&weeklySelectedCoupons(run).length>0;
    const includesReorders=(body.kind==="all"||body.kind==="reorder") && Object.values(run.reviews).some(review=>review.decision==="reorder");
    if((body.kind==="coupon"||body.kind==="marketing")&&!weeklySelectedCoupons(run).length)throw new Error("쿠폰을 적용할 SKU를 선택해 주세요.");
    if(includesCoupons)assertWeeklyCouponEligibility(workspace,run);
    if(!["coupon","marketing"].includes(body.kind))assertWeeklyReviewEligibility(workspace,run);
    if(includesReorders) {
      weeklyReorderRows(run);
      assertWeeklyReorderEligibility(workspace,run);
      if(run.snapshot.operationalToken!==await readWeeklyOperationalToken())throw new Error("분석 이후 발주·입고 자료가 변경됐습니다. 최신 자료로 다시 준비해 주세요.");
    }
    const advertising=includesAdvertising?await loadWeeklyAdvertisingSelection(run):undefined;
    if(includesAdvertising)assertWeeklyAdvertisingSelection(run,advertising);
    const now=new Date();
    const outputKey=weeklyOutputKey(run,body.kind as WeeklyOutputKind,now,advertising?.token);
    const key=`output-${outputKey}.json`;
    const cached=await readWeeklyFile(key);
    let output:WeeklyOutput;
    if(cached)output=JSON.parse(cached.toString());
    else {
      if(!includesReorders&&(body.kind==="all"||body.kind==="vendors")&&run.snapshot.operationalToken!==await readWeeklyOperationalToken())throw new Error("분석 이후 발주·입고 자료가 변경됐습니다. 최신 자료로 다시 준비해 주세요. 기존에 생성한 파일은 다시 받을 수 있습니다.");
      output=await buildWeeklyOutput(run,body.kind,now,advertising);
      await saveWeeklyFile(key,Buffer.from(JSON.stringify(output)));
    }
    {
      if(includesReorders && run.snapshot.operationalToken!==await readWeeklyOperationalToken())throw new Error("파일 생성 중 발주·입고 자료가 변경됐습니다. 최신 자료로 다시 준비해 주세요.");
      if(includesAdvertising) {
        const latestAdvertising=await loadWeeklyAdvertisingSelection(run);
        assertWeeklyAdvertisingSelection(run,latestAdvertising);
        if(latestAdvertising.token!==advertising?.token||output.generated.advertisingToken!==latestAdvertising.token)throw new Error("광고 옵션 ID 연결이 변경됐습니다. 파일을 다시 생성해 주세요.");
      }
      const latest=await readWeeklyWorkspace();
      const current=requireWeeklyRun(latest,body.runId,body.expectedRevision);
      assertWeeklyCurrentRules(current);
      if(weeklyOutputKey(current,body.kind as WeeklyOutputKind,now,advertising?.token)!==outputKey)throw new Error("검토 내용이 변경됐습니다. 파일을 다시 생성해 주세요.");
      if(includesCoupons)assertWeeklyCouponEligibility(latest,current);
      if(!["coupon","marketing"].includes(body.kind))assertWeeklyReviewEligibility(latest,current);
      if(includesReorders) {
        assertWeeklyReorderEligibility(latest,current);
      }
    }
    return new NextResponse(Buffer.from(output.base64,"base64"),{headers:{"Content-Type":"application/zip","Cache-Control":"private, no-store","Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(output.fileName)}`,"X-NOIDB-File-Name":encodeURIComponent(output.fileName),"X-NOIDB-Output-Key":outputKey}});
  } catch(error){return NextResponse.json({success:false,error:error instanceof Error?error.message:"파일 생성에 실패했습니다."},{status:409});}
}
