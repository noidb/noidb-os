const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText, filename);
const {syncWeeklyDiscontinueQueue,weeklyDiscontinueQueueRequestIds}=require("../lib/wms/weekly-discontinue-queue.ts");
const now="2026-09-08T08:00:00.000Z";
function request(id,skuId,status="처리대기",type="단종") {
 return {id,skuId,requestType:type,supplyHubStatus:status,productName:"큐 상품 "+skuId,optionLabel:"실버",productLink:"https://example.test/"+skuId,modelSku:"M"+skuId,purchaseOrderNumber:"9001"};
}
function run(){return {id:"R",revision:0,updatedAt:now,snapshot:{rulesVersion:4,sourceToken:"S",couponItems:[],vendorItems:[{skuId:"1001",productName:"기존상품",vendorName:"수정거래처",imageUrl:"https://example.test/user.jpg",shortageQuantity:5,openOrderQuantity:12,suggestedQuantity:12,relatedPurchaseOrderNumbers:["9002"],issues:[]}]},reviews:{"1001":{skuId:"1001",vendorName:"수정거래처",imageUrl:"https://example.test/user.jpg",quantity:36,decision:"order",quantityConfirmed:true}},sentVendors:{},generated:{at:now,reviewToken:"old",couponCount:5,vendors:["수정거래처","다른거래처"],discontinueCount:2}};}
const source={requests:[request("A","1001"),request("B","1002"),request("C","1002"),request("OLD","1003","처리완료"),request("RELEASE","1004","처리대기","단종해제")],catalogItems:[]};
const current=run();
assert.equal(syncWeeklyDiscontinueQueue(current,source,now),1);
assert.deepEqual(current.snapshot.vendorItems.map(item=>item.skuId),["1001","1002"]);
assert.equal(current.snapshot.vendorItems[0].shortageQuantity,5);
assert.equal(current.snapshot.vendorItems[0].openOrderQuantity,12);
assert.equal(current.reviews["1001"].quantity,36);
assert.equal(current.reviews["1001"].imageUrl,"https://example.test/user.jpg");
assert.equal(current.reviews["1001"].vendorName,"수정거래처");
assert.equal(current.reviews["1001"].decision,"discontinue");
assert.equal(current.snapshot.vendorItems[1].shortageQuantity,0,"Queue-only product must not invent a shortage");
assert.deepEqual(current.discontinueQueueRequestIds,{"1001":["A"],"1002":["B","C"]});
assert.deepEqual(weeklyDiscontinueQueueRequestIds(current,["1002"]),["B","C"]);
assert.equal(current.generated.couponCount,5);
assert.deepEqual(current.generated.vendors,["다른거래처"]);
assert.equal(current.generated.discontinueCount,0);
const saved=JSON.stringify(current);
syncWeeklyDiscontinueQueue(current,source,now);
assert.equal(JSON.stringify(current),saved,"Repeated import must be idempotent");
current.reviews["1002"].decision="hold";
syncWeeklyDiscontinueQueue(current,source,now);
assert.equal(current.reviews["1002"].decision,"hold","Explicit hold survives reimport");
current.reviews["1002"].decision="discontinue";
const completed={...source,requests:source.requests.map(r=>["B","C"].includes(r.id)?{...r,supplyHubStatus:"처리완료"}:r)};
syncWeeklyDiscontinueQueue(current,completed,now);
assert(current.discontinueSubmittedSkuIds.includes("1002"),"External queue completion is reflected in weekly work");
assert(!weeklyDiscontinueQueueRequestIds(current).includes("B"));
const historicalIds=current.discontinueQueueRequestIds["1002"].slice();
syncWeeklyDiscontinueQueue(current,completed,now);
assert.deepEqual(current.discontinueQueueRequestIds["1002"],historicalIds,"History is retained");
current.discontinueSubmittedSkuIds.push("1001");
syncWeeklyDiscontinueQueue(current,source,now);
assert(current.discontinueSubmittedSkuIds.includes("1001"),"Acknowledgement retry must not revive already submitted work");
syncWeeklyDiscontinueQueue(current,{...completed,requests:[...completed.requests,request("NEW","1002")]},now);
assert(!current.discontinueSubmittedSkuIds.includes("1002"),"A new explicit request is separate work");
assert.deepEqual(current.discontinueQueueRequestIds["1002"],["B","C","NEW"]);
const legacy=run();legacy.reviews["1001"].decision="discontinue";legacy.discontinueSubmittedAt=now;
syncWeeklyDiscontinueQueue(legacy,{requests:[request("B","1002")],catalogItems:[]},now);
assert(legacy.discontinueSubmittedSkuIds.includes("1001"),"Legacy completion history survives new queue arrivals");
const reserved=run();reserved.pendingDiscontinueSubmission={at:now,skuIds:["1001"],requestIds:[],reviewToken:"R"};
assert.throws(()=>syncWeeklyDiscontinueQueue(reserved,source,now),/완료 연결/);
console.log("PASS: pending-only exact SKU merge, repeat idempotency, quantities preserved, completion history, explicit hold, new request, and reservation lock; operating writes=0.");

// Exercise the existing Sheet queue implementation against an in-memory Sheet.
const vm = require("node:vm");
const path = require("node:path");
const statusModule = {exports:{}};
let statusRows = [], appendCount = 0;
const sheets = {
 fetchExistingSheetRows: async () => statusRows,
 fetchSheetRows: async () => [["SKU ID","현재상태","상품명","모델SKU","색상"],["6001","","검증 상품","M6001","실버"]],
 ensureHiddenSheet: async () => undefined,
 appendSheetRow: async (_sheet,row) => {appendCount++;statusRows.push(row);},
 updateSheetCells: async () => {throw new Error("Unexpected real-data style write");},
};
const statusSource = ts.transpileModule(fs.readFileSync(path.resolve("lib/wms/vendor-order-actions.ts"),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
vm.runInNewContext(statusSource, {exports:statusModule.exports,module:statusModule,require(name){
 if(name==="./google-sheets") return sheets;
 return require(name.startsWith(".")?path.resolve("lib/wms",name+".ts"):name);
},Date,Set,Map,Promise,console}, {filename:"isolated-vendor-order-actions.js"});
(async()=>{
 statusRows = [[...statusModule.exports.STATUS_REQUEST_HEADERS]];
 const first=await statusModule.exports.queueDiscontinueCandidate({skuId:"6001",operator:"test"});
 const retry=await statusModule.exports.queueDiscontinueCandidate({skuId:"6001",operator:"test"});
 assert.equal(retry.id,first.id);
 assert.equal(appendCount,1,"Repeat selection must reuse the original pending request");
 await assert.rejects(()=>statusModule.exports.queueStatusCandidate({skuId:"6001",operator:"test",requestType:"단종해제"}),/다른 종류/);
 assert.equal(appendCount,1);
 console.log("PASS: Sheet-backed pending request retry reuses exact request ID; no new duplicate row; conflicting request refused.");
})().catch(error=>{console.error(error);process.exitCode=1;});
