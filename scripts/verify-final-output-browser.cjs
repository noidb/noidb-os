const assert=require('node:assert/strict');const fs=require('node:fs/promises');const JSZip=require('jszip');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.NOIDB_TEST_DEPENDENCIES||process.cwd()]}));
const base=process.env.NOIDB_TEST_URL||'http://127.0.0.1:3116';
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const context=await browser.newContext({acceptDownloads:true});const errors=[];let generated=0,fail=false;
  const couponName='쿠폰발행리스트_입고일_20260906_02.xlsx',missingName='미입고_SKU리스트_입고일_20260906_02.xlsx';
  const bundle=new JSZip();bundle.file(couponName,'coupon fixture');bundle.file(missingName,'missing fixture');const zip=await bundle.generateAsync({type:'nodebuffer'});
  await context.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url());
   if(url.pathname==='/api/wms/output-history'){
    assert.equal(req.method(),'GET');assert.equal(url.searchParams.get('category'),'coupon');
    return route.fulfill({json:{success:true,items:Array.from({length:55},(_,i)=>({id:String(i),name:`쿠폰발행리스트_긴파일명_입고일_20260906_${i}.xlsx`,category:'coupon',categoryLabel:'쿠폰·미입고',modifiedAt:'2026-09-06T00:00:00Z',url:'https://drive.google.com/file/d/fixture/view'})),warnings:[]}});
   }
   if(url.pathname==='/api/wms/inbound-results'){
    if(req.method()==='GET')return route.fulfill({json:{success:true,results:[{actualDate:'2026-09-06',purchaseOrderCount:1,receivedSkuCount:1,partialSkuCount:1,missingSkuCount:1,couponItems:[{skuId:'1',productName:'반지, 17호',productLink:''}],missingItems:[{skuId:'1',productName:'반지, 17호',productLink:''}],nameConflicts:[]}]}});
    generated++;assert.deepEqual(req.postDataJSON(),{actualDate:'2026-09-06',discountRate:30});
    if(fail)return route.fulfill({status:400,json:{error:'파일 생성 확인이 필요합니다.'}});
    return route.fulfill({body:zip,headers:{'Content-Type':'application/zip','X-NOIDB-Coupon-File-Name':encodeURIComponent(couponName),'X-NOIDB-Missing-File-Name':encodeURIComponent(missingName),'X-NOIDB-File-Name':encodeURIComponent('입고결과.zip'),'X-NOIDB-Coupon-Count':'1','X-NOIDB-Missing-Count':'1','X-NOIDB-Drive-Saved':'true'}});
   }
   assert.equal(req.method(),'GET','no other write');return route.fulfill({json:{success:true,items:[],results:[],configured:false}});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await fs.mkdir('tmp/wms-final-browser',{recursive:true});
  for(const width of [360,390,412,430,1920]){
   await page.setViewportSize({width,height:width<500?844:1080});await page.goto(base+'/wms/output-history?category=coupon');
   await page.getByText('55개 파일',{exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'파일 열기·다운로드'}).count(),50);
   await page.getByRole('button',{name:'50개 더 보기'}).click();assert.equal(await page.getByRole('link',{name:'파일 열기·다운로드'}).count(),55);
   await page.getByRole('textbox',{name:'파일명 검색'}).fill('_54.xlsx');await page.getByText('1개 파일',{exact:true}).waitFor();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`tmp/wms-final-browser/history-${width}.png`,fullPage:true});
  }
  await page.setViewportSize({width:390,height:844});await page.goto(base+'/wms/inbound');
  await page.getByRole('button',{name:'쿠폰·미입고 파일 생성',exact:true}).waitFor();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'쿠폰·미입고 파일 생성',exact:true}).click();await download;
  const coupon=page.getByRole('link',{name:'쿠폰파일 다운로드',exact:true});await coupon.waitFor();
  assert.equal(await coupon.getAttribute('download'),couponName);assert.equal(await page.getByRole('link',{name:'미입고파일 다운로드',exact:true}).getAttribute('download'),missingName);
  const single=page.waitForEvent('download');await coupon.click();assert.equal((await single).suggestedFilename(),couponName);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:'tmp/wms-final-browser/coupon-390.png',fullPage:true});
  fail=true;await page.getByRole('button',{name:'쿠폰·미입고 파일 생성',exact:true}).click();await page.getByText('파일 생성 확인이 필요합니다.',{exact:true}).waitFor();assert.equal(await coupon.count(),0,'failed regeneration must clear old links');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,widths:[360,390,412,430,1920],historyPagination:true,historySearch:true,couponIndividualDownload:true,failedRegenerationClearsLinks:true,mockedGenerations:generated,operatingWrites:0}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
