import assert from "node:assert/strict";
import JSZip from "jszip";
import { resolveWeeklyAdvertising, assertWeeklyAdvertisingSelection } from "../lib/wms/weekly-advertising";
import { buildWeeklyOutput, weeklyOutputKey } from "../lib/wms/weekly-work-output";
import { addWeeklyRun, emptyWeeklyWorkspace, updateWeeklyCouponSelection, weeklySelectedCoupons, weeklyReviewToken } from "../lib/wms/weekly-work-state";
import { WEEKLY_RULES_VERSION, type WeeklySnapshot } from "../lib/wms/weekly-work-types";

async function main() {
  const rows=[
    ["SKU ID","옵션ID","노출상품ID","제품링크"],
    ["1001","87000000001","wrong-display-id","https://www.coupang.com/vp/products/7427746467?itemId=1&vendorItemId=87000000001"],
    ["1002","","7427746467",'=HYPERLINK("https://www.coupang.com/vp/products/7427746467?itemId=2&vendorItemId=87000000002","상품")'],
    ["1003","87000000003","","https://coupang.com/vp/products/1?vendorItemId=87000000004"],
    ["1004","","7427746467",""],
    ["1005","87000000001","",""],
    ["1006","8.7E10","",""],
  ];
  const fallback=[{skuId:"1004",optionId:"87000000004",productUrl:"https://coupang.com/vp/products/1?vendorItemId=87000000004",verifiedAt:"2026-09-07T10:00:00Z"},
    {skuId:"1003",optionId:"87000000003",productUrl:"https://coupang.com/vp/products/1?vendorItemId=87000000003",verifiedAt:"2026-09-07T10:00:00Z"}];
  const mapping=resolveWeeklyAdvertising(["1002","1001","1003","1004","1005","1006","1007"],rows,fallback);
  assert.deepEqual(mapping.resolved,[{skuId:"1002",optionId:"87000000002"},{skuId:"1001",optionId:"87000000001"},{skuId:"1004",optionId:"87000000004"},{skuId:"1005",optionId:"87000000001"}]);
  assert.deepEqual(mapping.optionIds,["87000000002","87000000001","87000000004"],"duplicate options retain first appearance while every SKU remains mapped");
  assert.deepEqual(mapping.conflictingSkuIds,["1003","1006"],"fallback never overrides conflicting DB sources or malformed explicit IDs");
  assert.deepEqual(mapping.missingSkuIds,["1007"]);
  const duplicateRows=[...rows,["1001","87000000009","",""]];
  assert.deepEqual(resolveWeeklyAdvertising(["1001"],duplicateRows).conflictingSkuIds,["1001"],"duplicate DB SKU rows cannot silently select one identifier");
  assert.deepEqual(resolveWeeklyAdvertising(["1004"],rows).missingSkuIds,["1004"],"display product ID never becomes an advertising option ID");
  assert.equal(resolveWeeklyAdvertising(["1001"],rows).token,resolveWeeklyAdvertising(["1001"],[...rows,["9999","88888","",""]]).token,"unselected catalog changes do not invalidate selection mapping");
  assert.throws(()=>resolveWeeklyAdvertising(["1001"],[["상품명"],["1001"]]),/SKU ID 열/);

  const couponItems=Array.from({length:501},(_,i)=>({skuId:String(10000000+i),productName:`상품 ${i+1}`,productLink:""}));
  const rawRows=[["SKU ID","옵션ID"],...couponItems.map((item,i)=>[item.skuId,String(87000000000+i)])];
  const source:WeeklySnapshot={rulesVersion:WEEKLY_RULES_VERSION,id:"advertising-fixture",sourceToken:"fixture",createdAt:"2026-09-07T00:00:00Z",period:{startDate:"2026-09-01",endDate:"2026-09-07"},source:{files:[],latestActualDate:"2026-09-07",firstActualDate:"2026-09-01",eventCount:501,duplicateCount:0,selectedEventCount:501,mode:"upload"},couponItems,vendorItems:[],warnings:[],blockers:[]};
  const workspace=emptyWeeklyWorkspace(),run=addWeeklyRun(workspace,source),now=new Date("2026-09-07T01:00:00Z");
  const selection=resolveWeeklyAdvertising(couponItems.map(item=>item.skuId),rawRows);
  assertWeeklyAdvertisingSelection(run,selection);
  const marketing=await buildWeeklyOutput(run,"marketing",now,selection);
  assert.equal(marketing.generated.couponCount,501);assert.equal(marketing.generated.advertisingCount,501);
  assert.deepEqual(marketing.generated.advertisingFiles,["3-1_광고등록.xlsx","3-2_광고등록.xlsx"]);
  const zip=await JSZip.loadAsync(marketing.base64,{base64:true});
  assert.ok(zip.file("3-1_광고등록.xlsx"));assert.ok(zip.file("3-2_광고등록.xlsx"));assert.ok(Object.keys(zip.files).some(name=>name.startsWith("쿠폰발행_30퍼센트")));
  const all=await buildWeeklyOutput(run,"all",now,selection);assert.equal(all.generated.advertisingCount,501);
  assert.equal(run.couponUploadedAt,undefined);assert.equal(run.generated,undefined,"generation does not record coupon upload or any ad submission");
  await assert.rejects(buildWeeklyOutput(run,"marketing",now),/광고 옵션 ID/);
  const missing=resolveWeeklyAdvertising(couponItems.map(item=>item.skuId),rawRows.slice(0,-1));
  await assert.rejects(buildWeeklyOutput(run,"all",now,missing),/미연결 1개/);
  assert.equal((await buildWeeklyOutput(run,"coupon",now)).generated.couponCount,501,"coupon-only escape is independent from advertising mapping");
  const changed=resolveWeeklyAdvertising(couponItems.map(item=>item.skuId),rawRows.map((row,i)=>i===1?[row[0],"89999999999"]:row));
  assert.notEqual(weeklyOutputKey(run,"marketing",now,selection.token),weeklyOutputKey(run,"marketing",now,changed.token));
  assert.notEqual(weeklyOutputKey(run,"all",now,selection.token),weeklyOutputKey(run,"all",now,changed.token));
  assert.equal(weeklyOutputKey(run,"coupon",now,selection.token),weeklyOutputKey(run,"coupon",now,changed.token));
  run.generated={...marketing.generated,reviewToken:weeklyReviewToken(run)};
  updateWeeklyCouponSelection(run,[couponItems[500].skuId],"2026-09-07T02:00:00Z");
  assert.equal(run.generated.advertisingCount,0);assert.deepEqual(run.generated.advertisingFiles,[]);assert.equal(run.generated.advertisingToken,undefined);
  await assert.rejects(buildWeeklyOutput(run,"marketing",now,selection),/최종 쿠폰 SKU/);
  const selected=resolveWeeklyAdvertising(weeklySelectedCoupons(run).map(item=>item.skuId),rawRows);
  const selectedOutput=await buildWeeklyOutput(run,"marketing",now,selected);
  assert.equal(selectedOutput.generated.couponCount,500);assert.equal(selectedOutput.generated.advertisingCount,500);assert.deepEqual(selectedOutput.generated.advertisingFiles,["3-1_광고등록.xlsx"]);
  console.log("Weekly advertising PASS: exact SKU/option joins, FORMULA links, conflicts/fallback, no display-ID substitution, full-selection guard, stable dedupe, mapping-key invalidation, 501=>500+1 marketing ZIP, coupon-only escape and selection metadata reset; fixtures only");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
