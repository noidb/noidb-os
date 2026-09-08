const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),ts=require("typescript"),vm=require("node:vm");
require.extensions[".ts"]=(m,p)=>m._compile(ts.transpileModule(fs.readFileSync(p,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,p);
const {chromium}=require("C:/Users/noidb/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const {emptyPickingWaveStoreSnapshot}=require("../lib/wms/picking-wave/shared-store-types.ts");
const {applyPickingWaveStoreMutation}=require("../lib/wms/picking-wave/server-store.ts");
const rules=require("../lib/wms/weekly-work-state.ts");
let store=emptyPickingWaveStoreSnapshot();
const now="2026-09-08T06:00:00.000Z";
const base={modelName:"팔찌 모델",category:"팔찌",optionLabel:"실버",productName:"테스트 팔찌",imageUrl:"",barcode:"12345678",actualShortageQuantity:2,shortageQuantity:12,currentStock:"",relatedPurchaseOrderNumbers:["10001"],memo:"기존 메모",isManuallyAdded:false,createdAt:now,updatedAt:now};
store.vendorOrderDrafts=[{id:"old::거래처A",waveId:"old",vendorName:"거래처A",status:"approved",createdAt:now,updatedAt:now}];
store.vendorOrderLines=[{...base,id:"old::거래처A::1001",draftId:"old::거래처A",waveId:"old",vendorName:"거래처A",skuId:"1001"}];
const snapshot={rulesVersion:3,id:"WEEKLY-test",sourceToken:"test",createdAt:now,period:{startDate:"2026-09-01",endDate:"2026-09-07"},source:{files:[],latestActualDate:"2026-09-07",firstActualDate:"2026-09-01",eventCount:2,duplicateCount:0,selectedEventCount:2,mode:"upload"},couponItems:[],warnings:[],blockers:[],vendorItems:["1001","1002"].map(skuId=>({skuId,productName:"테스트 팔찌 "+skuId,productLink:"",vendorName:"거래처A",imageUrl:"",optionLabel:"실버",modelName:"M",barcode:"12345678",shortageQuantity:2,openOrderQuantity:0,suggestedQuantity:24,relatedPurchaseOrderNumbers:["10001"],issues:[],discontinued:false}))};
let workspace=rules.emptyWeeklyWorkspace();let run=rules.addWeeklyRun(workspace,snapshot);
function loadService(){const m={exports:{}};const deps={"./vendor-order/aggregate":require("../lib/wms/vendor-order/aggregate.ts"),"node:crypto":require("node:crypto"),"./weekly-work-store":{mutateWeeklyWorkspace:async fn=>{const answer=fn(workspace);workspace.revision++;return structuredClone(answer);}},"./weekly-work-state":rules,"./picking-wave/server-store":{mutatePickingWaveStore:async mutation=>{store=applyPickingWaveStoreMutation(store,mutation);return store;}}};vm.runInNewContext(ts.transpileModule(fs.readFileSync("lib/wms/weekly-vendor-queue.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,require:n=>{assert(deps[n],n);return deps[n]},Date,Error,Set});return m.exports;}
const service=loadService(),images=new Map(),errors=[],unexpected=[];
(async()=>{fs.mkdirSync("outputs/vendor-queue-20260908",{recursive:true});
 const browser=await chromium.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
 try{
 const context=await browser.newContext({viewport:{width:1280,height:960},acceptDownloads:true});
 await context.addInitScript(()=>{Object.defineProperty(navigator,"canShare",{value:()=>false,configurable:true});});
 const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));page.on("dialog",d=>d.accept());
 await context.route("**/api/**",async route=>{
  const req=route.request(),url=new URL(req.url()),method=req.method();let data=req.postDataJSON?.();let result;
  try{
  if(url.pathname==="/api/wms/weekly-work")result={success:true,...workspace};
  else if(url.pathname==="/api/wms/vendor-orders/queue"){
   if(method==="GET")result={success:true,queueId:store.activeVendorQueueId||null,consumedLineIds:Object.keys(store.vendorQueueConsumedLineIds||{})};
   else if(data.action==="saveLineImage"){assert(!data.line,"clipboard must patch image only");store=applyPickingWaveStoreMutation(store,{...data,action:"saveVendorLineImage",now});result={success:true,line:store.vendorOrderLines.find(line=>line.id===data.lineId)};}
   else if(data.runId)result={success:true,...await service.transferWeeklyVendorQueue(data.runId,data.expectedRevision)};
   else {store=applyPickingWaveStoreMutation(store,{action:"consolidateVendorOrders",operationId:"manual-"+Date.now(),lines:[],now});result={success:true,receipt:store.vendorQueueReceipts[Object.keys(store.vendorQueueReceipts).at(-1)]};}
  } else if(url.pathname==="/api/wms/picking-waves"){if(method==="POST")store=applyPickingWaveStoreMutation(store,data);result={ok:true,snapshot:store};}
  else if(url.pathname==="/api/wms/vendor-orders/completion")result={success:true,excludedLineIds:[],partialCompletions:[]};
  else if(url.pathname==="/api/wms/product-catalog")result={success:true,configured:true,items:[]};
  else if(url.pathname==="/api/wms/vendor-order-actions")result={success:true,delaySummaries:[]};
  else if(url.pathname==="/api/wms/weekly-work/image"){
   if(method==="POST"){const id="a".repeat(64);images.set(id,data.dataUrl);result={success:true,imageUrl:"/api/wms/weekly-work/image?id="+id};}
   else {const value=images.get(url.searchParams.get("id"));return route.fulfill({status:value?200:404,contentType:"image/jpeg",body:value?Buffer.from(value.split(",")[1],"base64"):Buffer.alloc(0)});}
  }else if(url.pathname==="/api/wms/product-catalog/update")result={success:true};
  else {unexpected.push(method+" "+url.pathname);result={success:true,ok:true,items:[],records:[],connected:false};}
  await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(result)});
  }catch(e){await route.fulfill({status:409,contentType:"application/json",body:JSON.stringify({success:false,error:e.message})});}
 });
 await page.goto("http://localhost:3000/wms/inbound",{waitUntil:"domcontentloaded",timeout:90000});
 const transferButton=page.getByRole("button",{name:"거래처 발주대기로 이동 →",exact:true});
 await transferButton.waitFor({timeout:90000});
 assert(await transferButton.isEnabled(),"missing images must not block transfer");
 const positions=await page.evaluate(()=>({review:document.querySelector('[aria-labelledby="weekly-review-title"]').getBoundingClientRect().bottom,button:[...document.querySelectorAll("button")].find(b=>b.textContent.includes("거래처 발주대기로 이동")).getBoundingClientRect().top}));
 assert(positions.button>positions.review,"shortcut after product list");
 await transferButton.click();await page.waitForURL("**/wms/vendor-orders/manage",{timeout:90000});
 await page.locator('[data-vendor-sku="1002"]').waitFor({timeout:90000});
 assert.equal(await page.locator('[data-vendor-sku="1001"]').count(),1);
 assert.equal(store.vendorOrderLines.find(l=>l.skuId==="1001").shortageQuantity,12);
 assert.equal(store.vendorOrderLines.filter(l=>l.skuId==="1002").length,1);
 assert.equal(store.vendorOrderLines.find(l=>l.skuId==="1002").shortageQuantity,12);
 assert.equal(store.vendorOrderLines.find(l=>l.skuId==="1002").actualShortageQuantity,2);
 assert.equal(await page.getByText("현재고 0~1개 추가발주 추천",{exact:true}).count(),0);
 // Another device changes the stored row after this editor loaded it.
 store.vendorOrderLines=store.vendorOrderLines.map(line=>line.skuId==="1002"?{...line,shortageQuantity:36,actualShortageQuantity:5,memo:"다른 기기의 최신 메모",updatedAt:"2026-09-08T06:01:00.000Z"}:line);
 await page.locator('[data-vendor-sku="1002"]').evaluate(el=>{
  const canvas=document.createElement("canvas");canvas.width=400;canvas.height=400;const ctx=canvas.getContext("2d");ctx.fillStyle="#f2ebe0";ctx.fillRect(0,0,400,400);ctx.strokeStyle="#788d79";ctx.lineWidth=30;ctx.beginPath();ctx.arc(200,200,110,0,Math.PI*2);ctx.stroke();
  const bin=atob(canvas.toDataURL("image/png").split(",")[1]);const bytes=Uint8Array.from(bin,c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],"fixture.png",{type:"image/png"}));el.dispatchEvent(new ClipboardEvent("paste",{clipboardData:dt,bubbles:true,cancelable:true}));
 });
 await page.waitForFunction(()=>document.querySelector('[data-vendor-sku="1002"] img')?.getAttribute("src")?.includes("weekly-work/image"),null,{timeout:30000});
 assert(store.vendorOrderLines.find(l=>l.skuId==="1002").imageUrl.includes("weekly-work/image"));
 assert.equal(store.vendorOrderLines.find(l=>l.skuId==="1002").shortageQuantity,36);
 assert.equal(store.vendorOrderLines.find(l=>l.skuId==="1002").actualShortageQuantity,5);
 assert.equal(store.vendorOrderLines.find(l=>l.skuId==="1002").memo,"다른 기기의 최신 메모");
 assert.equal(await page.locator('[data-vendor-sku="1002"]').getByRole("spinbutton").inputValue(),"36");
 await page.locator('[data-vendor-sku="1002"]').evaluate(el=>el.dataset.refreshMarker="kept");
 await page.evaluate(()=>window.dispatchEvent(new Event("focus")));await page.waitForTimeout(500);
 assert.equal(await page.locator('[data-vendor-sku="1002"]').getAttribute("data-refresh-marker"),"kept","background refresh must not remount the active editor");
 await page.reload({waitUntil:"domcontentloaded"});
 await page.waitForFunction(()=>document.querySelector('[data-vendor-sku="1002"] img')?.complete,null,{timeout:30000});
 await page.screenshot({path:"outputs/vendor-queue-20260908/queue-desktop.png",fullPage:true});
 await page.getByRole("button",{name:"승인",exact:true}).first().click();
 await page.getByRole("button",{name:/카카오톡으로 공유/}).first().waitFor({timeout:30000}).catch(async error=>{console.error("Approval diagnostics",await page.locator("body").innerText());throw error;});
 const downloadPromise=page.waitForEvent("download",{timeout:30000});
 await page.getByRole("button",{name:/카카오톡으로 공유/}).first().click();
 const download=await downloadPromise;await download.saveAs("outputs/vendor-queue-20260908/vendor-order.png");
 assert(fs.statSync("outputs/vendor-queue-20260908/vendor-order.png").size>5000);
 assert(!store.vendorOrderDrafts.some(d=>d.status==="sent"),"sharing never marks sent");
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:"outputs/vendor-queue-20260908/queue-mobile.png",fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
 assert(!overflow,"mobile horizontal overflow");
 assert.equal(errors.length,0,errors.join("\n"));
 fs.writeFileSync("outputs/vendor-queue-20260908/browser-results.json",JSON.stringify({passed:true,checks:["weekly shortcut below list","missing photos allowed before transfer","same manage route","exact SKU dedupe; existing quantity retained","clipboard photo autosaved","photo patch preserves other-device quantity and memo","photo survives reload","approve and PNG export","share does not mark sent","390px no overflow"],errors,unexpected},null,2));
 console.log("PASS browser: shortcut, transfer/dedupe, paste+save+reload, approval and actual PNG, no automatic sent, mobile layout.",JSON.stringify({errors,unexpected}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
