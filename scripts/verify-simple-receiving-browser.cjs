// Actual page, isolated business API fixtures: never forwards API writes.
const assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.NOIDB_TEST_DEPENDENCIES||process.cwd()]}));
const base=process.env.NOIDB_TEST_URL||'http://127.0.0.1:3116';
const now='2026-09-06T00:00:00Z',waveId='RECEIVING-FIXTURE',draftId=waveId+'::검증거래처';
const original={id:draftId+'::80000001',draftId,waveId,vendorName:'검증거래처',skuId:'80000001',modelName:'MODEL1',category:'반지',optionLabel:'실버, 20호',productName:'검증반지, 실버, 20호',imageUrl:'',barcode:'R100001',actualShortageQuantity:3,shortageQuantity:17,currentStock:'9',relatedPurchaseOrderNumbers:['140000001'],memo:'원본 메모',isManuallyAdded:true,receivedQuantity:1,createdAt:now,updatedAt:now};
const initial={schemaVersion:1,revision:1,updatedAt:now,waves:[{id:waveId,displayName:'간단 입고 검증',status:'order_confirmed',sourcePurchaseOrderNumbers:['140000001'],completedGroupIds:[],createdAt:now,updatedAt:now}],items:[],baskets:[],poConfirmationRecords:[],vendorOrderDrafts:[{id:draftId,waveId,vendorName:'검증거래처',status:'sent',createdAt:now,updatedAt:now,sentAt:now}],vendorOrderLines:[original],shipments:[],warehouseZones:[],warehouseShelves:[],warehouseBoxes:[],warehouseModelLocations:[],warehouseSkuExceptions:[],warehouseMigrationMappings:[],deletedWaveIds:{},deletedItemIds:{},deletedBasketKeys:{},deletedPoConfirmationNumbers:{},deletedVendorDraftIds:{},deletedVendorLineIds:{},deletedWarehouseSkuIds:{},deletedShipmentIds:{},completedCreateOperations:{},completedShipmentCreateOperations:{},outboundWorkStates:{}};
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});const results=[],errors=[],unexpected=[];await fs.mkdir('tmp/wms-simple-browser',{recursive:true});
 try{for(const width of [360,390,412,430,1920]){
  const context=await browser.newContext({viewport:{width,height:width<500?844:1080},serviceWorkers:'block'});const snapshot=structuredClone(initial);let saves=0,costWrites=0,costPreviews=0;
  await context.addInitScript(()=>{localStorage.setItem('noidb_picking_wave_shared_migration_v1','fixture');localStorage.setItem('noidb_vendor_order_shared_migration_v1','fixture');});
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());if(url.origin!==new URL(base).origin)return route.abort();
   if(!url.pathname.startsWith('/api/')){if(req.method()==='GET')return route.continue();unexpected.push(req.method()+' '+url.pathname);return route.abort();}
   if(url.pathname==='/api/wms/simple-receiving'){
    if(req.method()==='GET')return route.fulfill({json:{success:true,line:snapshot.vendorOrderLines[0]}});
    const b=req.postDataJSON();assert.equal(b.lineId,original.id);
    if(b.action==='preview')return route.fulfill({json:{success:true,preview:{token:'receipt-token',skuId:original.skuId,beforeQuantity:snapshot.vendorOrderLines[0].receivedQuantity,quantity:b.quantity,beforeUnitPrice:0,unitPrice:b.unitPrice,vat:10,costVatIncluded:110}}});
    if(b.action==='save'){assert.equal(b.confirmed,true);assert.equal(b.token,'receipt-token');saves++;snapshot.vendorOrderLines[0]={...original,receivedQuantity:b.quantity,receivedUnitPrice:b.unitPrice,receivedVat:10,receivedCostVatIncluded:110,receivedUsedImmediatelyAt:b.usedImmediately?now:undefined,receivingHistory:[{savedAt:now,record:original}]};return route.fulfill({json:{success:true,line:snapshot.vendorOrderLines[0]}});}
    if(b.action==='cost-preview'){costPreviews++;return route.fulfill({json:{success:true,preview:{token:'cost-token',skuId:original.skuId,before:'90',after:110,quantity:4,unitPrice:100,vat:10,alreadyApplied:costWrites>0}}});}
    if(b.action==='cost-apply'){assert.equal(b.confirmed,true);assert.equal(b.token,'cost-token');costWrites++;return route.fulfill({json:{success:true,applied:true}});}
   }
   if(req.method()==='GET'&&url.pathname==='/api/wms/picking-waves')return route.fulfill({json:{ok:true,snapshot}});
   if(req.method()==='GET'&&url.pathname==='/api/auth/noidb-action-session')return route.fulfill({json:{authenticated:true,configured:true}});
   if(req.method()==='GET'&&url.pathname==='/api/wms/vendor-order-actions')return route.fulfill({json:{success:true,delaySummaries:[]}});
   if(req.method()==='GET')return route.fulfill({json:{configured:true,items:[],orders:[],data:[],records:[]}});
   unexpected.push(req.method()+' '+url.pathname);return route.fulfill({status:400,json:{error:'Unexpected fixture write'}});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+`/wms/picking/waves/${waveId}/vendor-orders`);
  await page.getByRole('button',{name:'간단 입고',exact:true}).click();await page.getByLabel('누적 받은 수량',{exact:true}).fill('4');await page.getByLabel('입고단가 부가세 별도',{exact:true}).fill('100');await page.getByLabel('즉시투입 완료').check();
  assert.equal(saves,0);await page.getByRole('button',{name:'입고 변경 확인',exact:true}).click();await page.getByRole('region',{name:'입고 변경 미리보기'}).waitFor();assert.equal(saves,0);
  await page.getByRole('region',{name:'입고 변경 미리보기'}).getByRole('button',{name:'취소',exact:true}).click();assert.equal(saves,0);
  await page.getByRole('button',{name:'입고 변경 확인',exact:true}).click();await page.getByRole('button',{name:'확인 · 입고기록 저장',exact:true}).click();await page.getByText('입고기록 저장완료 · 제품DB 원가는 아래에서 별도로 확인합니다.',{exact:true}).waitFor();assert.equal(saves,1);assert.equal(costWrites,0);
  await page.getByRole('button',{name:'제품DB 원가 확인',exact:true}).click();await page.getByText('SKU 80000001 원가 90 → 110원',{exact:true}).waitFor();assert.equal(costWrites,0);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),`Overflow at ${width}`);
  if([390,1920].includes(width))await page.screenshot({path:`tmp/wms-simple-browser/${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'확인 · 백업 후 원가 반영',exact:true}).click();await page.getByText('백업 후 제품DB 원가 반영완료',{exact:true}).waitFor();assert.equal(costWrites,1);
  await page.getByRole('button',{name:'제품DB 원가 확인',exact:true}).click();await page.getByText('이미 반영된 입고원가입니다.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'확인 · 백업 후 원가 반영',exact:true}).count(),0);
  assert.equal(snapshot.vendorOrderLines[0].currentStock,'9');assert.equal(snapshot.vendorOrderLines[0].shortageQuantity,17);results.push({width,saves,costWrites,costPreviews});await context.close();
 }}finally{await browser.close();}
 assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);await fs.writeFile('tmp/wms-simple-browser/result.json',JSON.stringify({base,results,errors,unexpected},null,2));console.log(JSON.stringify({pass:true,results}));
})().catch(e=>{console.error(e);process.exitCode=1;});
