const fs=require('fs'),path=require('path'),vm=require('vm'),ts=require('typescript'),assert=require('node:assert/strict'),crypto=require('node:crypto'),Module=require('module');
const root=process.cwd(),routeFile=path.join(root,'app/api/wms/logistics/follow-up/route.ts');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const resolve=Module._resolveFilename;Module._resolveFilename=function(request,...args){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,...args)};
let workspace,requests=[],files=new Map(),completeCalls=[],vendorLines=[];
const at='2026-09-20T00:00:00.000Z', collectedAt='2026-09-20T00:00:00.000Z';
const clone=value=>structuredClone(value);
const line=(sku='222')=>({lineKey:`marketing::${sku}`,sourceLineKey:`${sku}`,shipmentNumber:'99990001',boxId:'A',purchaseOrderNumber:'111',skuId:sku,productName:'검증',barcode:'R',deliveredQuantity:1,receivedQuantity:1,handledQuantity:0,remainingQuantity:0,kind:'marketing',state:'routed',firstArrivalCandidate:true,target:{}});
const board=()=>({collectedAt,targets:[],warnings:[],lines:[line()]});
const response=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
const weekly={readWeeklyWorkspace:async()=>clone(workspace),mutateWeeklyWorkspace:async fn=>{const next=clone(workspace),result=fn(next);next.revision++;workspace=next;return clone(result)}};
const deps={
 'next/server':{NextResponse:{json:(v,o)=>new Response(JSON.stringify(v),{status:o?.status||200,headers:o?.headers})},NextRequest:class{}},
 'node:crypto':crypto,
 '@/lib/wms/logistics-aside-baseline.json':{closedShipmentNumbers:[],pendingTargets:[],completedMarketingSkuIds:[],excludedMarketingSkuIds:[],handledLines:[]},
 '@/lib/wms/invoice-group/server-store':{readInvoiceGroupStore:async()=>({groups:[]})},
 '@/lib/wms/picking-wave/server-store':{readPickingWaveStore:async()=>({vendorOrderLines:clone(vendorLines)})},
 '@/lib/wms/logistics-receipts':{collectDispatchReceiptTargets:()=>[],mergeLogisticsReceiptTargets:()=>[],buildLogisticsReceiptBoard:()=>board()},
 '@/lib/wms/weekly-work-store':weekly,
 '@/lib/wms/weekly-work-files':{readWeeklyFile:async key=>files.get(key)||null,saveWeeklyFile:async(key,value)=>{if(files.has(key))throw Error('overwrite');files.set(key,Buffer.from(value))}},
 '@/lib/wms/noidb-action-auth':{isSameOriginActionRequest:()=>true},
 '@/lib/wms/weekly-discontinue-queue':{readWeeklyDiscontinueQueue:async()=>({requests:clone(requests),catalogItems:[]}),syncWeeklyDiscontinueQueue:(...args)=>actual('@/lib/wms/weekly-discontinue-queue').syncWeeklyDiscontinueQueue(...args)},
 '@/lib/wms/vendor-order-actions':{completeStatusRequests:async ids=>{completeCalls.push([...ids]);for(const r of requests)if(ids.includes(r.id))r.supplyHubStatus='처리완료'},listStatusRequests:async()=>clone(requests)},
};
function actual(name){return require(path.join(root,name.replace('@/', '')+'.ts'));}
deps['@/lib/wms/logistics-follow-up']=actual('@/lib/wms/logistics-follow-up');
deps['@/lib/wms/logistics-discontinue-adapter']=actual('@/lib/wms/logistics-discontinue-adapter');
deps['@/lib/wms/weekly-work-state']=actual('@/lib/wms/weekly-work-state');
const mod={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(routeFile,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{module:mod,exports:mod.exports,require:n=>{if(deps[n])return deps[n];throw Error(`unmocked ${n}`)},Buffer,Response,Request,URL,Set,Object,JSON,Date,Error,structuredClone,console});
const api=mod.exports;
const req=body=>new Request('http://test/api/wms/logistics/follow-up',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
function baseRun(sku='222'){return {id:`LOG-${sku}`,revision:0,updatedAt:at,sentVendors:{},logisticsReceiptLine:{lineKey:`marketing::${sku}`,shipmentNumber:'99990001',boxId:'A',purchaseOrderNumber:'111',skuId:sku,deliveredQuantity:1,receivedQuantity:1,shortageQuantity:1},snapshot:{id:`LOG-${sku}`,rulesVersion:5,sourceToken:'x',createdAt:at,period:{startDate:'2026-09-20',endDate:'2026-09-20'},source:{files:[],latestActualDate:'',firstActualDate:'',eventCount:0,duplicateCount:0,selectedEventCount:0,mode:'browser'},couponItems:[],vendorItems:[{skuId:sku,productName:'검증',productLink:'',vendorName:'',imageUrl:'',optionLabel:'',modelName:'',barcode:'R',shortageQuantity:1,openOrderQuantity:0,suggestedQuantity:1,relatedPurchaseOrderNumbers:['111'],issues:[],discontinued:false}],warnings:[],blockers:[]},reviews:{[sku]:{skuId:sku,vendorName:'',imageUrl:'',quantity:1,quantityConfirmed:true,decision:'discontinue'}},reviewedSkuIds:[sku]};}
async function post(body){const r=await api.POST(req(body));return [r,await r.json()]}
(async()=>{
 workspace={schemaVersion:1,revision:0,runs:[baseRun()],productOverrides:{},logisticsReceipts:{collectedAt},logisticsReceiptRoutes:{'marketing::222':{decision:'discontinue',runId:'LOG-222',completed:true,sourceFingerprint:JSON.stringify(['marketing::222',1,1,0,0])}}};
 let token=deps['@/lib/wms/logistics-follow-up'].logisticsFollowUpToken(workspace,board());
 let [r,d]=await post({action:'generate',kind:'discontinue',token,expectedCollectedAt:collectedAt});assert.equal(r.status,200,JSON.stringify(d));assert(files.has(`output-${d.outputKey}.json`));
 let saved=JSON.parse(files.get(`output-${d.outputKey}.json`));assert.equal(saved.digest,crypto.createHash('sha256').update(JSON.stringify([saved.output.fileName,saved.output.base64,saved.output.generated,saved.proof])).digest('hex'));
 token=deps['@/lib/wms/logistics-follow-up'].logisticsFollowUpToken(workspace,board());[r,d]=await post({action:'complete',kind:'discontinue',outputKey:saved.proof.outputKey,token,expectedCollectedAt:collectedAt,confirmSubmitted:true});assert.equal(r.status,200,JSON.stringify(d));
 completeCalls=[];[r,d]=await post({action:'complete',kind:'discontinue',outputKey:saved.proof.outputKey,token:'stale',expectedCollectedAt:collectedAt,confirmSubmitted:false});assert.equal(r.status,400);assert.equal(completeCalls.length,0,'invalid confirmation/stale token must not acknowledge status');
 requests=[{id:'S1',skuId:'301',productName:'상태1',purchaseOrderNumber:'501',requestType:'단종',supplyHubStatus:'처리대기',modelSku:'',optionLabel:'',productLink:''},{id:'S2',skuId:'302',productName:'상태2',purchaseOrderNumber:'502',requestType:'단종',supplyHubStatus:'처리대기',modelSku:'',optionLabel:'',productLink:''}];workspace={schemaVersion:1,revision:0,runs:[],productOverrides:{},logisticsReceipts:{collectedAt}};
 for(const sku of ['301','303']) { const run=baseRun(sku);run.reviews[sku].decision='order';workspace.runs.push(run); }
 vendorLines=[{sentResolution:{kind:'discontinue',destinationId:'S1'},shipmentReceiptDetails:[{lineKey:'marketing::301'}]}, {sentResolution:{kind:'discontinue',destinationId:'S3'},shipmentReceiptDetails:[{lineKey:'marketing::303'}]}];
 token=deps['@/lib/wms/logistics-follow-up'].logisticsFollowUpToken(workspace,board());[r,d]=await post({action:'generate',kind:'discontinue',token,expectedCollectedAt:collectedAt});assert.equal(r.status,200,JSON.stringify(d));assert.deepEqual(d.proof.requestIds,['S1','S2']);
 const statusOutputKey=d.outputKey;token=deps['@/lib/wms/logistics-follow-up'].logisticsFollowUpToken(workspace,board());completeCalls=[];
 for(const invalid of [{token,confirmSubmitted:false},{token:'stale',confirmSubmitted:true}]){const [invalidResponse]=await post({action:'complete',kind:'discontinue',outputKey:statusOutputKey,expectedCollectedAt:collectedAt,...invalid});assert.equal(invalidResponse.status,400);assert.equal(completeCalls.length,0,'invalid status-backed completion must not acknowledge any request');}
 const download=await api.GET(new Request(`http://test/api/wms/logistics/follow-up?outputKey=${d.outputKey}`));assert.equal(download.status,200,'saved status proof is downloadable');requests.push({id:'S3',skuId:'303',productName:'상태3',purchaseOrderNumber:'503',requestType:'단종',supplyHubStatus:'처리대기',modelSku:'',optionLabel:'',productLink:''});token=deps['@/lib/wms/logistics-follow-up'].logisticsFollowUpToken(workspace,board());completeCalls=[];[r,d]=await post({action:'complete',kind:'discontinue',outputKey:d.outputKey,token,expectedCollectedAt:collectedAt,confirmSubmitted:true});assert.equal(r.status,200,JSON.stringify(d));assert.deepEqual(completeCalls,[['S1','S2']]);assert.equal(requests.find(row=>row.id==='S3').supplyHubStatus,'처리대기','late status ID remains pending');
 assert(workspace.runs.find(run=>run.id==='LOG-301').completedAt,'completed vendor-origin leaves active follow-up');assert.equal(workspace.runs.find(run=>run.id==='LOG-303').completedAt,undefined,'later vendor-origin remains pending');
 console.log('PASS follow-up API memory route: direct/status discontinue proof, saved digest/download, exact late-ID and vendor-origin completion, invalid side-effect gate.');
})().catch(error=>{console.error(error);process.exitCode=1});
