const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript'),path=require('node:path');
require.extensions['.ts']=(m,p)=>m._compile(ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,p);
const {chromium}=require('C:/Users/noidb/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {applyPickingWaveStoreMutation}=require('../lib/wms/picking-wave/server-store.ts');
const {projectActivePickingWork}=require('../lib/wms/active-picking-work.ts');
const {assertActivePurchaseOrderSelection}=require('../lib/wms/active-purchase-order-selection.ts');
const target='WAVE-20260908-8af1667d',out='outputs/cross-wave-dispatch-20260908';
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const liveResponse=await fetch('https://noidb-os.vercel.app/api/wms/picking-waves');assert(liveResponse.ok);
 let snapshot=(await liveResponse.json()).snapshot;const original=structuredClone(snapshot), errors=[], mutations=[];
 const view=projectActivePickingWork(snapshot,target);
 assert.deepEqual(view.excludedPurchaseOrderNumbers,['141427163','141427351']);assert.equal(view.items.length,98);assert.equal(view.items.reduce((n,i)=>n+i.totalQuantity,0),152);
 assert.throws(()=>assertActivePurchaseOrderSelection(snapshot,target,['141427163']),/출고완료/);
 assert.doesNotThrow(()=>assertActivePurchaseOrderSelection(snapshot,target,view.wave.sourcePurchaseOrderNumbers));
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const screens=[];
 try{
 const context=await browser.newContext({viewport:{width:1280,height:960}});
 await context.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url()),method=req.method();let data={};
   if(method==='POST')data=req.postDataJSON()||{};
   let result;
   try{
    if(url.pathname==='/api/wms/picking-waves'){
      if(method==='POST'){mutations.push(data.action);snapshot=applyPickingWaveStoreMutation(snapshot,data);}
      result={ok:true,snapshot};
    }else if(url.pathname==='/api/wms/product-catalog')result={success:true,configured:true,items:[]};
    else if(url.pathname==='/api/wms/supplier-hub-orders')result={orders:original.waves.flatMap(w=>(w.shippingGroups||[]).flatMap(g=>g.purchaseOrderNumbers.map(po=>({purchaseOrderNumber:po,expectedDate:g.expectedDate,fulfillmentCenter:g.fulfillmentCenter}))))};
    else if(url.pathname==='/api/wms/po-confirm/inspect-source'){
      const rawWave=original.waves.find(w=>w.id===target),rawItems=original.items.filter(i=>i.waveId===target);
      const purchaseOrders=rawWave.sourcePurchaseOrderNumbers.map(po=>{const rows=rawItems.filter(i=>i.sources.some(source=>source.purchaseOrderNumber===po));return {purchaseOrderNumber:po,rowCount:rows.length,skuCount:rows.length,totalOrderedQuantity:rows.reduce((n,i)=>n+i.sources.filter(source=>source.purchaseOrderNumber===po).reduce((m,source)=>m+source.requestedQuantity,0),0),statusValues:[],fulfillmentCenters:[rawWave.shippingGroups.find(g=>g.purchaseOrderNumbers.includes(po)).fulfillmentCenter],sourceConfirmed:false,errorMessages:[]};});
      result={source:{fileName:'fixture-combined.xlsx',fileHash:'test-hash',source:'upload',totalPurchaseOrderCount:12,totalRowCount:102,sheetNames:['PO'],purchaseOrders},folderAccessible:true};
    }
    else if(url.pathname==='/api/wms/vendor-orders/queue')result={success:true,queueId:null,consumedLineIds:[]};
    else if(url.pathname==='/api/wms/vendor-order-actions')result={success:true,delaySummaries:[]};
    else return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({ok:false,success:false,error:'Fixture: no external file lookup'})});
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
   }catch(e){await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({ok:false,error:e.message})});}
 });
 const page=await context.newPage();page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.stack)});
 for(const suffix of ['/complete','']){
  await page.goto('http://localhost:3000/wms/picking/waves/'+target+suffix,{waitUntil:'domcontentloaded',timeout:90000});
  console.log('LOADED',suffix);
  const label=suffix?'전체 발주서 수':'통합 피킹';await page.getByText(label,{exact:true}).first().waitFor({timeout:90000});
  if(suffix){
    await page.locator('summary').filter({hasText:'발주서별 완료상태'}).click();
    assert.match(await page.locator('summary').filter({hasText:'발주서별 완료상태'}).innerText(),/\/10/);
    for(const [name,count] of [['전체 발주서 수',10],['전체 SKU 종류 수',98],['전체 피킹 수량',152]]){
      const text=await page.getByText(name,{exact:true}).locator('..').innerText();assert.match(text,new RegExp('\\b'+count+'\\b'));
    }
  }
  assert.equal(await page.getByText(/141427163|141427351/).count(),0,'completed POs must not be rendered');
  for(const width of [1280,390]){
    await page.setViewportSize({width,height:width===390?844:960});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert(!overflow,'horizontal overflow '+suffix+' '+width);
    await page.screenshot({path:path.join(out,(suffix?'complete':'picking')+'-'+width+'.png'),fullPage:false});screens.push({suffix,width,passed:true});
  }
 }
 // Restore the source only inside the test's in-memory API. Both previously hidden POs return.
 snapshot=structuredClone(original);const source=snapshot.waves.find(w=>w.id==='WAVE-20260908-80615522');
 snapshot.outboundWorkStates[source.id]={status:'active',source:'manual',updatedAt:'2099-01-01T00:00:00Z',history:[]};
 await page.goto('http://localhost:3000/wms/picking/waves/'+target+'/complete',{waitUntil:'domcontentloaded',timeout:90000});
 await page.getByText('전체 발주서 수',{exact:true}).waitFor({timeout:90000});
 assert.match(await page.getByText('전체 발주서 수',{exact:true}).locator('..').innerText(),/\b12\b/);
 assert.equal(snapshot.waves.find(w=>w.id===target).sourcePurchaseOrderNumbers.length,12);
 assert.equal(snapshot.items.filter(i=>i.waveId===target).length,102);
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'target-browser-results.json'),JSON.stringify({passed:true,sourceRevision:original.revision,excluded:view.excludedPurchaseOrderNumbers,active:{po:10,sku:98,quantity:152},screens,restoredOriginal:{po:12,sku:102},mutations,errors,externalWrites:0},null,2));
 console.log('PASS cross-wave browser: live GET fixture, actual target 10PO/98SKU/152; 2 completed POs absent on picking and completion, desktop/mobile, restore12/102, no external writes.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
