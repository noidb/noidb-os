const assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.NOIDB_TEST_DEPENDENCIES||process.cwd()]}));
const base=process.env.NOIDB_TEST_URL||'http://127.0.0.1:3116';
const waveId = "WAVE-FIXTURE-NAVIGATION";
const root = `/wms/picking/waves/${waveId}`;
const now = "2026-09-05T01:00:00.000Z";
const poNumbers = ["140000001", "140000002", "140000003", "140000004", "140000005", "140000006"];
const generations = [1, 2, 3].map((number, index) => ({
  generationId: `GEN-FIXTURE-${number}`, waveId, purchaseOrderNumbers: poNumbers.slice(index * 2, index * 2 + 2),
  createdAt: `2026-09-04T0${number}:00:00.000Z`, updatedAt: `2026-09-04T0${number}:00:00.000Z`, expectedShippingGroupCount: 1,
  invoiceFileName: `fixture-invoice-${number}.xlsx`, shipmentFileName: number > 1 ? `fixture-shipment-${number}.xlsx` : undefined,
  status: number > 1 ? "shipment_generated" : "invoice_generated", fulfillmentCenters: ["동탄1"], expectedDates: ["2026-09-04"],
}));
const wave = { id: waveId, displayName: "격리 검증 출고작업", status: "order_confirmed", sourcePurchaseOrderNumbers: poNumbers,
  completedGroupIds: [], createdAt: now, updatedAt: now, outputGenerations: generations, selectedOutputGenerationId: generations[2].generationId };
const items = poNumbers.map((po, index) => ({
  id: `${waveId}-${index}`, waveId, productCode: String(80000000 + index), productName: `검증 반지 ${index + 1}, 실버, 20호`, barcode: `R10000000000${index}`,
  modelName: `MODEL${index + 1}`, modelSku: `MODEL${index + 1}-SI`, optionLabel: "실버, 20호", vendorName: "검증거래처", totalQuantity: 5,
  sources: [{ purchaseOrderNumber: po, basketNumber: String(index + 1), requestedQuantity: 5 }], locationStatus: "unlocated", modelSortKey: "", locationSortKey: "",
  status: "full", pickedQuantity: 5, shortageQuantity: 0, allocations: [{ purchaseOrderNumber: po, basketNumber: String(index + 1), requestedQuantity: 5, fulfilledQuantity: 5, shortageQuantity: 0 }], createdAt: now, updatedAt: now,
}));
const snapshot = { schemaVersion: 1, revision: 1, updatedAt: now, waves: [wave], items,
  baskets: poNumbers.map((po, index) => ({ waveId, basketNumber: String(index + 1), purchaseOrderNumber: po, fulfillmentCenter: "동탄1", status: "full", createdAt: now, updatedAt: now })),
  poConfirmationRecords: [], vendorOrderDrafts: [], vendorOrderLines: [], warehouseZones: [], warehouseShelves: [], warehouseBoxes: [], warehouseModelLocations: [], warehouseSkuExceptions: [], warehouseMigrationMappings: [], shipments: [],
  deletedWaveIds: {}, deletedItemIds: {}, deletedBasketKeys: {}, deletedPoConfirmationNumbers: {}, deletedVendorDraftIds: {}, deletedVendorLineIds: {}, deletedWarehouseSkuIds: {}, deletedShipmentIds: {}, completedCreateOperations: {}, completedShipmentCreateOperations: {}, outboundWorkStates: {},
};
const auto=[poNumbers.slice(0,2),poNumbers.slice(2,4),poNumbers.slice(4)];
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});const results=[],errors=[];await fs.mkdir('tmp/invoice-250-browser',{recursive:true});try{
for(const width of [360,390,412,430,1920]){
 const ctx=await browser.newContext({viewport:{width,height:width<500?844:1080},serviceWorkers:'block'});const state=structuredClone(snapshot);const writes=[],tracking=[];let invoiceRequest;
 await ctx.addInitScript(()=>{localStorage.setItem('noidb_picking_wave_shared_migration_v1','fixture');localStorage.setItem('noidb_vendor_order_shared_migration_v1','fixture');});
 await ctx.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==new URL(base).origin)return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue();
 const body=req.method()==='POST'?req.postDataJSON():{};
 if(url.pathname==='/api/wms/picking-waves'){
  if(req.method()==='POST'){assert.equal(body.action,'saveWave');writes.push(body);state.waves[0]=body.wave;}
  return route.fulfill({json:{ok:true,snapshot:state}});
 }
 if(url.pathname==='/api/wms/hanjin-upload/preview'){const groups=body.invoiceGroups||auto;return route.fulfill({json:{preview:{canGenerate:true,fulfillmentCenterCount:1,shippingGroupCount:groups.length,blockingReasons:[],shippingGroups:groups.map(g=>({fulfillmentCenterName:'동탄1',expectedArrivalDate:'2026-09-04',purchaseOrderNumbers:g,totalQuantity:g.length*5}))}}});}
 if(url.pathname==='/api/wms/hanjin-upload/generate'){invoiceRequest=body;return route.fulfill({body:'fixture invoice',headers:{'Content-Disposition':"attachment; filename*=UTF-8''invoice-fixture.xlsx",'X-Added-Po-Numbers':encodeURIComponent(poNumbers.join(','))}});}
 if(url.pathname==='/api/wms/hanjin-upload/shipment-preview'){tracking.push(body);return route.fulfill({json:{preview:{canGenerate:true,matchedPurchaseOrderCount:body.purchaseOrderNumbers.length,missingPurchaseOrderNumbers:[],conflictPurchaseOrderNumbers:[],selectedReprintFileName:'fixture.xlsx',candidateFiles:[{fileName:'fixture.xlsx',exactMatch:true}]}}});}
 if(url.pathname==='/api/wms/po-confirm/file-link')return route.fulfill({json:{groups:[]}});
 if(url.pathname==='/api/wms/po-confirm/inspect-source')return route.fulfill({json:{folderAccessible:true,source:null,error:'Isolated fixture'}});
 if(req.method()!=='GET'){errors.push(req.method()+' '+url.pathname);return route.fulfill({status:400,json:{error:'Unexpected write'}});}
 return route.fulfill({json:{configured:true,items:[],orders:[],records:[],results:[],data:[]}});
 });
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(base+root+'/complete?generation='+generations[0].generationId);
 await page.getByText('자동 송장 묶음 3개 · 발주서 단위 최대 250개 · 직접 변경 가능',{exact:true}).click();
 assert.equal(await page.getByText('최근 출력 묶음',{exact:true}).count(),0);
 const label='발주 '+poNumbers[0]+' 송장 묶음';await page.getByLabel(label,{exact:true}).selectOption('1');
 await page.waitForResponse(r=>r.url().endsWith('/api/wms/hanjin-upload/preview')&&r.request().postDataJSON().invoiceGroups?.[1]?.includes(poNumbers[0]));
 assert.equal(writes.length,0);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 if([390,1920].includes(width))await page.screenshot({path:`tmp/invoice-250-browser/${width}.png`,fullPage:true});
 await page.getByRole('button',{name:'선택 발주 송장파일 생성',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#hanjin-step-3')?.textContent.includes('발주 6건'));
 assert.equal(writes.length,1);const saved=state.waves[0].outputGenerations.find(g=>g.generationId===state.waves[0].selectedOutputGenerationId);
 assert.deepEqual(invoiceRequest.invoiceGroups,[[poNumbers[1]],[poNumbers[2],poNumbers[3],poNumbers[0]],poNumbers.slice(4)]);
 assert.deepEqual(saved.invoiceGroups,invoiceRequest.invoiceGroups);assert.deepEqual(saved.purchaseOrderNumbers,poNumbers);assert.equal(saved.status,'invoice_generated');assert.equal(saved.shipmentFileName,undefined);
 assert(state.waves[0].outputGenerations.slice(0,3).every(g=>g.supersededByGenerationId===saved.generationId));assert.equal(state.waves[0].outputGenerations[1].shipmentFileName,generations[1].shipmentFileName);
 await page.waitForFunction(()=>[...document.querySelectorAll('#hanjin-step-3 button')].some(b=>b.textContent==='Shipment 파일 생성'&&!b.disabled));
 assert(tracking.some(t=>t.purchaseOrderNumbers.length===6&&JSON.stringify(t.invoiceGroups)===JSON.stringify(saved.invoiceGroups)));
 assert.equal(new URL(page.url()).searchParams.get('generation'),saved.generationId);
 if(width===390){await page.reload();await page.waitForFunction(()=>document.querySelector('#hanjin-step-3')?.textContent.includes('발주 6건'));assert.equal(writes.length,1);await page.getByText('자동 송장 묶음 3개 · 발주서 단위 최대 250개 · 직접 변경 가능',{exact:true}).click();assert.equal(await page.getByLabel(label,{exact:true}).inputValue(),'1');await page.screenshot({path:'tmp/invoice-250-browser/390-after-generate.png',fullPage:true});}
 results.push({width,invoiceGroups:saved.invoiceGroups.length,savedOnce:writes.length===1,oldRecordsPreserved:true});await ctx.close();
}
}finally{await browser.close();}assert.deepEqual(errors,[]);await fs.writeFile('tmp/invoice-250-browser/results.json',JSON.stringify({base,results},null,2));console.log(JSON.stringify({pass:true,results}));})().catch(e=>{console.error(e);process.exitCode=1});
