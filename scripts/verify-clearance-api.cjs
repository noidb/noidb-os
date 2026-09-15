const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('typescript'),Module=require('module');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const resolve=Module._resolveFilename;Module._resolveFilename=function(r,...args){return resolve.call(this,r.startsWith('@/')?path.join(process.cwd(),r.slice(2)):r,...args);};
let externalRequests=0;global.fetch=async()=>{externalRequests++;throw Error('External network blocked');};
const storeModule=require('../lib/wms/picking-wave/server-store.ts'),weekly=require('../lib/wms/weekly-work-store.ts');
const state=require('../lib/wms/weekly-work-state.ts'),{emptyPickingWaveStoreSnapshot}=require('../lib/wms/picking-wave/shared-store-types.ts');
let store=emptyPickingWaveStoreSnapshot(),workspace=state.emptyWeeklyWorkspace();
const now='2026-09-15T04:00:00.000Z';
store.supplierHubPurchaseOrders=[{purchaseOrderNumber:'100',capturedAt:now,expectedDate:'2026-09-12',items:[{lineNo:1,productCode:'200',productName:'검증상품',vendorConfirmedQuantity:4,receivedQuantity:99}]}];
store.supplierHubOrderStatuses=[{orderNo:'100',purchaseType:'직매입',settlementStatus:'정산완료',collectedAt:now}];
store.supplierHubInboundEvents=[{id:'receipt1',eventKey:'receipt1',orderNo:'100',skuId:'200',skuName:'검증상품',inboundDate:'2026-09-12',quantity:'2',division:'발주',warehouse:'센터',collectedAt:now,source:'supplier-hub-extension'}];
storeModule.readPickingWaveStore=async()=>structuredClone(store);storeModule.mutatePickingWaveStore=async mutation=>{store=storeModule.applyPickingWaveStoreMutation(store,mutation);return structuredClone(store);};
weekly.readWeeklyWorkspace=async()=>structuredClone(workspace);weekly.mutateWeeklyWorkspace=async fn=>{const next=structuredClone(workspace),r=fn(next);next.revision++;workspace=next;return structuredClone(r);};
require('../lib/wms/product-catalog.ts').fetchProductCatalog=async()=>({configured:true,items:[{skuId:'200',productName:'검증상품',vendorName:'거래처A'}]});
const {NextRequest}=require('next/server');
const req=(url,body)=>new NextRequest('http://localhost:3497'+url,body?{method:'POST',headers:{'content-type':'application/json',origin:'http://localhost:3497',host:'localhost:3497'},body:JSON.stringify(body)}:undefined);
(async()=>{
  const source=require('../app/api/wms/supplier-hub-orders/route.ts'),shortage=require('../app/api/wms/vendor-orders/actual-inbound-shortage/route.ts');
  const original=JSON.stringify([store,workspace]);for(let i=0;i<2;i++){const r=await source.GET(req('/api/wms/supplier-hub-orders?includeHistorical=1'));assert.equal(r.status,200);const d=await r.json();assert.equal(d.orders.length,1);assert.equal(d.lifecycleResults[0].actualReceivedQuantity,2);assert.match(d.historicalInboundStats.sourceError,/저장본/);}
  assert.equal(JSON.stringify([store,workspace]),original);assert.equal(externalRequests,0);
  let r=await shortage.POST(req('/api/wms/vendor-orders/actual-inbound-shortage',{action:'delay',purchaseOrderNumber:'100',skuId:'200',memo:'거래처 확인, 3주 후'}));assert.equal(r.status,200,JSON.stringify(await r.json()));
  let d=await (await shortage.GET()).json();assert.equal(d.lines.length,0);assert.equal(d.delayedLines.length,1);assert.equal(d.delayedLines[0].releaseAvailable,false);
  r=await shortage.POST(req('/api/wms/vendor-orders/actual-inbound-shortage',{action:'receive-delay',purchaseOrderNumber:'100',skuId:'200'}));assert.equal(r.status,409);
  store.supplierHubInboundEvents.push({...store.supplierHubInboundEvents[0],id:'receipt2',eventKey:'receipt2',inboundDate:'2026-09-13'});
  d=await (await shortage.GET()).json();assert.equal(d.delayedLines[0].releaseAvailable,true);
  r=await shortage.POST(req('/api/wms/vendor-orders/actual-inbound-shortage',{action:'receive-delay',purchaseOrderNumber:'100',skuId:'200'}));assert.equal(r.status,200,JSON.stringify(await r.json()));
  d=await (await source.GET(req('/api/wms/supplier-hub-orders'))).json();assert.deepEqual(d.completedPurchaseOrderNumbers,['100']);assert.equal(d.lifecycleResults[0].initialShortageQuantity,2);assert.equal(store.supplierHubInboundEvents.length,2);assert.equal(externalRequests,0);
  console.log('PASS real API handlers with in-memory stores: repeat GET uses snapshots, Drive unavailable fallback, delayed source preserved after full receipt, explicit release, final history, no source writes.');
})().catch(e=>{console.error(e);process.exitCode=1;});
