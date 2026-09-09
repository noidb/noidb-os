import assert from "node:assert/strict";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { emptyWeeklyWorkspace, addWeeklyRun, requireWeeklyRun, updateWeeklyReviews, updateWeeklyCouponSelection, weeklyReviewToken, weeklySelectedCoupons, assertWeeklyCouponEligibility, assertWeeklyCurrentRules, weeklyReorderRows, assertWeeklyReorderEligibility } from "../lib/wms/weekly-work-state";
import { buildWeeklyOutput, weeklyOutputKey } from "../lib/wms/weekly-work-output";
import { weeklyCarryPurchaseOrders } from "../lib/wms/weekly-work-source";
import { resolveWeeklyAdvertising } from "../lib/wms/weekly-advertising";
import { recordWeeklyVendorSent } from "../lib/wms/weekly-work-sending";
import { emptyPickingWaveStoreSnapshot } from "../lib/wms/picking-wave/shared-store-types";
import { applyPickingWaveStoreMutation } from "../lib/wms/picking-wave/server-store";
import type { WeeklySnapshot, WeeklyWorkspace } from "../lib/wms/weekly-work-types";
import { WEEKLY_RULES_VERSION } from "../lib/wms/weekly-work-types";

const snapshot:WeeklySnapshot={rulesVersion:WEEKLY_RULES_VERSION,id:"WEEKLY-fixture",sourceToken:"a".repeat(64),operationalToken:"b".repeat(64),createdAt:"2026-09-07T03:00:00Z",period:{startDate:"2026-08-07",endDate:"2026-09-07"},source:{files:["fixture.xlsx"],latestActualDate:"2026-09-07",firstActualDate:"2026-08-08",eventCount:2,duplicateCount:1,selectedEventCount:2,mode:"upload"},couponItems:[{skuId:"70000001",productName:"목걸이, 실버, 42cm",productLink:""}],couponReceiptKeys:{"70000001":["receipt-A"]},vendorItems:[{skuId:"70000002",productName:"반지, 골드, 12호",productLink:"",vendorName:"거래처 A",imageUrl:"https://t1.coupangcdn.com/test.jpg",optionLabel:"골드, 12호",modelName:"R1",barcode:"",shortageQuantity:5,openOrderQuantity:0,suggestedQuantity:12,relatedPurchaseOrderNumbers:["PO1"],issues:["수량 확인"],discontinued:false},{skuId:"70000003",productName:"팔찌",productLink:"",vendorName:"",imageUrl:"",optionLabel:"",modelName:"",barcode:"",shortageQuantity:2,openOrderQuantity:0,suggestedQuantity:12,relatedPurchaseOrderNumbers:["PO2"],issues:["사진 확인"],discontinued:false}],warnings:[],blockers:[]};

function verifyCouponLedgerRace() {
  const workspace=emptyWeeklyWorkspace();
  const first=addWeeklyRun(workspace,structuredClone(snapshot));
  updateWeeklyReviews(workspace,first,[{...first.reviews["70000002"],quantity:24,quantityConfirmed:true}],"reviewed");
  first.generated={at:"generated",reviewToken:weeklyReviewToken(first),couponCount:1,vendors:["거래처 A"],discontinueCount:1};
  const partialSnapshot={...structuredClone(snapshot),id:"opened-with-new-receipt",couponReceiptKeys:{"70000001":["receipt-A","receipt-C"]}};
  const partial=addWeeklyRun(workspace,partialSnapshot);
  const partialToken=weeklyReviewToken(partial);
  const reordered=structuredClone(partial);reordered.snapshot.couponReceiptKeys={"70000001":["receipt-C","receipt-A","receipt-A"]};
  assert.equal(weeklyReviewToken(reordered),partialToken,"coupon receipt ordering/duplicates do not change cache identity");
  const other=addWeeklyRun(workspace,{...structuredClone(snapshot),id:"other-opened-run",period:{startDate:"2026-09-01",endDate:"2026-09-07"}});
  other.couponUploadedAt="2026-09-07T10:00:00Z";
  other.couponExpiresOn="2000-01-01"; // Expired coupon: receipt dedup still applies.
  assert.throws(()=>assertWeeklyCouponEligibility(workspace,first),/기간 자료.*다시 준비/);
  assert.throws(()=>assertWeeklyCouponEligibility(workspace,partial),/기간 자료.*다시 준비/,"same SKU with partly consumed receipt keys also requires refresh");
  const token=weeklyReviewToken(first), revision=first.revision, reviews=structuredClone(first.reviews);
  const refreshed=addWeeklyRun(workspace,structuredClone(snapshot));
  assert.equal(refreshed,first);assert.equal(first.snapshot.couponItems.length,0);assert.equal(first.revision,revision+1);
  assert.deepEqual(first.reviews,reviews,"coupon ledger refresh preserves reviewed vendor quantity/image/decision");
  assert.equal(first.generated?.couponCount,0);assert.deepEqual(first.generated?.vendors,["거래처 A"]);assert.equal(first.generated?.discontinueCount,1);
  assert.equal(first.generated?.reviewToken,weeklyReviewToken(first));assert.notEqual(weeklyReviewToken(first),token,"effective coupon selection invalidates old all/coupon cache keys");
  assertWeeklyCouponEligibility(workspace,first);
  assert.equal(addWeeklyRun(workspace,structuredClone(snapshot)).revision,first.revision,"identical ledger refresh remains idempotent");
  addWeeklyRun(workspace,partialSnapshot);
  assert.equal(partial.snapshot.couponItems.length,1);assert.deepEqual(partial.snapshot.couponReceiptKeys,{"70000001":["receipt-C"]});
  assert.notEqual(weeklyReviewToken(partial),partialToken,"receipt keys affect cache identity even when the eligible SKU stays the same");
  assertWeeklyCouponEligibility(workspace,partial);
  const historical=JSON.stringify(other);
  assert.equal(addWeeklyRun(workspace,{...structuredClone(snapshot),id:other.id}),other);
  assert.equal(JSON.stringify(other),historical,"already-uploaded run remains immutable historical evidence");
  assertWeeklyCouponEligibility(workspace,other);
}

async function verifyCouponSelection() {
  const workspace=emptyWeeklyWorkspace();
  const source={...structuredClone(snapshot),couponItems:[...snapshot.couponItems,{skuId:"70000004",productName:"추가 쿠폰상품",productLink:""}],couponReceiptKeys:{...snapshot.couponReceiptKeys,"70000004":["receipt-D"]}};
  const run=addWeeklyRun(workspace,source);
  assert.equal(weeklySelectedCoupons(run).length,2,"new and legacy selection defaults to all eligible SKUs");
  const beforeOverrides=structuredClone(workspace.productOverrides);
  run.generated={at:"generated",reviewToken:weeklyReviewToken(run),couponCount:2,vendors:["거래처 A"],discontinueCount:1};
  run.completedAt="completed";
  const oldToken=weeklyReviewToken(run);
  updateWeeklyCouponSelection(run,["70000001"],"selection");
  assert.deepEqual(weeklySelectedCoupons(run).map(item=>item.skuId),["70000004"]);
  assert.equal(run.generated.couponCount,0);assert.deepEqual(run.generated.vendors,["거래처 A"]);assert.equal(run.generated.discontinueCount,1);
  assert.notEqual(weeklyReviewToken(run),oldToken);assert.equal(run.generated.reviewToken,weeklyReviewToken(run));assert.equal(run.completedAt,undefined);
  assert.deepEqual(workspace.productOverrides,beforeOverrides,"coupon exclusion never permanently discontinues or edits the catalog");
  const stored=JSON.stringify(run), revision=run.revision;
  updateWeeklyCouponSelection(run,["70000001"],"duplicate");
  assert.equal(JSON.stringify(run),stored,"repeated identical selection is idempotent");
  for(const invalid of [null,["unknown"],["70000001","70000001"],[12]]) {
    assert.throws(()=>updateWeeklyCouponSelection(run,invalid,"invalid"),/SKU/);
    assert.equal(JSON.stringify(run),stored,"invalid selection cannot partially change state");
  }
  assert.equal(run.revision,revision);
  const output=await buildWeeklyOutput(run,"coupon");
  assert.equal(output.generated.couponCount,1);
  const zip=await JSZip.loadAsync(output.base64,{base64:true});
  const bytes=await Object.values(zip.files).find(file=>file.name.endsWith(".xlsx"))!.async("nodebuffer");
  const workbook=await JSZip.loadAsync(bytes);
  const xml=await workbook.file("xl/worksheets/sheet1.xml")!.async("string");
  assert.match(xml,/<x:v>70000004<\/x:v>/);assert.doesNotMatch(xml,/<x:v>70000001<\/x:v>/,"excluded SKU never enters the exported workbook");
  assert.deepEqual(weeklySelectedCoupons(JSON.parse(JSON.stringify(run))).map(item=>item.skuId),["70000004"],"selection survives saved-state reload");
  run.couponUploadedAt="uploaded";
  assert.throws(()=>updateWeeklyCouponSelection(run,[],"later"),/이미 쿠팡에 등록/);
  const next=addWeeklyRun(workspace,{...structuredClone(source),id:"after-selected-upload"});
  assert.deepEqual(next.snapshot.couponItems.map(item=>item.skuId),[],"completed review consumes excluded receipt events too; the same work must not reappear");
  updateWeeklyCouponSelection(next,[],"all-excluded");
  await assert.rejects(buildWeeklyOutput(next,"coupon"),/쿠폰을 적용할 SKU/);

  const stale=structuredClone(run);delete stale.snapshot.rulesVersion;
  assert.throws(()=>assertWeeklyCurrentRules(stale),/기간 자료를 다시 준비/);
  assert.throws(()=>updateWeeklyReviews(workspace,stale,[],"later"),/기간 자료를 다시 준비/);
  await assert.rejects(buildWeeklyOutput(stale,"coupon"),/기간 자료를 다시 준비/);
  const legacyWorkspace=emptyWeeklyWorkspace();
  const legacy=addWeeklyRun(legacyWorkspace,structuredClone(snapshot));delete legacy.snapshot.rulesVersion;legacy.couponUploadedAt="old-upload";
  assert.equal(addWeeklyRun(legacyWorkspace,{...structuredClone(snapshot),id:"after-legacy"}).snapshot.couponItems.length,0,"legacy uploaded runs without exclusions retain all receipt usage");
}

async function verifyReorders() {
  const source=structuredClone(snapshot);
  source.id="reorder-source";
  source.vendorItems=[{...source.vendorItems[0],vendorName:"",imageUrl:"",shortageQuantity:7,suggestedQuantity:24,relatedPurchaseOrderNumbers:["139000001","139000002"],shortageDetails:[
    {purchaseOrderNumber:"139000001",confirmedQuantity:12,receivedQuantity:7,shortageQuantity:5},
    {purchaseOrderNumber:"139000002",confirmedQuantity:2,receivedQuantity:0,shortageQuantity:2},
  ]}];
  const workspace=emptyWeeklyWorkspace(),run=addWeeklyRun(workspace,source);
  updateWeeklyReviews(workspace,run,[{...run.reviews["70000002"],decision:"reorder",quantityConfirmed:false,quantity:24}],"2026-09-07T05:00:00Z");
  assert.deepEqual(weeklyReorderRows(run).map(row=>[row.purchaseOrderNumber,row.skuId,row.shortageQuantity]),[["139000001","70000002",5],["139000002","70000002",2]],"reorder uses original PO quantities, independent of vendor image/name/quantity suggestion");
  assert.deepEqual(weeklyCarryPurchaseOrders(workspace),["139000001","139000002"],"unrequested reorders carry into the next analysis");
  const monday=new Date("2026-09-07T03:00:00Z"),friday=new Date("2026-09-10T15:00:00Z");
  assert.notEqual(weeklyOutputKey(run,"reorder",monday),weeklyOutputKey(run,"reorder",friday));
  assert.notEqual(weeklyOutputKey(run,"all",monday),weeklyOutputKey(run,"all",friday));
  assert.equal(weeklyOutputKey(run,"coupon",monday),weeklyOutputKey(run,"coupon",friday));
  const output=await buildWeeklyOutput(run,"reorder",monday);
  assert.equal(output.generated.reorderCount,2);assert.equal(output.generated.reorderRequestDate,"2026-09-11");
  assert.equal(run.reorderRequestedAt,undefined,"generating files never marks the request as submitted");
  const zip=await JSZip.loadAsync(output.base64,{base64:true});
  const file=Object.values(zip.files).find(item=>item.name.endsWith(".xlsx"))!;
  const book=new ExcelJS.Workbook();await book.xlsx.load(await file.async("nodebuffer") as unknown as ExcelJS.Buffer);
  const sheet=book.worksheets[0];
  assert.equal(sheet.getCell("B3").text,"139000001");assert.equal(sheet.getCell("C3").value,5);
  assert.equal(sheet.getCell("B4").text,"139000002");assert.equal(sheet.getCell("C4").value,2);
  const fridayOutput=await buildWeeklyOutput(run,"reorder",friday);assert.equal(fridayOutput.generated.reorderRequestDate,"2026-09-18");
  const advertising=resolveWeeklyAdvertising(weeklySelectedCoupons(run).map(item=>item.skuId),[["SKU ID","옵션ID"],["70000001","87000000001"]]);
  const all=await buildWeeklyOutput(run,"all",monday,advertising);assert.equal(all.generated.reorderCount,2);assert.equal(all.generated.couponCount,1);assert.equal(all.generated.advertisingCount,1);
  for (const mutate of [
    (r:typeof run)=>{delete r.snapshot.vendorItems[0].shortageDetails;},
    (r:typeof run)=>{r.snapshot.vendorItems[0].shortageDetails![0].shortageQuantity=12;},
    (r:typeof run)=>{r.snapshot.vendorItems[0].shortageDetails![1].purchaseOrderNumber="139000001";},
    (r:typeof run)=>{r.snapshot.vendorItems[0].shortageDetails![0].receivedQuantity=-1;},
    (r:typeof run)=>{r.snapshot.vendorItems[0].shortageQuantity=8;},
  ]) {const bad=structuredClone(run);mutate(bad);assert.throws(()=>weeklyReorderRows(bad),/기간 자료를 다시 준비/);await assert.rejects(buildWeeklyOutput(bad,"reorder",monday),/기간 자료를 다시 준비/);}
  const requested=addWeeklyRun(workspace,{...structuredClone(source),id:"other-request"});
  requested.reorderRequestedAt="2026-09-07T06:00:00Z";requested.reorderRequestedLines=[{purchaseOrderNumber:"139000001",skuId:"70000002",shortageQuantity:5}];
  assert.throws(()=>assertWeeklyReorderEligibility(workspace,run),/이미 재발주 요청/);
  addWeeklyRun(workspace,structuredClone(source));
  assert.equal(run.reviews["70000002"].decision,"reorder");assert.equal(run.snapshot.vendorItems[0].shortageQuantity,7);
  assert.deepEqual(weeklyReorderRows(run).map(row=>[row.purchaseOrderNumber,row.shortageQuantity]),[["139000002",2]],"partly requested SKU keeps original source totals but only exports new PO pair");
  assertWeeklyReorderEligibility(workspace,run);
  requested.reorderRequestedLines.push({purchaseOrderNumber:"139000002",skuId:"70000002",shortageQuantity:2});
  addWeeklyRun(workspace,structuredClone(source));
  assert.equal(run.reviews["70000002"].decision,"hold");assert.equal(weeklyReorderRows(run).length,0);assert.deepEqual(weeklyCarryPurchaseOrders(workspace),[]);
  const newRun=addWeeklyRun(workspace,{...structuredClone(source),id:"after-request"});assert.equal(newRun.reviews["70000002"].decision,"hold");
  const excludedWorkspace=emptyWeeklyWorkspace();
  const excluded=addWeeklyRun(excludedWorkspace,structuredClone(source));updateWeeklyCouponSelection(excluded,["70000001"],"2026-09-07T06:00:00Z");
  const reanalyzed=addWeeklyRun(excludedWorkspace,{...structuredClone(source),id:"new-source-version",sourceToken:"new-token"});
  assert.deepEqual(reanalyzed.couponExcludedSkuIds,["70000001"]);assert.equal(weeklySelectedCoupons(reanalyzed).length,0,"reprepare preserves same-period coupon exclusions");
  const finished=structuredClone(run);finished.reviews["70000002"].decision="reorder";finished.reorderRequestedAt="requested";finished.reorderRequestedLines=requested.reorderRequestedLines;
  assert.throws(()=>updateWeeklyReviews(workspace,finished,[{...finished.reviews["70000002"],decision:"hold"}],"later"),/이미 재발주 요청/);
}

function verifyUnresolvedReviewCarry() {
  const makeSource=(id:string,createdAt:string):WeeklySnapshot=>({...structuredClone(snapshot),id,sourceToken:id,createdAt});
  const setup=()=>{
    const workspace=emptyWeeklyWorkspace();
    const reviewed=addWeeklyRun(workspace,makeSource("before-read-failure","2026-09-07T03:00:00Z"));
    updateWeeklyReviews(workspace,reviewed,[
      {...reviewed.reviews["70000002"],decision:"hold",quantity:41,quantityConfirmed:true,vendorName:"보존 거래처",imageUrl:"https://example.com/retained-photo.jpg"},
      {...reviewed.reviews["70000003"],quantity:59,quantityConfirmed:true,vendorName:"다른 보존 거래처",imageUrl:"https://example.com/other-retained.jpg"},
    ],"2026-09-07T03:30:00Z");
    delete reviewed.reviewedSkuIds; // Existing live reviews can predate explicit tracking.
    updateWeeklyCouponSelection(reviewed,["70000001"],"2026-09-07T03:35:00Z");
    const unresolved=makeSource("read-failure","2026-09-07T04:00:00Z");
    unresolved.unresolvedItems=unresolved.vendorItems.map(item=>({skuId:item.skuId,productName:item.productName,relatedPurchaseOrderNumbers:item.relatedPurchaseOrderNumbers,issues:["입고요약 읽기 실패"]}));
    unresolved.vendorItems=[];
    const failed=addWeeklyRun(workspace,unresolved);
    updateWeeklyCouponSelection(failed,[],"2026-09-07T04:01:00Z");
    return {workspace,reviewed,failed};
  };
  const {workspace,reviewed,failed}=setup();
  const failedAgain=addWeeklyRun(workspace,{...structuredClone(failed.snapshot),id:"read-failure-again",sourceToken:"read-failure-again",createdAt:"2026-09-07T04:30:00Z"});
  const before=JSON.stringify(workspace);
  const recovered=addWeeklyRun(workspace,makeSource("read-recovered","2026-09-07T05:00:00Z"));
  for(const skuId of ["70000002","70000003"]) assert.deepEqual(recovered.reviews[skuId],{...reviewed.reviews[skuId],quantityConfirmed:false},"legacy custom quantity, hold/order decision, photo and vendor survive consecutive unresolved-only runs");
  assert.deepEqual(recovered.reviewedSkuIds,["70000002","70000003"]);
  assert.deepEqual(recovered.couponExcludedSkuIds,[],"coupon selection still follows the immediately prior run");
  assert.deepEqual(recovered.sentVendors,{});assert.equal(recovered.generated,undefined);
  assert.equal(JSON.stringify({...workspace,runs:workspace.runs.filter(run=>run.id!==recovered.id)}),before,"recovery never edits historical runs or overrides");
  assert.deepEqual(failedAgain.reviews,{},"failed snapshot remains an empty unresolved review");

  for(const boundary of ["normal-absence","unreviewed","completed-unresolved","latest-review"] as const) {
    const base=setup();
    const boundarySource=makeSource(`boundary-${boundary}`,"2026-09-07T04:30:00Z");
    if(boundary==="normal-absence"||boundary==="completed-unresolved") boundarySource.vendorItems=[];
    if(boundary==="completed-unresolved") boundarySource.unresolvedItems=structuredClone(base.failed.snapshot.unresolvedItems);
    const isolated=emptyWeeklyWorkspace(),stop=addWeeklyRun(isolated,boundarySource);
    if(boundary==="completed-unresolved") stop.completedAt="2026-09-07T04:40:00Z";
    if(boundary==="latest-review") updateWeeklyReviews(isolated,stop,[{...stop.reviews["70000002"],quantity:63,decision:"order"}],"2026-09-07T04:40:00Z");
    base.workspace.runs.unshift(stop);
    const current=addWeeklyRun(base.workspace,makeSource(`after-${boundary}`,"2026-09-07T05:00:00Z"));
    assert.equal(current.reviews["70000002"].quantity,boundary==="latest-review"?63:12,`${boundary} prevents reviving older custom quantities`);
    assert.equal(current.reviews["70000002"].decision,"order",`${boundary} prevents reviving an older hold decision`);
  }
}

function verifyReanalysisReviewCarry() {
  const makeSource=(id:string,createdAt:string):WeeklySnapshot=>({...structuredClone(snapshot),id,sourceToken:id,createdAt,
    vendorItems:Array.from({length:7},(_,index)=>({...structuredClone(snapshot.vendorItems[0]),skuId:String(71000001+index),issues:[],relatedPurchaseOrderNumbers:[String(139100001+index)],
      shortageDetails:[{purchaseOrderNumber:String(139100001+index),confirmedQuantity:8,receivedQuantity:3,shortageQuantity:5}]}))});
  const workspace=emptyWeeklyWorkspace();
  const original=addWeeklyRun(workspace,makeSource("review-original","2026-09-07T03:00:00Z"));
  assert.deepEqual(original.reviewedSkuIds,[],"automatic defaults are not user review");
  updateWeeklyReviews(workspace,original,[{...original.reviews["71000005"]}],"2026-09-07T04:00:00Z");
  assert.deepEqual(original.reviewedSkuIds,[],"unchanged row submission does not freeze a suggested quantity");
  const decisions=["order","hold","reorder","discontinue"] as const;
  updateWeeklyReviews(workspace,original,decisions.map((decision,index)=>({...original.reviews[String(71000001+index)],decision,quantity:25+index,vendorName:`검토 거래처 ${index}`,imageUrl:`https://example.com/review-${index}.jpg`,quantityConfirmed:true})),"2026-09-07T04:00:00Z");
  updateWeeklyReviews(workspace,original,[{...original.reviews["71000006"],decision:"hold",quantity:41},{...original.reviews["71000007"],quantity:42}],"2026-09-07T04:30:00Z");
  updateWeeklyCouponSelection(original,["70000001"],"2026-09-07T05:00:00Z");
  const beforeOriginal=JSON.stringify(original),beforeOverrides=JSON.stringify(workspace.productOverrides);
  const refreshedSource=makeSource("review-new-source","2026-09-07T06:00:00Z");
  refreshedSource.vendorItems=refreshedSource.vendorItems.filter(item=>item.skuId!=="71000006").map(item=>({...item,suggestedQuantity:36,shortageQuantity:18,
    discontinued:item.skuId==="71000007",shortageDetails:[{purchaseOrderNumber:item.relatedPurchaseOrderNumbers[0],confirmedQuantity:21,receivedQuantity:3,shortageQuantity:18}]}));
  const refreshed=addWeeklyRun(workspace,refreshedSource);
  for(let index=0;index<decisions.length;index++) {
    const skuId=String(71000001+index);
    assert.deepEqual(refreshed.reviews[skuId],{...original.reviews[skuId],quantityConfirmed:false},"reviewed decision, custom quantity, image and vendor survive changed source totals");
    assert.equal(refreshed.snapshot.vendorItems.find(item=>item.skuId===skuId)!.shortageQuantity,18,"new source shortage stays authoritative");
  }
  assert.equal(refreshed.reviews["71000005"].quantity,36,"unreviewed defaults follow the new source suggestion");
  assert.equal(refreshed.reviews["71000005"].quantityConfirmed,true);
  assert.equal(refreshed.reviews["71000006"],undefined,"removed shortage SKU is never copied");
  assert.equal(refreshed.reviews["71000007"].decision,"hold","newly discontinued source cannot inherit an order decision");
  assert.deepEqual(refreshed.reviewedSkuIds,decisions.map((_,index)=>String(71000001+index)));
  assert.deepEqual(refreshed.couponExcludedSkuIds,["70000001"]);
  assert.equal(JSON.stringify(original),beforeOriginal,"reanalyzing leaves the prior run unchanged");
  assert.equal(JSON.stringify(workspace.productOverrides),beforeOverrides,"carrying review does not rewrite catalog overrides");
  updateWeeklyReviews(workspace,refreshed,[{...refreshed.reviews["71000001"],quantity:39}],"2026-09-07T07:00:00Z");
  const latest=addWeeklyRun(workspace,makeSource("review-latest","2026-09-07T08:00:00Z"));
  assert.equal(latest.reviews["71000001"].quantity,39,"only the immediately prior same-period review is inherited");
  const unrelatedSource=makeSource("other-period","2026-09-07T09:00:00Z");unrelatedSource.period={startDate:"2026-09-01",endDate:"2026-09-07"};
  const unrelated=addWeeklyRun(workspace,unrelatedSource);
  assert.equal(unrelated.reviews["71000001"].quantity,12,"different periods do not inherit reviewed quantities");

  const completedWorkspace=emptyWeeklyWorkspace(),completed=addWeeklyRun(completedWorkspace,makeSource("completed-original","2026-09-07T03:00:00Z"));
  updateWeeklyReviews(completedWorkspace,completed,completed.snapshot.vendorItems.slice(0,5).map((item,index)=>({...completed.reviews[item.skuId],quantity:41+index,vendorName:`완료 거래처 ${index}`,decision:index===2?"reorder":index===3?"discontinue":"order"})),"2026-09-07T04:00:00Z");
  completed.sentVendors["완료 거래처 0"]="sent";
  completed.pendingVendorSends={"완료 거래처 1":{at:"pending",reviewToken:weeklyReviewToken(completed),lines:[]}};
  completed.reorderRequestedAt="requested";
  completed.reorderRequestedLines=[{purchaseOrderNumber:"139100003",skuId:"71000003",shortageQuantity:5}];
  completed.discontinueSubmittedAt="submitted";completed.discontinueSubmittedSkuIds=["71000004"];
  completed.generated={at:"generated",reviewToken:weeklyReviewToken(completed),couponCount:0,vendors:["완료 거래처 0"],discontinueCount:1,reorderCount:1};
  const renewed=addWeeklyRun(completedWorkspace,makeSource("completed-renewed","2026-09-07T05:00:00Z"));
  for(const skuId of ["71000001","71000002","71000003","71000004"]) assert.equal(renewed.reviews[skuId].quantity,12,"completed or pending send rows are not carried as unfinished custom orders");
  assert.equal(renewed.reviews["71000003"].decision,"hold","requested PO+SKU ledger still prevents a duplicate request");
  assert.equal(renewed.reviews["71000004"].decision,"hold","submitted discontinuation remains excluded");
  assert.equal(renewed.reviews["71000005"].quantity,45,"unfinished reviews in the same partially completed run still carry");
  assert.deepEqual(renewed.sentVendors,{});
  for(const field of ["pendingVendorSends","reorderRequestedAt","reorderRequestedLines","discontinueSubmittedAt","discontinueSubmittedSkuIds","generated","completedAt"] as const) assert.equal(renewed[field],undefined,`${field} is never copied to new operational work`);
  assert.deepEqual(renewed.reorderPreviouslyRequestedLines,completed.reorderRequestedLines);
  renewed.completedAt="completed";
  const afterCompleted=addWeeklyRun(completedWorkspace,makeSource("after-fully-completed","2026-09-07T06:00:00Z"));
  assert.equal(afterCompleted.reviews["71000005"].quantity,12,"a completed run does not carry old review as new work");

  const legacyWorkspace=emptyWeeklyWorkspace(),legacy=addWeeklyRun(legacyWorkspace,makeSource("legacy-review","2026-09-07T03:00:00Z"));
  delete legacy.reviewedSkuIds;
  legacy.reviews["71000001"]={...legacy.reviews["71000001"],decision:"reorder",quantity:51};
  const legacyNewSource=makeSource("legacy-review-new","2026-09-07T04:00:00Z");legacyNewSource.vendorItems=legacyNewSource.vendorItems.map(item=>({...item,suggestedQuantity:24}));
  const legacyRenewed=addWeeklyRun(legacyWorkspace,legacyNewSource);
  assert.equal(legacyRenewed.reviews["71000001"].decision,"reorder");assert.equal(legacyRenewed.reviews["71000001"].quantity,51);assert.equal(legacyRenewed.reviews["71000001"].quantityConfirmed,false);
  assert.equal(legacyRenewed.reviews["71000002"].quantity,24,"legacy automatic defaults remain responsive to source changes");
  assert.deepEqual(legacyRenewed.reviewedSkuIds,["71000001"]);
}

async function main(){
  verifyCouponLedgerRace();
  verifyUnresolvedReviewCarry();
  verifyReanalysisReviewCarry();
  await verifyCouponSelection();
  await verifyReorders();
  let workspace=emptyWeeklyWorkspace();
  const run=addWeeklyRun(workspace,structuredClone(snapshot));
  assert.equal(addWeeklyRun(workspace,structuredClone(snapshot)),run,"same source resumes same work");
  assert.throws(()=>requireWeeklyRun(workspace,run.id,99),/변경/);
  const before=JSON.stringify(workspace);
  assert.throws(()=>updateWeeklyReviews(workspace,run,[{...run.reviews["70000002"],quantity:-1}],"now"),/확인/);
  assert.equal(JSON.stringify(workspace),before,"bad review atomic rejection");
  await assert.rejects(buildWeeklyOutput(run,"vendors"),/확인/);
  const coupon=await buildWeeklyOutput(run,"coupon");
  assert.equal(run.generated,undefined,"file creation is not final user-side completion");
  const zip=await JSZip.loadAsync(coupon.base64,{base64:true});
  const bytes=await Object.values(zip.files).find(f=>f.name.endsWith(".xlsx"))!.async("nodebuffer");
  const couponWorkbook=await JSZip.loadAsync(bytes);
  const couponXml=await couponWorkbook.file("xl/worksheets/sheet1.xml")!.async("string");
  assert.match(couponXml,/<x:c r="A4"[^>]*><x:v>70000001<\/x:v>/);
  assert.match(couponXml,/<x:c r="C4"[^>]*><x:v>30<\/x:v>/);
  assert.equal((couponXml.match(/<x:row /g)||[]).length,4);
  updateWeeklyReviews(workspace,run,[{...run.reviews["70000002"],quantityConfirmed:true},{...run.reviews["70000003"],decision:"hold"}],"2026-09-07T04:00:00Z");
  const vendorOutput=await buildWeeklyOutput(run,"vendors");
  const vendorZip=await JSZip.loadAsync(vendorOutput.base64,{base64:true});
  const manifest=JSON.parse(await vendorZip.file("내부자료/거래처이미지.json")!.async("string"));
  assert.equal(manifest.vendors.length,1);assert.equal(manifest.vendors[0].lines[0].shortageQuantity,12);
  assert.equal(manifest.vendors[0].lines[0].actualShortageQuantity,5);
  const vendorBook=new ExcelJS.Workbook();await vendorBook.xlsx.load(await Object.values(vendorZip.files).find(f=>f.name.endsWith(".xlsx"))!.async("nodebuffer") as unknown as ExcelJS.Buffer);
  assert.equal(vendorBook.worksheets[0].getCell("D3").value,12);
  assert.equal(vendorBook.worksheets[0].getCell("B3").text,"반지, 골드, 12호");
  run.generated=vendorOutput.generated;
  let picking=emptyPickingWaveStoreSnapshot();let simulateLostResponse=true;let mutations=0;
  const deps={readWeeklyWorkspace:async()=>structuredClone(workspace),mutateWeeklyWorkspace:async<T,>(fn:(w:WeeklyWorkspace)=>T)=>{const copy=structuredClone(workspace);const result=fn(copy);workspace=copy;return structuredClone(result);},readPickingWaveStore:async()=>structuredClone(picking),mutatePickingWaveStore:async(mutation:Parameters<typeof applyPickingWaveStoreMutation>[1])=>{
    mutations++;picking=applyPickingWaveStoreMutation(picking,mutation);
    if(simulateLostResponse){simulateLostResponse=false;throw new Error("lost response");}return structuredClone(picking);
  }};
  await assert.rejects(recordWeeklyVendorSent(run.id,run.revision,"거래처 A",deps),/lost response/);
  let pending=requireWeeklyRun(workspace,run.id);
  assert.ok(pending.pendingVendorSends?.["거래처 A"]);assert.equal(pending.sentVendors["거래처 A"],undefined);
  assert.throws(()=>updateWeeklyReviews(workspace,pending,[{...pending.reviews["70000002"],quantity:24}],"now"),/연결/);
  picking.vendorOrderLines[0].receivedQuantity=3;
  const sent=await recordWeeklyVendorSent(run.id,pending.revision,"거래처 A",deps);
  assert.ok(sent.sentVendors["거래처 A"]);assert.equal(mutations,1,"retry does not duplicate or replace sent order");
  assert.equal(picking.vendorOrderLines[0].receivedQuantity,3,"receiving edits survive retry");
  const current=requireWeeklyRun(workspace,run.id);
  current.couponUploadedAt="2026-09-07";
  const repeated=addWeeklyRun(workspace,{...structuredClone(snapshot),id:"different-period",period:{startDate:"2026-09-01",endDate:"2026-09-07"}});
  assert.equal(repeated.snapshot.couponItems.length,0,"overlapping period does not reissue same receipt");
  const newReceipt=addWeeklyRun(workspace,{...structuredClone(snapshot),id:"new-receipt",period:{startDate:"2026-09-08",endDate:"2026-09-14"},couponReceiptKeys:{"70000001":["receipt-B"]}});
  assert.equal(newReceipt.snapshot.couponItems.length,0,"unknown prior coupon expiry blocks the same SKU even on a new receipt");
  current.couponExpiresOn="2000-01-01";
  assert.equal(addWeeklyRun(workspace,{...structuredClone(snapshot),id:"after-expiry",couponReceiptKeys:{"70000001":["receipt-B"]}}).snapshot.couponItems.length,1,"new receipt becomes eligible only after confirmed expiry");
  const d=addWeeklyRun(workspace,{...structuredClone(snapshot),id:"discontinue"});
  updateWeeklyReviews(workspace,d,[{...d.reviews["70000002"],decision:"discontinue"}],"now");
  d.discontinueSubmittedAt="yesterday";d.discontinueSubmittedSkuIds=["70000002"];
  d.generated={at:"yesterday",reviewToken:weeklyReviewToken(d),couponCount:1,vendors:[],discontinueCount:1};
  updateWeeklyReviews(workspace,d,[{...d.reviews["70000003"],decision:"discontinue"}],"later");
  assert.equal(d.discontinueSubmittedAt,undefined);assert.deepEqual(d.discontinueSubmittedSkuIds,["70000002"]);
  assert.equal(d.generated?.discontinueCount,0);assert.equal(d.generated?.couponCount,1);
  console.log("Weekly state/output PASS: selected-only 30% XLSX, exclusions persist and preserve vendor files, selected-receipt ledger, stale-rule guards, same-period unfinished review carry with quantity reconfirmation, unresolved-only source failures skipped with normal/completed/unreviewed boundaries, untouched defaults/removed/completed rows excluded, legacy review carry, quantities/options, overlap receipts, submitted SKU ledger and lost-response receiving preservation");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
