const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript'),path=require('node:path');
require.extensions['.ts']=(m,p)=>m._compile(ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,p);
const {chromium}=require('C:/Users/noidb/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {applyPickingWaveStoreMutation}=require('../lib/wms/picking-wave/server-store.ts');
const {projectActivePickingWork}=require('../lib/wms/active-picking-work.ts');
const target='WAVE-20260908-8af1667d',out='outputs/source-preparation-20260908';
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const response=await fetch('https://noidb-os.vercel.app/api/wms/picking-waves');assert(response.ok);
 let snapshot=(await response.json()).snapshot;const original=structuredClone(snapshot),errors=[],requests=[],screens=[];
 const view=projectActivePickingWork(snapshot,target);assert.equal(view.wave.sourcePurchaseOrderNumbers.length,10);
 const rawWave=original.waves.find(w=>w.id===target),rawItems=original.items.filter(i=>i.waveId===target);
 const purchaseOrders=rawWave.sourcePurchaseOrderNumbers.map(po=>{const rows=rawItems.filter(i=>i.sources.some(s=>s.purchaseOrderNumber===po));return {purchaseOrderNumber:po,rowCount:rows.length,skuCount:rows.length,totalOrderedQuantity:rows.reduce((n,i)=>n+i.sources.filter(s=>s.purchaseOrderNumber===po).reduce((m,s)=>m+s.requestedQuantity,0),0),statusValues:[],fulfillmentCenters:[rawWave.shippingGroups.find(g=>g.purchaseOrderNumbers.includes(po)).fulfillmentCenter],sourceConfirmed:false,errorMessages:[]};});
 const source={fileName:'fixture-combined.xlsx',fileHash:'test-hash',source:'google-drive',totalPurchaseOrderCount:12,totalRowCount:102,sheetNames:['상품목록'],purchaseOrders};
 const ready={requestedPurchaseOrderCount:10,matchedPurchaseOrderCount:10,missingPurchaseOrderNumbers:[],duplicatePurchaseOrderCount:0,conflictPurchaseOrderNumbers:[],fulfillmentCenterCount:9,shippingGroupCount:view.wave.shippingGroups.length,shippingGroups:view.wave.shippingGroups.map(g=>({fulfillmentCenterName:g.fulfillmentCenter,expectedArrivalDate:g.expectedDate,purchaseOrderNumbers:g.purchaseOrderNumbers,totalQuantity:view.items.reduce((n,item)=>n+item.sources.filter(source=>g.purchaseOrderNumbers.includes(source.purchaseOrderNumber)).reduce((m,source)=>m+source.requestedQuantity,0),0)})),expectedInvoiceRowCount:view.wave.shippingGroups.length,missingAddressPurchaseOrders:[],missingPhonePurchaseOrders:[],missingPostalCodeCenters:[],destinationResolutions:[],missingSkuRows:[],missingBarcodeRows:[],quantityErrorRows:[],oversizedPurchaseOrderNumbers:[],sourceRecordCount:98,totalOrderedQuantity:152,blockingReasons:[],canGenerate:true};
 const failed={...ready,canGenerate:false,missingPostalCodeCenters:['센터 주소 확인 대상'],blockingReasons:['센터 주소 및 우편번호 확인이 필요합니다.'],destinationResolutions:[{fulfillmentCenterName:'센터 주소 확인 대상',sourceAddress:'시험용 센터 주소',status:'unresolved',reason:'외부 주소 조회를 다시 확인해 주세요.'}]};
 let sourceAvailable=false,partialSource=false,sourceCalls=0,previewCalls=0;
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:960}});
  const previewKey='noidb:wms:hanjin-preview:'+JSON.stringify(['250-balanced-v1',[...view.wave.sourcePurchaseOrderNumbers].sort().join('|'),null]);
  await context.addInitScript(({previewKey,failed})=>{localStorage.setItem('noidb_picking_wave_shared_migration_v1','1');sessionStorage.setItem(previewKey,JSON.stringify({savedAt:Date.now(),preview:failed}));},{previewKey,failed});
  await context.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url()),method=req.method();let data={};if(method==='POST')data=req.postDataJSON()||{};
   requests.push({path:url.pathname,method,action:data.action});let result,status=200;
   try{
    if(url.pathname==='/api/wms/picking-waves'){if(method==='POST')snapshot=applyPickingWaveStoreMutation(snapshot,data);result={ok:true,snapshot};}
    else if(url.pathname==='/api/wms/product-catalog')result={success:true,configured:true,items:[]};
    else if(url.pathname==='/api/wms/supplier-hub-orders')result={orders:original.waves.flatMap(w=>(w.shippingGroups||[]).flatMap(g=>g.purchaseOrderNumbers.map(po=>({purchaseOrderNumber:po,expectedDate:g.expectedDate,fulfillmentCenter:g.fulfillmentCenter}))))};
    else if(url.pathname==='/api/wms/po-confirm/inspect-source'){sourceCalls++;if(sourceAvailable){const allowed=new Set([...view.wave.sourcePurchaseOrderNumbers.slice(0,8),...view.excludedPurchaseOrderNumbers]);result={source:partialSource?{...source,purchaseOrders:source.purchaseOrders.filter(p=>allowed.has(p.purchaseOrderNumber))}:source,folderAccessible:true};}else{status=404;result={code:'SOURCE_NOT_FOUND',error:'원본이 없습니다.',folderAccessible:true};}}
    else if(url.pathname==='/api/wms/hanjin-upload/preview'){previewCalls++;result={preview:previewCalls===1?failed:ready};}
    else if(url.pathname==='/api/wms/vendor-orders/queue')result={success:true,queueId:null,consumedLineIds:[]};
    else if(url.pathname==='/api/wms/vendor-order-actions')result={success:true,delaySummaries:[]};
    else{status=409;result={ok:false,success:false,error:'Fixture: external requests are blocked'};}
   }catch(e){status=409;result={ok:false,error:e.message};}
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto('http://localhost:3000/wms/picking/waves/'+target+'/complete',{waitUntil:'domcontentloaded',timeout:90000});
   await page.getByText('발주서 업로드 양식을 다운로드해 주세요.',{exact:true}).waitFor({timeout:90000});
   assert.match(await page.getByText('양식 필요',{exact:true}).locator('..').innerText(),/10/);
   assert.equal(await page.getByText('오류 발주',{exact:true}).count(),0);
   assert.equal(await page.getByText(/141427163|141427351/).count(),0);
   const invoice=page.getByRole('button',{name:'선택 발주 송장파일 생성',exact:true});
   await page.getByRole('button',{name:'주소·우편번호 다시 자동 확인',exact:true}).waitFor({timeout:90000});
   assert.equal(previewCalls,1,'failed session cache must not prevent a fresh preview');assert(await invoice.isDisabled());
   for(const width of [1280,390]){await page.setViewportSize({width,height:width===390?844:960});assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)));await page.getByText('발주서 업로드 양식을 다운로드해 주세요.',{exact:true}).scrollIntoViewIfNeeded();await page.locator('#po-confirm').screenshot({path:path.join(out,'missing-source-'+width+'.png')});screens.push({stage:'missing',width,passed:true});}
   const sourceCallsBeforeRetry=sourceCalls;sourceAvailable=true;await page.getByRole('button',{name:'폴더 양식 다시 확인',exact:true}).click();
   await page.getByText('확정 가능',{exact:true}).locator('..').filter({hasText:'10'}).waitFor({timeout:15000});
   assert.equal(await page.getByText('발주서 업로드 양식을 다운로드해 주세요.',{exact:true}).count(),0);
   assert.match(await page.getByText('오류 발주',{exact:true}).locator('..').innerText(),/0/);
   assert.equal(await page.getByText(/141427163|141427351/).count(),0);assert.equal(sourceCalls,sourceCallsBeforeRetry+1);
   await page.getByRole('button',{name:'주소·우편번호 다시 자동 확인',exact:true}).click();
   await page.getByText('송장 생성 준비 완료',{exact:true}).waitFor({timeout:15000});assert.equal(previewCalls,2);assert(await invoice.isEnabled());
   for(const width of [1280,390]){await page.setViewportSize({width,height:width===390?844:960});assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)));await invoice.scrollIntoViewIfNeeded();await page.locator('#hanjin-step-1').screenshot({path:path.join(out,'ready-invoice-'+width+'.png')});screens.push({stage:'ready',width,passed:true});}
   partialSource=true;await page.reload({waitUntil:'domcontentloaded',timeout:90000});
   await page.getByText('양식 필요',{exact:true}).locator('..').filter({hasText:'2'}).waitFor({timeout:15000});
   for(const [label,count] of [['전체 발주',10],['확정 가능',8],['선택됨',8],['오류 발주',0]])assert.equal((await page.getByText(label,{exact:true}).locator('..').innerText()).split(/\s+/)[0],String(count));
   assert(await page.getByRole('button',{name:'선택 발주확정 서류 생성',exact:true}).isEnabled());
   assert.equal(await page.getByText(/141427163|141427351/).count(),0);
   for(const width of [1280,390]){await page.setViewportSize({width,height:width===390?844:960});assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)));await page.locator('#po-confirm').screenshot({path:path.join(out,'partial-source-'+width+'.png')});screens.push({stage:'partial',width,passed:true});}
   assert.deepEqual(errors,[]);assert.deepEqual(snapshot.waves,original.waves);assert.deepEqual(snapshot.items,original.items);assert.deepEqual(snapshot.baskets,original.baskets);assert.deepEqual(snapshot.outboundWorkStates,original.outboundWorkStates);
   assert(!requests.some(r=>/generate/.test(r.path)),'generation and external submission not executed');
   fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({passed:true,activePoCount:10,sourceCalls,previewCalls,failedCacheIgnored:true,partialSource:{available:8,missing:2,errors:0,generationEnabled:true},excluded:view.excludedPurchaseOrderNumbers,screens,errors,requests,productionReads:1,externalWrites:0},null,2));
   console.log('PASS source preparation: missing source is 10 forms needed, not errors; folder retry recovers10; completed2 remain excluded; failed cached address preview refetched and retry enables generation; partial8 ready/2 forms needed/0 errors, desktop/mobile overflow0, errors0, external writes0.');
  }catch(e){fs.writeFileSync(path.join(out,'debug.txt'),await page.locator('body').innerText());await page.screenshot({path:path.join(out,'debug.png')});console.log(JSON.stringify({sourceCalls,previewCalls,errors,requests}));throw e;}
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
