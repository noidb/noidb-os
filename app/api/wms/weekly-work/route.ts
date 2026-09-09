import { readWeeklyDiscontinueQueue, syncWeeklyDiscontinueQueue } from "@/lib/wms/weekly-discontinue-queue";
import { recordWeeklyDiscontinueSubmitted } from "@/lib/wms/weekly-discontinue-submit";
import { transferWeeklyDiscontinue } from "@/lib/wms/weekly-discontinue-transfer";
import { weeklyReviewCompletion, weeklyReviewIsActive } from "@/lib/wms/weekly-work-progress";
import { NextRequest, NextResponse } from "next/server";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { loadWeeklySnapshot, readWeeklyOperationalToken } from "@/lib/wms/weekly-work-source";
import { readInboundWorkbook } from "@/lib/wms/inbound-import-context";
import { readWeeklyWorkspace, mutateWeeklyWorkspace } from "@/lib/wms/weekly-work-store";
import { addWeeklyRun, assertWeeklyCurrentRules, assertWeeklyReorderEligibility, requireWeeklyRun, updateWeeklyCouponSelection, updateWeeklyReviews, weeklyReorderRows, weeklyReviewToken, weeklySelectedCoupons, weeklySelectedOrders } from "@/lib/wms/weekly-work-state";
import { recordWeeklyVendorSent } from "@/lib/wms/weekly-work-sending";
import { assertWeeklyCouponEligibility, assertWeeklyReviewEligibility, recordWeeklyCouponChecks, recordWeeklyDiscontinueHistory, weeklyCouponBlocks, validWeeklyCouponDate, weeklyKoreaDay } from "@/lib/wms/weekly-work-state";
import type { WeeklyBrowserSource, WeeklyPeriod } from "@/lib/wms/weekly-work-types";
import type { InboundImportDataset } from "@/lib/wms/inbound-import-safety";
import { readWeeklyFile } from "@/lib/wms/weekly-work-files";
import { weeklyOutputKey, type WeeklyOutput, type WeeklyOutputKind } from "@/lib/wms/weekly-work-output";
import { nextWeeklyReorderFriday } from "@/lib/wms/weekly-reorder-files";
import { loadWeeklyAdvertisingSelection } from "@/lib/wms/weekly-advertising-source";
import { assertWeeklyAdvertisingSelection, type WeeklyAdvertisingSelection } from "@/lib/wms/weekly-advertising";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;
const headers={"Cache-Control":"private, no-store"};
export async function GET() {
  try { const workspace=await readWeeklyWorkspace(); return NextResponse.json({success:true,...workspace,couponBlocks:weeklyCouponBlocks(workspace)},{headers}); }
  catch(error){return failure(error);}
}
function failure(error:unknown) { return NextResponse.json({success:false,error:error instanceof Error?error.message:"주간 업무 처리 중 오류가 발생했습니다."},{status:409,headers}); }
export async function POST(request:NextRequest) {
  if(!isSameOriginActionRequest(request))return NextResponse.json({success:false,error:"주간 업무 화면에서 다시 진행해 주세요."},{status:403,headers});
  try {
    let body:Record<string,unknown>;
    let uploadedDatasets:InboundImportDataset[]|undefined;
    if(request.headers.get("content-type")?.includes("multipart/form-data")) {
      const form=await request.formData();
      body={action:form.get("action"),period:JSON.parse(String(form.get("period")||"null"))};
      const files=form.getAll("files").filter((value):value is File=>typeof value!=="string");
      if(!files.length||files.length>30||files.some(f=>f.size>10_000_000)||files.reduce((s,f)=>s+f.size,0)>30_000_000)throw new Error("입고상세내역 엑셀을 30MB 이하로 선택해 주세요.");
      uploadedDatasets=[];
      for(const file of files)uploadedDatasets.push(await readInboundWorkbook(Buffer.from(await file.arrayBuffer()),file.name));
    } else body=await request.json();
    if(body.action==="analyze") {
      const snapshot=await loadWeeklySnapshot(body.period as WeeklyPeriod,{browserSource:body.browserSource as WeeklyBrowserSource|undefined,uploadedDatasets});
      const run=await mutateWeeklyWorkspace(workspace=>addWeeklyRun(workspace,snapshot));
      return NextResponse.json({success:true,run},{headers});
    }
    if(!Number.isSafeInteger(body.expectedRevision)||Number(body.expectedRevision)<0)throw new Error("업무의 최신 검토 상태를 확인하지 못했습니다. 새로고침 후 다시 진행해 주세요.");
    if(body.action==="coupon-history") {
      const result=await mutateWeeklyWorkspace(workspace=>{
        if(workspace.revision!==body.expectedRevision)throw new Error("다른 화면에서 쿠폰 이력이 바뀌었습니다. 쿠폰 현황을 다시 불러와 주세요.");
        const count=recordWeeklyCouponChecks(workspace,body.rows,body.source);
        return {count,revision:workspace.revision+1,couponChecks:workspace.couponChecks,couponBlocks:weeklyCouponBlocks(workspace)};
      });
      return NextResponse.json({success:true,...result},{headers});
    }
    if(body.action==="discontinue-history") {
      const result=await mutateWeeklyWorkspace(workspace=>{
        if(workspace.revision!==body.expectedRevision)throw new Error("다른 화면에서 업무 이력이 바뀌었습니다. 다시 확인해 주세요.");
        const run=requireWeeklyRun(workspace,body.runId);
        const count=recordWeeklyDiscontinueHistory(workspace,run,body.rows,body.source);
        return {count,run};
      });
      return NextResponse.json({success:true,...result},{headers});
    }
    if(body.action==="transfer-discontinue") {
      const run=await transferWeeklyDiscontinue(String(body.runId||""),Number(body.expectedRevision));
      return NextResponse.json({success:true,run},{headers});
    }
    if(body.action==="sync-discontinue-queue") {
      const queue=await readWeeklyDiscontinueQueue();
      const run=await mutateWeeklyWorkspace(workspace=>{ const current=requireWeeklyRun(workspace,body.runId,body.expectedRevision); assertWeeklyCurrentRules(current); if(current.pendingDiscontinueSubmission)throw new Error("단종 완료 연결을 먼저 확인해 주세요."); syncWeeklyDiscontinueQueue(current,queue); return current; });
      return NextResponse.json({success:true,run},{headers});
    }
    if(body.action==="review") {
      const run=await mutateWeeklyWorkspace(workspace=>{
        const current=requireWeeklyRun(workspace,body.runId,body.expectedRevision);
        updateWeeklyReviews(workspace,current,body.reviews,new Date().toISOString());return current;
      });
      return NextResponse.json({success:true,run},{headers});
    }
    if(body.action==="coupon-selection") {
      const run=await mutateWeeklyWorkspace(workspace=>{
        const current=requireWeeklyRun(workspace,body.runId,body.expectedRevision);
        updateWeeklyCouponSelection(current,body.excludedSkuIds,new Date().toISOString());return current;
      });
      return NextResponse.json({success:true,run},{headers});
    }
    if(body.action==="generated") {
      const current=requireWeeklyRun(await readWeeklyWorkspace(),body.runId,body.expectedRevision);
      assertWeeklyCurrentRules(current);
      let advertising:WeeklyAdvertisingSelection|undefined;
      let kind=(["coupon","vendors","discontinue","reorder",...(!weeklySelectedCoupons(current).length?["all"]:[])] as WeeklyOutputKind[]).find(kind=>weeklyOutputKey(current,kind)===body.outputKey);
      if(!kind&&typeof body.outputKey==="string"&&/^[a-f0-9]{64}$/.test(body.outputKey)&&weeklySelectedCoupons(current).length) {
        advertising=await loadWeeklyAdvertisingSelection(current);
        assertWeeklyAdvertisingSelection(current,advertising);
        kind=(["marketing","all"] as WeeklyOutputKind[]).find(candidate=>weeklyOutputKey(current,candidate,new Date(),advertising?.token)===body.outputKey);
      }
      if(!kind)throw new Error("생성한 파일의 검토 내용과 오늘 날짜를 확인해 주세요. 파일을 다시 생성해 주세요.");
      const bytes=await readWeeklyFile(`output-${String(body.outputKey)}.json`);
      if(!bytes)throw new Error("생성한 파일을 찾지 못했습니다.");
      const output=JSON.parse(bytes.toString()) as WeeklyOutput;
      const run=await mutateWeeklyWorkspace(workspace=>{
        const item=requireWeeklyRun(workspace,body.runId,body.expectedRevision);
        assertWeeklyCurrentRules(item);
        const now=new Date();
        if(weeklyOutputKey(item,kind!,now,advertising?.token)!==body.outputKey)throw new Error("파일 생성 후 날짜나 검토 내용이 변경됐습니다. 다시 생성해 주세요.");
        if(weeklyReviewToken(item)!==output.generated.reviewToken)throw new Error("파일 생성 후 내용이 변경됐습니다. 다시 생성해 주세요.");
        if(output.generated.couponCount)assertWeeklyCouponEligibility(workspace,item);
        if(output.generated.vendors.length||output.generated.discontinueCount||output.generated.reorderCount)assertWeeklyReviewEligibility(workspace,item);
        if(advertising) {
          assertWeeklyAdvertisingSelection(item,advertising);
          if(output.generated.advertisingToken!==advertising.token||output.generated.advertisingCount!==advertising.optionIds.length)throw new Error("광고 옵션 ID 연결이 변경됐습니다. 파일을 다시 생성해 주세요.");
        }
        if(output.generated.reorderCount) {
          assertWeeklyReorderEligibility(workspace,item);
          if(output.generated.reorderRequestDate!==nextWeeklyReorderFriday(now)||output.generated.reorderCount!==weeklyReorderRows(item).length)throw new Error("재발주 요청 날짜·대상이 변경됐습니다. 파일을 다시 생성해 주세요.");
        }
        const prior=item.generated?.reviewToken===output.generated.reviewToken?item.generated:undefined;
        const priorReorder=prior?.reorderRequestDate===nextWeeklyReorderFriday(now)||item.reorderRequestedAt?prior:undefined;
        item.generated={...output.generated,couponCount:Math.max(prior?.couponCount||0,output.generated.couponCount),discontinueCount:Math.max(prior?.discontinueCount||0,output.generated.discontinueCount),discontinueSkuIds:output.generated.discontinueCount?output.generated.discontinueSkuIds:prior?.discontinueSkuIds,vendors:[...new Set([...(prior?.vendors||[]),...output.generated.vendors])],reorderCount:output.generated.reorderCount||priorReorder?.reorderCount||0,reorderRequestDate:output.generated.reorderCount?output.generated.reorderRequestDate:priorReorder?.reorderRequestDate,advertisingCount:output.generated.advertisingCount||prior?.advertisingCount||0,advertisingFiles:output.generated.advertisingCount?output.generated.advertisingFiles:prior?.advertisingFiles,advertisingToken:output.generated.advertisingCount?output.generated.advertisingToken:prior?.advertisingToken};
        item.revision++;item.updatedAt=new Date().toISOString();return item;
      });
      return NextResponse.json({success:true,run},{headers});
    }
    if(body.action==="status") {
      const before=requireWeeklyRun(await readWeeklyWorkspace(),body.runId,body.expectedRevision);
      assertWeeklyCurrentRules(before);
      const kind=String(body.kind||"");
      const vendorName=String(body.vendorName||"");
      const pending=kind==="vendor" && Boolean(before.pendingVendorSends?.[vendorName]) || kind==="discontinue" && Boolean(before.pendingDiscontinueSubmission);
      const emptyCompletion=kind==="complete" && !before.snapshot.blockers.length && (!weeklySelectedCoupons(before).length || !!before.couponUploadedAt) && Object.values(before.reviews).every(review=>review.decision==="hold" || !weeklyReviewIsActive(before,review));
      let queueComplete = true;
      if (kind === "complete" && before.vendorQueueTransfers?.length) {
        const { readPickingWaveStore } = await import("@/lib/wms/picking-wave/server-store");
        const snapshot = await readPickingWaveStore();
        queueComplete = before.vendorQueueTransfers.every(transfer => transfer.completed && transfer.lines.every(source => {
          if (before.reviews[source.skuId]?.decision !== "order") return true;
          let id = source.id;
          const seen = new Set<string>();
          while (snapshot.vendorQueueConsumedLineIds?.[id] && !seen.has(id)) {
            seen.add(id); id = snapshot.vendorQueueConsumedLineIds[id] + "::" + source.skuId;
          }
          const line = snapshot.vendorOrderLines.find(item => item.id === id);
          return !!line && snapshot.vendorOrderDrafts.some(draft => draft.id === line.draftId && draft.status === "sent");
        }));
      }
      if(!before.generated && !pending && !emptyCompletion)throw new Error("파일을 먼저 생성해 주세요.");
      if(kind!=="coupon" && !pending && !emptyCompletion && before.generated?.reviewToken!==weeklyReviewToken(before))throw new Error("검토 내용이 바뀌었습니다. 파일을 다시 생성해 주세요.");
      if(kind==="coupon"&&!before.generated?.couponCount)throw new Error("쿠폰 파일을 먼저 생성해 주세요.");
      if(kind==="discontinue"&&!pending&&!before.generated?.discontinueCount)throw new Error("단종 파일을 먼저 생성해 주세요.");
      if(kind==="reorder") {
        if(!before.generated?.reorderCount)throw new Error("재발주 요청 파일을 먼저 생성해 주세요.");
        if(!before.reorderRequestedAt&&before.generated.reorderRequestDate!==nextWeeklyReorderFriday())throw new Error("재발주 요청일이 지난 파일입니다. 오늘 기준으로 파일을 다시 생성해 주세요.");
        if(!before.reorderRequestedAt&&before.snapshot.operationalToken!==await readWeeklyOperationalToken())throw new Error("분석 이후 발주·입고 자료가 변경됐습니다. 최신 자료로 다시 준비해 주세요.");
      }
      if(kind==="discontinue") {
        const run=await recordWeeklyDiscontinueSubmitted(before.id,before.revision);
        return NextResponse.json({success:true,run},{headers});
      }
      const now=new Date().toISOString();
      if(kind==="vendor") {
        if(!pending && !before.generated?.vendors.includes(vendorName))throw new Error("발주 파일을 만든 거래처를 선택해 주세요.");
        const run=await recordWeeklyVendorSent(before.id,before.revision,vendorName);
        return NextResponse.json({success:true,run},{headers});
      }
      const run=await mutateWeeklyWorkspace(workspace=>{
        const current=requireWeeklyRun(workspace,body.runId,body.expectedRevision);
        assertWeeklyCurrentRules(current);
        if(kind==="coupon") {
          if(!weeklySelectedCoupons(current).length||!current.generated?.couponCount||current.generated.reviewToken!==weeklyReviewToken(current))throw new Error("현재 선택한 SKU로 쿠폰 파일을 먼저 생성해 주세요.");
          assertWeeklyCouponEligibility(workspace,current);
          if (!current.couponUploadedAt) {
            if(!validWeeklyCouponDate(body.couponExpiresOn)||body.couponExpiresOn<weeklyKoreaDay())throw new Error("쿠팡에 등록한 쿠폰의 종료일을 입력해 주세요. 종료일은 오늘 이후여야 합니다.");
            if(body.couponStartsOn !== undefined && (!validWeeklyCouponDate(body.couponStartsOn) || body.couponStartsOn > body.couponExpiresOn))throw new Error("쿠폰 시작일과 종료일을 확인해 주세요.");
            current.couponStartsOn=body.couponStartsOn;
            current.couponExpiresOn=body.couponExpiresOn;
          }
          current.couponUploadedAt ||= now;
        }
        else if(kind==="reorder") {
          assertWeeklyReorderEligibility(workspace,current);
          const rows=weeklyReorderRows(current);
          if(!current.reorderRequestedAt&&(!rows.length||current.generated?.reorderCount!==rows.length||current.generated.reorderRequestDate!==nextWeeklyReorderFriday(new Date(now))))throw new Error("현재 재발주 대상과 날짜로 파일을 다시 생성해 주세요.");
          if(!current.reorderRequestedAt) {
            current.reorderRequestedAt=now;
            current.reorderRequestedLines=rows.map(({purchaseOrderNumber,skuId,shortageQuantity})=>({purchaseOrderNumber,skuId,shortageQuantity}));
          }
        }
        else if(kind==="complete") {
          if(current.snapshot.blockers.length)throw new Error("입고 자료의 확인이 필요한 문제를 먼저 해결해 주세요.");
          if(Object.values(current.reviews).some(r=>r.decision==="order" && weeklyReviewIsActive(current,r)))throw new Error("거래처 발주대기로 이동하거나 발송을 완료해 주세요.");
          if(current.pendingDiscontinueSubmission)throw new Error("단종 완료 연결을 먼저 확인해 주세요.");
          if(current.vendorQueueTransfers?.some(t=>!t.completed))throw new Error("발주대기 연결을 먼저 완료해 주세요.");
          if(!queueComplete)throw new Error("이동한 상품의 발송완료를 거래처 발주대기에서 표시한 뒤 다시 완료해 주세요.");
          if(Object.keys(current.pendingVendorSends||{}).length)throw new Error("거래처 발송과 입고관리 연결 결과를 먼저 확인해 주세요.");
          if(weeklySelectedCoupons(current).length&&!current.couponUploadedAt)throw new Error("쿠팡 쿠폰 등록 여부를 확인해 주세요.");
          if(Object.values(current.reviews).some(r=>r.decision==="discontinue"&&weeklyReviewIsActive(current,r)))throw new Error("단종관리로 보낼 상품을 확인해 주세요.");
          if(Object.values(current.reviews).some(r=>r.decision==="reorder")&&!current.reorderRequestedAt)throw new Error("쿠팡 재발주 요청 여부를 확인해 주세요.");
          if(weeklySelectedOrders(current).some(r=>!current.sentVendors[r.vendorName]))throw new Error("거래처 발송 여부를 확인해 주세요.");
          current.completedAt=now;
        } else throw new Error("처리 상태를 확인해 주세요.");
        current.revision++;current.updatedAt=now;return current;
      });
      return NextResponse.json({success:true,run},{headers});
    }
    throw new Error("지원하지 않는 주간 업무 요청입니다.");
  } catch(error){return failure(error);}
}
