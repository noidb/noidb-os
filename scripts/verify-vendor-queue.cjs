const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText, filename);
const {consolidateVendorOrders} = require("../lib/wms/vendor-order/consolidate.ts");
const {emptyPickingWaveStoreSnapshot} = require("../lib/wms/picking-wave/shared-store-types.ts");
const {applyPickingWaveStoreMutation} = require("../lib/wms/picking-wave/server-store.ts");
const rules = require("../lib/wms/weekly-work-state.ts");
const now="2026-09-08T06:00:00.000Z";
function line(skuId, vendorName="원래거래처", waveId="old", quantity=12) {
 const draftId=waveId+"::"+vendorName;
 return {id:draftId+"::"+skuId,draftId,waveId,vendorName,skuId,modelName:"M",category:"팔찌",optionLabel:"실버",productName:"테스트 "+skuId,imageUrl:"",barcode:"",actualShortageQuantity:2,shortageQuantity:quantity,currentStock:"",relatedPurchaseOrderNumbers:["100"],memo:"사용자 메모",isManuallyAdded:false,createdAt:now,updatedAt:now};
}
function add(store,l,status="draft"){store.vendorOrderLines.push(l);if(!store.vendorOrderDrafts.some(d=>d.id===l.draftId))store.vendorOrderDrafts.push({id:l.draftId,waveId:l.waveId,vendorName:l.vendorName,status,createdAt:now,updatedAt:now});}
const s=emptyPickingWaveStoreSnapshot();
add(s,line("1001"));
add(s,line("1002","거래처B","old2",24));
const sent=line("8001","발송처","sent");sent.receivedQuantity=4;add(s,sent,"sent");
add(s,line("8002","승인처","approved"),"approved");
add(s,line("8003","재전송","resend"),"resend_needed");
const locked=JSON.stringify(s.vendorOrderLines.filter(l=>l.skuId==="8001"));
const duplicate={...line("1001","잘못된거래처","weekly",36),actualShortageQuantity:5,imageUrl:"https://example.test/image.jpg",relatedPurchaseOrderNumbers:["200"]};
const receipt=consolidateVendorOrders(s,"op1",[duplicate,line("1003","","weekly")],now);
assert.equal(receipt.duplicates,1);assert.equal(receipt.added,5);
const kept=s.vendorOrderLines.find(l=>l.skuId==="1001");
assert.equal(kept.actualShortageQuantity,5);assert.equal(kept.shortageQuantity,12);assert.equal(kept.vendorName,"원래거래처");assert.equal(kept.memo,"사용자 메모");assert.equal(kept.imageUrl,duplicate.imageUrl);assert.deepEqual(kept.relatedPurchaseOrderNumbers,["100","200"]);
assert.equal(JSON.stringify(s.vendorOrderLines.filter(l=>l.skuId==="8001")),locked);
assert.equal(s.vendorOrderLines.find(l=>l.skuId==="1003").vendorName,"거래처 미등록");
assert.equal(s.vendorOrderLines.filter(l=>l.skuId==="1001").length,1);
const saved=JSON.stringify(s);consolidateVendorOrders(s,"op1",[duplicate],now);assert.equal(JSON.stringify(s),saved);
consolidateVendorOrders(s,"op2",[duplicate],now);assert.equal(s.vendorOrderLines.filter(l=>l.skuId==="1001").length,1);
assert.throws(()=>applyPickingWaveStoreMutation(s,{action:"saveVendorLine",line:duplicate}),/취합/);
const migrated=applyPickingWaveStoreMutation(s,{action:"migrate",snapshot:{vendorOrderLines:[duplicate]}});assert(!migrated.vendorOrderLines.some(l=>l.id===duplicate.id));
const sentQueueDraft=s.vendorOrderDrafts.find(d=>d.id===kept.draftId);sentQueueDraft.status="sent";
const beforeSent=JSON.stringify(s.vendorOrderLines.find(l=>l.id===kept.id));
consolidateVendorOrders(s,"op3",[line("2000","새거래처","weekly2")],now);
assert.equal(JSON.stringify(s.vendorOrderLines.find(l=>l.id===kept.id)),beforeSent);
assert.notEqual(s.activeVendorQueueId,kept.waveId);
const normalized=applyPickingWaveStoreMutation(s,{action:"migrate",snapshot:{}});assert.deepEqual(normalized.vendorQueueConsumedLineIds,s.vendorQueueConsumedLineIds);
const run={id:"R",snapshot:{rulesVersion:3,sourceToken:"S",couponItems:[],vendorItems:[]},reviews:{"1001":{skuId:"1001",decision:"order",quantity:12,vendorName:"",imageUrl:"",quantityConfirmed:false}},revision:0,sentVendors:{}};
const beforeToken=rules.weeklyReviewToken(run);run.vendorQueueTransfers=[{id:"t",at:now,lines:[line("1001")]}];
assert.equal(rules.weeklySelectedOrders(run).length,0);assert.notEqual(rules.weeklyReviewToken(run),beforeToken);rules.assertWeeklyOrdersReady(run);
console.log("PASS: existing quantity/vendor/memo preserved; exact-SKU dedupe; missing image fill; sent/receiving preserved; unsent approved and resend included; retry idempotency; migration and stale source writes blocked; receipt persistence; transferred output excluded.");


const internal=emptyPickingWaveStoreSnapshot();
const internalReceipt=consolidateVendorOrders(internal,"internal1",[line("7001")],now);
const canonical=internal.vendorOrderLines[0];
add(internal,{...canonical,id:canonical.draftId+"::manual-1",shortageQuantity:24,memo:"duplicate manual row",imageUrl:"https://example.test/manual.jpg",isManuallyAdded:true});
const internalNext=consolidateVendorOrders(internal,"internal2",[],now);
assert.equal(internal.vendorOrderLines.length,1);assert.equal(internal.vendorOrderLines[0].id,canonical.id);
assert.equal(internal.vendorOrderLines[0].shortageQuantity,12);assert.equal(internalNext.duplicates,1);
assert(internalNext.sourceLines.some(l=>l.memo==="duplicate manual row"));
assert.equal(internal.vendorQueueConsumedLineIds[canonical.draftId+"::manual-1"],internalReceipt.queueId);
assert.equal(internal.vendorQueueConsumedLineIds[canonical.id],undefined);
for (const deletion of ["deleteVendorDraft","deleteVendorLine"]) {
 let deleted=emptyPickingWaveStoreSnapshot();
 const original=line("7101");
 consolidateVendorOrders(deleted,"before-"+deletion,[original],now);
 const previous=deleted.vendorOrderLines[0],previousQueue=deleted.activeVendorQueueId;
 deleted=applyPickingWaveStoreMutation(deleted,deletion==="deleteVendorDraft"?{action:deletion,draftId:previous.draftId,deletedAt:now}:{action:deletion,lineId:previous.id,deletedAt:now});
 // Reopening an old source or old canonical tab cannot recreate what the user deleted.
 consolidateVendorOrders(deleted,"stale-"+deletion,[original,previous],now);
 assert.equal(deleted.vendorOrderLines.length,0);
 assert.equal(deleted.activeVendorQueueId,previousQueue);
 // A genuinely new demand keeps the shared queue URL and receives a fresh record identity.
 consolidateVendorOrders(deleted,"after-"+deletion,[line("7101","원래거래처","new-source")],now);
 const fresh=deleted.vendorOrderLines.find(l=>l.skuId==="7101");
 assert(fresh);assert.equal(deleted.activeVendorQueueId,previousQueue);assert.notEqual(fresh.id,previous.id);
 assert.equal(deleted.deletedVendorLineIds[previous.id],now);
 if(deletion==="deleteVendorDraft") {assert.notEqual(fresh.draftId,previous.draftId);assert.equal(deleted.deletedVendorDraftIds[previous.draftId],now);}
 assert.doesNotThrow(()=>applyPickingWaveStoreMutation(deleted,{action:"saveVendorLine",line:{...fresh,imageUrl:"https://example.test/new.jpg"},expectedUpdatedAt:fresh.updatedAt}));
 const stableId=fresh.id,stableDraftId=fresh.draftId;
 consolidateVendorOrders(deleted,"repeat-"+deletion,[],now);
 assert.equal(deleted.vendorOrderLines[0].id,stableId);assert.equal(deleted.vendorOrderLines[0].draftId,stableDraftId);
 assert.equal(deleted.vendorQueueConsumedLineIds[stableId],undefined);
}

console.log("PASS: pre-existing queue duplicate preserves canonical row and source archive; deleted draft and line IDs never reused; new arrivals remain editable.");


const zeroStore=emptyPickingWaveStoreSnapshot();consolidateVendorOrders(zeroStore,"zero1",[line("7201")],now);
zeroStore.vendorOrderLines[0].shortageQuantity=0;
zeroStore.vendorOrderLines[0].memo="keep zero history";
const zeroRecord=JSON.stringify(zeroStore.vendorOrderLines[0]);
consolidateVendorOrders(zeroStore,"zero2",[line("7201","새거래처","new-zero-source")],now);
assert(zeroStore.vendorOrderLines.some(l=>JSON.stringify(l)===zeroRecord));
assert.equal(zeroStore.vendorOrderLines.filter(l=>l.shortageQuantity>0).length,1);
assert.notEqual(zeroStore.vendorOrderLines.find(l=>l.shortageQuantity>0).id,JSON.parse(zeroRecord).id);

// Exercise reservation/retry across the two actual state machines, without disk or network writes.
const vm=require("node:vm");
let fixtureStore=emptyPickingWaveStoreSnapshot(), workspace=rules.emptyWeeklyWorkspace(), failOnce=true;
const fixtureSnapshot={rulesVersion:3,id:"WEEKLY-retry",sourceToken:"source",createdAt:now,period:{startDate:"2026-09-01",endDate:"2026-09-07"},source:{files:[],mode:"upload"},couponItems:[],warnings:[],blockers:[],vendorItems:[{skuId:"901",productName:"retry",productLink:"",vendorName:"",imageUrl:"",modelName:"M",optionLabel:"SI",barcode:"",shortageQuantity:2,openOrderQuantity:0,suggestedQuantity:12,relatedPurchaseOrderNumbers:["123"],issues:[],discontinued:false}]};
const retryRun=rules.addWeeklyRun(workspace,fixtureSnapshot);
retryRun.reviews["901"].quantity=0;
retryRun.snapshot.vendorItems[0].shortageQuantity=13;
const mod={exports:{}};
const deps={"./vendor-order/aggregate":require("../lib/wms/vendor-order/aggregate.ts"),"node:crypto":require("node:crypto"),"./weekly-work-state":rules,"./weekly-work-store":{mutateWeeklyWorkspace:async fn=>{const answer=fn(workspace);workspace.revision++;return structuredClone(answer);}},"./picking-wave/server-store":{mutatePickingWaveStore:async mutation=>{if(failOnce){failOnce=false;throw Error("simulated interrupted transfer");}fixtureStore=applyPickingWaveStoreMutation(fixtureStore,mutation);return fixtureStore;}}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("lib/wms/weekly-vendor-queue.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mod,exports:mod.exports,require:n=>{assert(deps[n],n);return deps[n]},Date,Error,Set});
(async()=>{
 await assert.rejects(()=>mod.exports.transferWeeklyVendorQueue(retryRun.id,retryRun.revision),/interrupted/);
 assert.equal(retryRun.vendorQueueTransfers.length,1);assert.equal(rules.weeklySelectedOrders(retryRun).length,0);
 assert.throws(()=>rules.updateWeeklyReviews(workspace,retryRun,[{...retryRun.reviews["901"],quantity:99}],now),/발주대기/);
 const resumed=await mod.exports.transferWeeklyVendorQueue(retryRun.id,retryRun.revision);
 assert(resumed.run.vendorQueueTransfers[0].completed);assert.equal(fixtureStore.vendorOrderLines.length,1);
 await mod.exports.transferWeeklyVendorQueue(retryRun.id,retryRun.revision);
 assert.equal(fixtureStore.vendorOrderLines.length,1);assert.equal(retryRun.vendorQueueTransfers.length,1);
 assert.equal(fixtureStore.vendorOrderLines[0].shortageQuantity,24);assert.equal(fixtureStore.vendorOrderLines[0].actualShortageQuantity,13);
 assert.equal(fixtureStore.vendorOrderLines[0].imageUrl,"");assert.equal(fixtureStore.vendorOrderDrafts[0].status,"draft");
 console.log("PASS: interrupted weekly reservation resumes exactly once; moved reviews locked; missing image/vendor accepted for downstream editing; no sent status.");
})().catch(e=>{console.error(e);process.exitCode=1});
