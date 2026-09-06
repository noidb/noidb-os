const assert=require('node:assert/strict'), fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.NOIDB_TEST_DEPENDENCIES||process.cwd()]}));
const {PDFDocument,StandardFonts}=require('pdf-lib');const ExcelJS=require('exceljs');
const base=process.env.NOIDB_TEST_URL||'http://127.0.0.1:3116';const origin=new URL(base).origin;
const out=process.env.NOIDB_BROWSER_OUTPUT||'tmp/packing-browser';
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
 await fs.mkdir(out,{recursive:true});const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Data');
 sheet.addRow(['발주번호','출력수량','SKU ID','센터','입고예정일','바코드','상품명','옵션명','송장번호(Invoice Number)']);
 for(const [i,sku,q] of [[0,'12345678',1],[0,'87654321',1],[1,'12345678',2]])sheet.addRow([pos[i],q,sku,['Daegu3','Dongtan1'][i],'2026-09-04','R'+sku,'상품 '+sku,'Silver','46319675515'+i]);
 const encoded={labels:await Promise.all([pdf(0,false),pdf(1,false)]),manifests:await Promise.all([pdf(0,true),pdf(1,true)]),workbook:{name:'fixture.xlsx',base64:Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64')}};
 const browser=await chromium.launch({headless:true,channel:'chrome'});const results=[];
 try{for(const width of [390,1920]){
  const snapshot=structuredClone(fixture);let saves=0;const forbidden=[],errors=[];
  const context=await browser.newContext({viewport:{width,height:900},acceptDownloads:true,serviceWorkers:'block'});
  await context.addInitScript(()=>{localStorage.setItem('noidb_picking_wave_shared_migration_v1','fixture');localStorage.setItem('noidb_vendor_order_shared_migration_v1','fixture');});
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
    const b=request.postDataJSON();assert.equal(b.waveId,waveId);assert.equal(b.expectedUpdatedAt,snapshot.packingProgress?.[waveId]?.updatedAt||null);
    const p={generationKey:b.generationKey,manifestKey:JSON.stringify(b.rows),rows:b.rows,checkedKeys:b.checkedKeys,updatedAt:'2026-09-06T02:00:'+String(++saves).padStart(2,'0')+'Z',...(b.dispatched?{dispatchedAt:now}:{})};snapshot.packingProgress={[waveId]:p};
    if(b.dispatched){assert.equal(b.confirmed,true);assert.equal(b.checkedKeys.length,3);snapshot.outboundWorkStates[waveId]={status:'completed'};}
    return route.fulfill({json:{progress:p}});
   }
   if(request.method()!=='GET'){forbidden.push(url.pathname);return route.fulfill({status:400,json:{error:'Unexpected write'}});}
   return route.fulfill({json:{configured:false,items:[],orders:[],records:[],drafts:[],results:[],data:[]}});
  });
  const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+`/wms/picking/waves/${waveId}/packing`);
  await page.getByRole('checkbox',{name:'87654321 포장 확인'}).waitFor();
  assert.deepEqual(await page.locator('[data-packing-sku]').evaluateAll(els=>els.map(e=>e.dataset.packingSku)),['87654321','12345678']);
  assert.equal(await page.getByRole('button',{name:'택배 인계 후 · 출고완료'}).isDisabled(),true);
  assert.equal(saves,0);assert.equal(await page.locator('[data-packing-sku="12345678"] img').count(),1);
  assert.equal(await page.locator('[data-packing-sku="12345678"]').getByRole('link',{name:'상품 링크 열기 ↗'}).getAttribute('href'),'https://example.com/product/12345678');
  await page.getByRole('checkbox',{name:'87654321 포장 확인'}).click();await page.getByRole('status').filter({hasText:'검수 기록 저장 완료'}).waitFor();
  await page.reload();await page.getByRole('checkbox',{name:'87654321 포장 확인'}).waitFor();assert.equal(await page.getByRole('checkbox',{name:'87654321 포장 확인'}).isChecked(),true);
  await page.getByRole('checkbox',{name:'12345678 포장 확인'}).click();await page.waitForFunction(()=>document.body.innerText.includes('전체 포장 확인 2/3'));
  await page.getByRole('combobox',{name:'포장할 Shipment'}).selectOption('50000001');
  const article=page.locator('[data-packing-sku="12345678"]');await article.getByText('바코드 분실·손상 → 재발행').click();
  await article.getByRole('spinbutton').fill('1');
  const [download]=await Promise.all([page.waitForEvent('download'),article.getByRole('button',{name:'이 상품 바코드 재발행'}).click()]);
  const file=path.join(out,`reprint-${width}.xlsx`);await download.saveAs(file);const checkBook=new ExcelJS.Workbook();await checkBook.xlsx.readFile(file);const saved=checkBook.worksheets[0].getSheetValues().slice(2).map(r=>r.slice(1));assert.equal(saved.filter(r=>r[7]==='상품').length,1);assert.equal(saved.find(r=>r[7]==='상품')[0],'12345678');
  await page.getByRole('checkbox',{name:'12345678 포장 확인'}).click();await page.waitForFunction(()=>document.body.innerText.includes('전체 포장 확인 3/3'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(out,`packing-${width}.png`),fullPage:true});
  page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'택배 인계 후 · 출고완료'}).click();assert.equal(saves,3);
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'택배 인계 후 · 출고완료'}).click();await page.getByRole('status').filter({hasText:'택배 출고완료로 저장했습니다.'}).waitFor();assert.equal(snapshot.outboundWorkStates[waveId].status,'completed');
  await page.goto(base+`/wms/picking/waves/${waveId}`,{timeout:60000});
  const distribution = page.locator('[data-picking-sku="12345678"]');await distribution.waitFor();
  await distribution.getByText("Daegu3 2026-09-04 1개",{exact:true}).waitFor();await distribution.getByText("Dongtan1 2026-09-04 2개",{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(out,`distribution-${width}.png`)});
  assert.deepEqual(snapshot.items,fixture.items);assert.deepEqual(snapshot.waves,fixture.waves);assert.deepEqual(forbidden,[]);assert.deepEqual(errors,[]);
  results.push({width,manifestOrder:true,sharedChecksReload:true,singleBarcodeReprint:true,dispatchConfirmed:true,operatingWrites:0});await context.close();
 }}finally{await browser.close();}
 console.log(JSON.stringify({passed:true,results}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
