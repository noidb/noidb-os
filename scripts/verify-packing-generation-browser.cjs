const assert=require('node:assert/strict'), fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.NOIDB_TEST_DEPENDENCIES||process.cwd()]}));
const {PDFDocument,StandardFonts}=require('pdf-lib');const ExcelJS=require('exceljs');
const base=process.env.NOIDB_TEST_URL||'http://127.0.0.1:3116';const origin=new URL(base).origin;
const out=process.env.NOIDB_BROWSER_OUTPUT||'tmp/packing-generation-browser';
const waveId='WAVE-PACKING-FIXTURE',pos=['140000001','140000002'];
const now='2026-09-06T01:00:00Z';
const wave={id:waveId,displayName:'포장 흐름 검증',status:'order_confirmed',sourcePurchaseOrderNumbers:pos,completedGroupIds:[],createdAt:now,updatedAt:now,outputGenerations:[{generationId:'GEN1',waveId,purchaseOrderNumbers:pos,status:'shipment_generated',shipmentFileName:'fixture.xlsx',invoiceFileName:'invoice.xlsx',outputSetFileName:'fixture.zip',outputSetGeneratedAt:now,createdAt:now,updatedAt:now,expectedShippingGroupCount:2}]};
const item=(sku,sources)=>({id:waveId+'-'+sku,waveId,productCode:sku,productName:'상품 '+sku,barcode:'R'+sku,modelName:'MODEL'+sku,totalQuantity:sources.reduce((n,s)=>n+s.requestedQuantity,0),pickedQuantity:sources.reduce((n,s)=>n+s.requestedQuantity,0),status:'full',sources,allocations:sources.map(s=>({...s,fulfilledQuantity:s.requestedQuantity,shortageQuantity:0})),createdAt:now,updatedAt:now});
const source=(i,q)=>({purchaseOrderNumber:pos[i],basketNumber:String(i),requestedQuantity:q,shippingGroupKey:'2026-09-04\0'+['Daegu3','Dongtan1'][i]});
const items=[item('12345678',[source(0,1),source(1,2)]),item('87654321',[source(0,1)])];
const catalog=items.map(i=>({skuId:i.productCode,modelSku:'MODEL'+i.productCode,modelName:'MODEL'+i.productCode,productName:i.productName,countryOfOrigin:'China',productLink:'https://example.com/product/'+i.productCode,imageUrl:'https://example.com/image.svg',optionLabel:'Silver'}));
const fixture={schemaVersion:1,revision:1,updatedAt:now,waves:[wave],items,baskets:pos.map((po,i)=>({waveId,basketNumber:String(i),purchaseOrderNumber:po,fulfillmentCenter:['Daegu3','Dongtan1'][i]})),poConfirmationRecords:[],vendorOrderDrafts:[],vendorOrderLines:[],shipments:[],outboundWorkStates:{}};
async function pdf(i,manifest) {
 const document=await PDFDocument.create(),page=document.addPage([595,842]),font=await document.embedFont(StandardFonts.Helvetica);
 const write=(text,x,y)=>page.drawText(text,{x,y,size:10,font});
 write(['Daegu3','Dongtan1'][i],20,805);write('5000000'+i,220,775);write('PBL1234567',220,750);write('46319675515'+i,220,730);write('2026-09-04',220,710);write(pos[i],220,690);
 if(manifest){const entries=i===0?[['87654321',1],['12345678',1]]:[['12345678',2]];entries.forEach(([sku,q],j)=>{write('R'+sku,20,630-j*35);write(sku,140,630-j*35);write(String(q),410,630-j*35);});}
 return {name:`shipment_${manifest?'ManiFest':'Label'}_document(5000000${i}).pdf`,base64:Buffer.from(await document.save()).toString('base64')};
}

async function main(){
 await fs.mkdir(out,{recursive:true});
 const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Data');
 sheet.addRow(['발주번호','출력수량','SKU ID','센터','입고예정일','바코드','상품명','옵션명','송장번호(Invoice Number)']);
 for(const [i,sku,q] of [[0,'12345678',1],[0,'87654321',1],[1,'12345678',2]])sheet.addRow([pos[i],q,sku,['Daegu3','Dongtan1'][i],'2026-09-04','R'+sku,'상품 '+sku,'Silver','46319675515'+i]);
 const encoded={labels:await Promise.all([pdf(0,false),pdf(1,false)]),manifests:await Promise.all([pdf(0,true),pdf(1,true)]),workbook:{name:'fixture.xlsx',base64:Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64')}};
 require('./verify-outbound-completion.cjs');
 const {applyPickingWaveStoreMutation}=require('../lib/wms/picking-wave/server-store.ts');
 const {packingGenerationKey}=require('../lib/wms/packing-progress.ts');
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 const results=[];
 try {for(const [width,mode] of [[390,"generation"],[1440,"generation"],[390,"quantity"],[1440,"quantity"]]) {
  let snapshot=structuredClone(fixture),writes=0;
  snapshot.packingProgress={[waveId]:{generationKey:'old-generation',manifestKey:'old-rows',rows:[],checkedKeys:[],dispatchedShipmentNumbers:['50000000','50000001'],dispatchedAt:now,updatedAt:now,shipmentPurchaseOrders:{'50000000':[pos[0]],'50000001':[pos[1]]}}};
  snapshot.outboundWorkStates={[waveId]:{status:'completed',source:'packing',generationKey:'old-generation',updatedAt:now,history:[{status:'completed',changedAt:now,source:'packing',generationKey:'old-generation'}]}};
  if(mode==="quantity"){
   const oldRows=[{key:"A",shipmentNumber:"50000000",purchaseOrderNumber:pos[0],skuId:"87654321",barcode:"R87654321",quantity:9},{key:"B",shipmentNumber:"50000000",purchaseOrderNumber:pos[0],skuId:"12345678",barcode:"R12345678",quantity:1},{key:"C",shipmentNumber:"50000001",purchaseOrderNumber:pos[1],skuId:"12345678",barcode:"R12345678",quantity:2}];
   snapshot.packingProgress[waveId]={...snapshot.packingProgress[waveId],generationKey:packingGenerationKey(wave),rows:oldRows,manifestKey:JSON.stringify(oldRows)};
   snapshot.outboundWorkStates[waveId].generationKey=packingGenerationKey(wave);
  }
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
  await context.addInitScript(()=>{localStorage.setItem('noidb_picking_wave_shared_migration_v1','fixture');localStorage.setItem('noidb_vendor_order_shared_migration_v1','fixture');});
  const errors=[];
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.hostname==='cdn.jsdelivr.net'&&url.pathname.endsWith('pdf.worker.min.mjs'))return route.fulfill({body:await fs.readFile('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs'),contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'}});
   if(url.hostname==='example.com')return route.fulfill({body:'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="20" fill="silver"/></svg>',contentType:'image/svg+xml'});
   if(url.origin!==origin)return route.abort();
   if(!url.pathname.startsWith('/api/'))return request.method()==='GET'?route.continue():route.abort();
   if(request.method()==='GET'&&url.pathname==='/api/wms/picking-waves')return route.fulfill({json:{ok:true,snapshot}});
   if(url.pathname==='/api/wms/product-catalog')return route.fulfill({json:{configured:true,items:catalog}});
   if(url.pathname==='/api/wms/shipment-print/auto-source')return route.fulfill({json:encoded});
   if(url.pathname==='/api/wms/supplier-hub-orders')return route.fulfill({json:{configured:true,orders:pos.map((po,i)=>({purchaseOrderNumber:po,expectedDate:'2026-09-04',fulfillmentCenter:['Daegu3','Dongtan1'][i]})),upcomingInboundSummary:[]}});
   if(url.pathname==='/api/wms/packing-progress'){
    const body=request.postDataJSON();writes++;
    snapshot=applyPickingWaveStoreMutation(snapshot,{action:'savePackingProgress',...body,now:'2026-09-08T06:00:'+String(writes).padStart(2,'0')+'Z'});
    return route.fulfill({json:{progress:snapshot.packingProgress[waveId]}});
   }
   assert.equal(request.method(),'GET','Unexpected write '+url.pathname);
   return route.fulfill({json:{configured:false,items:[],orders:[],records:[],drafts:[],results:[],data:[]}});
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  const url=base+'/wms/picking/waves/'+waveId+'/packing?generation=GEN1';
  await page.goto(url);
  await page.getByText(mode==="generation"?'Shipment 2개 · 출고완료 0개 · 미출고 2개':'Shipment 2개 · 출고완료 1개 · 미출고 1개',{exact:true}).waitFor();
  if(mode==="generation")await page.getByText(/Shipment 자료가 변경되어 이전 자료의 출고완료/).waitFor();
  assert.equal(writes,0);
  assert.equal(await page.locator('[data-packing-sku]').count(),2);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(out,mode+'-'+width+'.png'),fullPage:true});
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'이 Shipment 출고완료',exact:true}).click();
  if(mode==="generation"){
   await page.getByText('Shipment 2개 · 출고완료 1개 · 미출고 1개',{exact:true}).waitFor();
   assert.deepEqual(snapshot.packingProgress[waveId].dispatchedShipmentNumbers,['50000000']);
   assert.equal(snapshot.outboundWorkStates[waveId].status,'active');
   page.once('dialog',dialog=>dialog.accept());
   await page.getByRole('button',{name:'이 Shipment 출고완료',exact:true}).click();
  }
  await page.waitForURL('**/packing');
  assert.deepEqual([...snapshot.packingProgress[waveId].dispatchedShipmentNumbers].sort(),['50000000','50000001']);
  assert.equal(snapshot.outboundWorkStates[waveId].status,'completed');
  assert.equal(snapshot.outboundWorkStates[waveId].source,'packing');
  assert.equal(snapshot.outboundWorkStates[waveId].generationKey,packingGenerationKey(wave));
  assert.deepEqual(errors,[]);assert.deepEqual(snapshot.items,fixture.items);
  results.push({width,mode,oldCompletionVisibleAsPending:true,currentDispatchesOnly:true,sourceItemsPreserved:true,writes});
  await context.close();
 }}finally{await browser.close();}
 console.log(JSON.stringify({passed:true,operatingWrites:0,results}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
