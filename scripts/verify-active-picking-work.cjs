const assert=require("node:assert/strict"),fs=require("node:fs"),ts=require("typescript");
require.extensions[".ts"]=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
const {emptyPickingWaveStoreSnapshot}=require("../lib/wms/picking-wave/shared-store-types.ts");
const {projectActivePickingWork,mergeActivePickingWorkMutation}=require("../lib/wms/active-picking-work.ts");
const {applyPickingWaveStoreMutation}=require("../lib/wms/picking-wave/server-store.ts");
const {packingGenerationKey}=require("../lib/wms/packing-progress.ts");
const t="2026-09-08T05:00:00Z";
const src=(po,basket,q)=>({purchaseOrderNumber:po,basketNumber:basket,requestedQuantity:q,shippingGroupKey:"2026-09-11\u0000대구3"});
const allocation=(source,fulfilled)=>({...source,shippingGroupKey:undefined,fulfilledQuantity:fulfilled,shortageQuantity:source.requestedQuantity-fulfilled});
const item=(id,waveId,sku,sources,overrides={})=>({id,waveId,productCode:sku,productName:"상품"+sku,barcode:"R"+sku,totalQuantity:sources.reduce((n,s)=>n+s.requestedQuantity,0),pickedQuantity:0,shortageQuantity:0,status:"pending",sources,allocations:[],createdAt:t,updatedAt:t,locationStatus:"unlocated",modelSortKey:"",locationSortKey:"",...overrides});
function fixture(){
 const snapshot=emptyPickingWaveStoreSnapshot();snapshot.revision=10;
 const p1=src("P1","1",5),p2=src("P2","2",7);
 const wave=(id,pos)=>({id,status:"in_progress",sourcePurchaseOrderNumbers:pos,createdAt:t,updatedAt:t,completedGroupIds:[],productDbConfigured:true,shippingGroups:[{key:"2026-09-11\u0000대구3",expectedDate:"2026-09-11",fulfillmentCenter:"대구3",purchaseOrderNumbers:pos}]});
 snapshot.waves=[wave("TARGET",["P1","P2"]),wave("DONE",["P1"])];
 snapshot.waves[0].outputGenerations=[{generationId:"MIX",waveId:"TARGET",purchaseOrderNumbers:["P1","P2"],shipmentFileName:"physical.xlsx",status:"shipment_generated"}];
 snapshot.items=[item("MIXED","TARGET","1001",[p1,p2],{status:"partial",pickedQuantity:6,shortageQuantity:6,allocations:[allocation(p1,2),allocation(p2,4)]}),item("EXCLUDED","TARGET","1002",[src("P1","1",1)]),item("D1","DONE","1001",[src("P1","9",5)]),item("D2","DONE","1002",[src("P1","9",1)])];
 snapshot.baskets=[{waveId:"TARGET",purchaseOrderNumber:"P1",basketNumber:"1"},{waveId:"TARGET",purchaseOrderNumber:"P2",basketNumber:"2"}];
 snapshot.outboundWorkStates={DONE:{status:"completed",source:"manual",updatedAt:"2026-09-08T06:00:00Z",history:[]}};
 return snapshot;
}
const snapshot=fixture(),raw=JSON.stringify(snapshot);
const active=projectActivePickingWork(snapshot,"TARGET");
assert.deepEqual(active.excludedPurchaseOrderNumbers,["P1"]);
assert.deepEqual(active.wave.sourcePurchaseOrderNumbers,["P2"]);
assert.deepEqual(active.wave.shippingGroups[0].purchaseOrderNumbers,["P2"]);
assert.deepEqual(active.items.map(row=>row.id),["MIXED"]);
assert.equal(active.items[0].totalQuantity,7);
assert.equal(active.items[0].pickedQuantity,4);
assert.equal(active.items[0].shortageQuantity,3);
assert.equal(active.items[0].status,"partial");
assert.deepEqual(active.items[0].allocations,[snapshot.items[0].allocations[1]]);
assert.equal(active.baskets.length,1);
assert.equal(packingGenerationKey(active.wave),packingGenerationKey(snapshot.waves[0]),"Physical output generation identity is not filtered");
assert.equal(active.wave.outputGenerations,snapshot.waves[0].outputGenerations);
assert.deepEqual(active.wave.workScope,{excludedPurchaseOrderNumbers:["P1"],sourceRevision:10});
assert.equal(JSON.stringify(snapshot),raw,"Projection is read-only");
const changed={...active.items[0],status:"full",pickedQuantity:7,shortageQuantity:0,allocations:[allocation(active.items[0].sources[0],7)],updatedAt:"2026-09-08T07:00:00Z"};
const merged=mergeActivePickingWorkMutation(snapshot,{action:"saveProgress",wave:{...active.wave,status:"completed"},items:[changed]});
assert.deepEqual(merged.wave.sourcePurchaseOrderNumbers,["P1","P2"]);
assert.deepEqual(merged.wave.shippingGroups,snapshot.waves[0].shippingGroups);
assert.equal(merged.wave.workScope,undefined);
assert.equal(merged.items[0].workScope,undefined);
assert.deepEqual(merged.items[0].sources,snapshot.items[0].sources);
assert.deepEqual(merged.items[0].allocations[0],snapshot.items[0].allocations[0],"Excluded PO allocation remains exactly as saved");
assert.equal(merged.items[0].totalQuantity,12);
assert.equal(merged.items[0].pickedQuantity,9);
assert.equal(merged.items[0].shortageQuantity,3);
assert.equal(merged.items[0].status,"partial");
assert.equal(JSON.stringify(snapshot),raw,"Merge creates a sanitized mutation without mutating the raw snapshot");

const updated=structuredClone(snapshot);updated.revision++;
updated.waves[0]=merged.wave;updated.items[0]=merged.items[0];
const resumed=projectActivePickingWork(updated,"TARGET");
assert.equal(resumed.items[0].status,"full");assert.equal(resumed.items[0].pickedQuantity,7);
updated.outboundWorkStates.DONE={status:"active",source:"manual",updatedAt:"2026-09-08T08:00:00Z",history:[]};
const restored=projectActivePickingWork(updated,"TARGET");
assert.equal(restored.wave,updated.waves[0],"Without exclusions the original wave object is returned");
assert.equal(restored.items[0],updated.items[0],"Without exclusions original item objects are returned");
assert.deepEqual(restored.wave.sourcePurchaseOrderNumbers,["P1","P2"]);
assert.equal(restored.items.length,2,"Restoring completion brings the original excluded SKU back");
assert.deepEqual(restored.items[0].allocations[0],snapshot.items[0].allocations[0]);
assert.throws(()=>mergeActivePickingWorkMutation(updated,{action:"saveItem",item:changed}),/새로고침/,"Old projection cannot save after completion is restored");
const badScope={...changed,workScope:{...changed.workScope,sourceRevision:999}};
assert.throws(()=>mergeActivePickingWorkMutation(snapshot,{action:"saveItem",item:badScope}),/새로고침/);
assert.throws(()=>mergeActivePickingWorkMutation(snapshot,{action:"saveItem",item:{...snapshot.items[0],pickedQuantity:12,status:"full",shortageQuantity:0}}),/새로고침/,"Old unscoped client cannot re-pick a completed PO");
const metadata={...snapshot.items[0],imageUrl:"https://example.test/new.jpg"};
assert.equal(mergeActivePickingWorkMutation(snapshot,{action:"saveItem",item:metadata}).item.imageUrl,metadata.imageUrl,"Metadata-only old-client edit is allowed");
assert.throws(()=>mergeActivePickingWorkMutation(snapshot,{action:"saveItem",item:{...changed,sources:[]}}),/새로고침/);

const latest=structuredClone(snapshot);latest.revision=11;latest.items[0].allocations[0].fulfilledQuantity=3;latest.items[0].allocations[0].shortageQuantity=2;latest.items[0].pickedQuantity=7;latest.items[0].shortageQuantity=5;
const latestMerged=mergeActivePickingWorkMutation(latest,{action:"saveItem",item:changed});
assert.equal(latestMerged.item.allocations[0].fulfilledQuantity,3,"The newest excluded portion wins over stale client content");
assert.equal(latestMerged.item.pickedQuantity,10);
const pending=fixture();pending.items[0]={...pending.items[0],status:"pending",pickedQuantity:0,shortageQuantity:0,allocations:[]};
const pendingActive=projectActivePickingWork(pending,"TARGET");
assert.equal(pendingActive.items[0].status,"pending");assert.equal(pendingActive.items[0].shortageQuantity,0,"Unreviewed rows are not invented shortages");
const full=fixture();full.items[0]={...full.items[0],status:"full",pickedQuantity:12,shortageQuantity:0,allocations:[]};
const fullActive=projectActivePickingWork(full,"TARGET");assert.equal(fullActive.items[0].pickedQuantity,7);
const notFound={...fullActive.items[0],status:"notfound",pickedQuantity:0,shortageQuantity:7,allocations:[allocation(fullActive.items[0].sources[0],0)]};
const fullMerged=mergeActivePickingWorkMutation(full,{action:"saveItem",item:notFound}).item;
assert.equal(fullMerged.pickedQuantity,5,"Implicit prior full quantity of excluded PO survives an active edit");
assert.equal(fullMerged.shortageQuantity,7);
assert.deepEqual(fullMerged.allocations.filter(row=>row.purchaseOrderNumber==="P1"),[],"Missing historical allocations are not invented");

const own=fixture();own.outboundWorkStates.TARGET={status:"completed",source:"manual",updatedAt:"2026-09-08T09:00:00Z",history:[]};
assert.equal(projectActivePickingWork(own,"TARGET").wave,own.waves[0],"Own completed work remains raw history");
const all=fixture();all.waves[0].sourcePurchaseOrderNumbers=["P1"];all.items=all.items.map(row=>row.waveId==="TARGET"?{...row,sources:row.sources.filter(source=>source.purchaseOrderNumber==="P1"),allocations:row.allocations.filter(source=>source.purchaseOrderNumber==="P1")}:row);
const allActive=projectActivePickingWork(all,"TARGET");assert.equal(allActive.fullyCompletedElsewhere,true);assert.equal(allActive.items.length,0);

const newOutput=(id,pos)=>({...snapshot.waves[0].outputGenerations[0],generationId:id,purchaseOrderNumbers:pos});
const withNewOutput=(wave,generation)=>({...wave,outputGenerations:[...(wave.outputGenerations||[]),generation]});
for(const sourceWave of [active.wave,snapshot.waves[0]]) {
 assert.throws(()=>mergeActivePickingWorkMutation(snapshot,{action:"saveWave",wave:withNewOutput(sourceWave,newOutput("NEW-EXCLUDED",["P1"]))}),/새로고침/,"Neither projected nor old clients can put a completed PO in a new generation");
 assert.throws(()=>mergeActivePickingWorkMutation(snapshot,{action:"saveWave",wave:{...sourceWave,outputGenerations:[newOutput("MIX",["P1","P3"])]}}),/새로고침/,"Reusing a generation ID cannot alter its completed PO membership");
 const safe=mergeActivePickingWorkMutation(snapshot,{action:"saveWave",wave:withNewOutput(sourceWave,newOutput("ACTIVE-ONLY",["P2"]))});
 assert.deepEqual(safe.wave.outputGenerations.map(g=>g.generationId),["MIX","ACTIVE-ONLY"]);
 assert.equal(safe.wave.outputGenerations[0],snapshot.waves[0].outputGenerations[0],"The old mixed physical document is retained without editing it");
}
// Replacing an old mixed output may update only its successor marker and timestamp.
const successor={...newOutput("REMAINDER",["P2"]),updatedAt:"2026-09-08T10:00:00Z"};
const replacedOld={...snapshot.waves[0].outputGenerations[0],shipmentFileName:"must-not-replace-original.xlsx",supersededByGenerationId:"REMAINDER",updatedAt:successor.updatedAt};
const supersedingWave={...active.wave,updatedAt:successor.updatedAt,outputGenerations:[replacedOld,successor]};
const superseded=mergeActivePickingWorkMutation(snapshot,{action:"saveWave",wave:supersedingWave}).wave;
assert.deepEqual(superseded.outputGenerations[0],{...snapshot.waves[0].outputGenerations[0],supersededByGenerationId:"REMAINDER",updatedAt:successor.updatedAt},"Supersession preserves every physical file and original PO membership");
assert.deepEqual(superseded.outputGenerations[0].purchaseOrderNumbers,["P1","P2"]);
assert.notEqual(packingGenerationKey(superseded),packingGenerationKey(snapshot.waves[0]),"An intentional new output invalidates previous packing checks");
assert.equal(packingGenerationKey(superseded),packingGenerationKey({...active.wave,outputGenerations:[successor]}),"Superseded mixed output no longer participates in the active packing generation");
const appliedSuperseded=applyPickingWaveStoreMutation(snapshot,{action:"saveWave",wave:supersedingWave});
assert.equal(appliedSuperseded.waves.find(w=>w.id==="TARGET").outputGenerations[0].supersededByGenerationId,"REMAINDER");
for(const invalidReplacement of [null,{...successor,purchaseOrderNumbers:["UNKNOWN"]},{...successor,waveId:"OTHER"},{...successor,supersededByGenerationId:"ANOTHER"}]) {
 const result=mergeActivePickingWorkMutation(snapshot,{action:"saveWave",wave:{...active.wave,outputGenerations:[replacedOld,...(invalidReplacement?[invalidReplacement]:[])]}}).wave;
 assert.equal(result.outputGenerations[0],snapshot.waves[0].outputGenerations[0],"A missing, unrelated or inactive successor cannot modify an old physical output");
}
const excludedOnlyOutput=fixture();excludedOnlyOutput.waves[0].outputGenerations[0].purchaseOrderNumbers=["P1"];
const excludedOnlyActive=projectActivePickingWork(excludedOnlyOutput,"TARGET");
const noOverlap=mergeActivePickingWorkMutation(excludedOnlyOutput,{action:"saveWave",wave:{...excludedOnlyActive.wave,outputGenerations:[{...excludedOnlyOutput.waves[0].outputGenerations[0],supersededByGenerationId:"REMAINDER"},successor]}}).wave;
assert.equal(noOverlap.outputGenerations[0].supersededByGenerationId,undefined,"A new active output cannot supersede a disjoint old PO set");
const existingSuccessor=fixture();existingSuccessor.waves[0].outputGenerations.push(successor);
const existingActive=projectActivePickingWork(existingSuccessor,"TARGET");
assert.equal(mergeActivePickingWorkMutation(existingSuccessor,{action:"saveWave",wave:{...existingActive.wave,outputGenerations:[replacedOld,successor]}}).wave.outputGenerations[0].supersededByGenerationId,undefined,"Only a newly submitted generation can supersede the mixed output");

for(const projected of [{waves:[active.wave]},{items:active.items}]) {
 assert.throws(()=>mergeActivePickingWorkMutation(snapshot,{action:"migrate",snapshot:projected}),/새로고침/,"Transient projections cannot become raw data through a local cache migration");
 assert.throws(()=>applyPickingWaveStoreMutation(snapshot,{action:"migrate",snapshot:projected}),/새로고침/);
}
const rawMigration={action:"migrate",snapshot:{waves:snapshot.waves,items:snapshot.items}};
assert.equal(mergeActivePickingWorkMutation(snapshot,rawMigration),rawMigration,"Raw cache migration is preserved");

// The real reducer must sanitize before replacing either wave or item rows; no filesystem/network store I/O is used.
const applied=applyPickingWaveStoreMutation(snapshot,{action:"saveProgress",wave:{...active.wave,updatedAt:changed.updatedAt},items:[changed]});
assert.equal(JSON.stringify(snapshot),raw,"Real reducer leaves the original snapshot untouched");
const appliedWave=applied.waves.find(w=>w.id==="TARGET"),appliedMixed=applied.items.find(i=>i.id==="MIXED");
assert.deepEqual(appliedWave.sourcePurchaseOrderNumbers,["P1","P2"]);
assert.deepEqual(appliedMixed.sources,snapshot.items[0].sources);
assert.deepEqual(appliedMixed.allocations[0],snapshot.items[0].allocations[0]);
assert.equal(appliedMixed.pickedQuantity,9);
assert.deepEqual(applied.items.find(i=>i.id==="EXCLUDED"),snapshot.items[1],"Excluded-only SKU history survives actual saveProgress");
assert.equal(appliedWave.workScope,undefined);assert.equal(appliedMixed.workScope,undefined);
assert.equal(projectActivePickingWork(applied,"TARGET").items[0].pickedQuantity,7);
assert.throws(()=>applyPickingWaveStoreMutation(updated,{action:"saveItem",item:changed}),/새로고침/);
assert.throws(()=>applyPickingWaveStoreMutation(snapshot,{action:"saveItem",item:{...snapshot.items[0],pickedQuantity:12,status:"full",shortageQuantity:0}}),/새로고침/);
assert.throws(()=>applyPickingWaveStoreMutation(snapshot,{action:"saveWave",wave:withNewOutput(snapshot.waves[0],newOutput("BAD",["P1"]))}),/새로고침/);
console.log("PASS: active PO/SKU/center projection, mixed allocation quantities, pending preservation, raw source and history unchanged, scoped and real reducer merge, restore, stale/unscoped write protection, newest excluded allocation preservation, new-generation exclusion, restricted mixed-output supersession and migration protection.");
