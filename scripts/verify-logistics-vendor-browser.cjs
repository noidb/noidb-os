const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { chromium } = require("C:/Users/noidb/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const { emptyPickingWaveStoreSnapshot } = require("../lib/wms/picking-wave/shared-store-types.ts");
const { applyPickingWaveStoreMutation } = require("../lib/wms/picking-wave/server-store.ts");

const now = "2026-09-20T00:00:00.000Z";
const queueId = "VENDOR-QUEUE-preview";
let store = emptyPickingWaveStoreSnapshot();
store.activeVendorQueueId = queueId;
store.vendorOrderDrafts = [{ id: "preview-draft", waveId: queueId, vendorName: "미리보기 거래처", status: "draft", createdAt: now, updatedAt: now }];
store.vendorOrderLines = [{ id: "preview-line", draftId: "preview-draft", waveId: queueId, vendorName: "미리보기 거래처", skuId: "77990001", modelName: "미리보기", category: "테스트", optionLabel: "기본", productName: "API 차단 검증 상품", imageUrl: "", barcode: "", actualShortageQuantity: 5, shortageQuantity: 12, currentStock: "", relatedPurchaseOrderNumbers: ["88009901"], memo: "", isManuallyAdded: false, createdAt: now, updatedAt: now }];
const clone = () => structuredClone(store);

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  const photo = Buffer.from(await page.evaluate(() => {
    const canvas=document.createElement('canvas'); canvas.width=360; canvas.height=360;
    const ctx=canvas.getContext('2d'); ctx.fillStyle='#eef3ef'; ctx.fillRect(0,0,360,360);
    ctx.fillStyle='#6f887c'; ctx.beginPath(); ctx.arc(180,155,75,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#263d33'; ctx.font='24px sans-serif'; ctx.textAlign='center'; ctx.fillText('테스트 상품 사진',180,290);
    return canvas.toDataURL('image/png').split(',')[1];
  }), 'base64');
  store.vendorOrderLines[0].imageUrl='https://fixture.invalid/product.png';
  const originalLine=structuredClone(store.vendorOrderLines[0]);
  await page.addInitScript(() => {
    window.__vendorCardDraws=[];
    const ids=new WeakMap(); let nextId=0;
    for(const method of ['drawImage','fillText']) {
      const original=CanvasRenderingContext2D.prototype[method];
      CanvasRenderingContext2D.prototype[method]=function(...args) {
        if(this.canvas.width===1080) {
          if(!ids.has(this.canvas)) ids.set(this.canvas,++nextId);
          window.__vendorCardDraws.push({id:ids.get(this.canvas),method,args:method==='fillText'?args:args.slice(1),font:this.font});
        }
        return original.apply(this,args);
      };
    }
  });
  const calls = [];
  let failNextSave = false;
  const savedStatuses = [];
  let downloadCount = 0;
  let photoUploads = 0;
  const uploadedPhotos = new Map();
  page.on('download', () => { downloadCount++; });
  await page.route("**/*", async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin !== "http://127.0.0.1:3111") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    calls.push(`${request.method()} ${url.pathname}`);
    const json = value => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(value) });
    if (url.pathname === '/api/wms/image-proxy') {
      assert(!url.searchParams.get('url').startsWith('/'),'local uploaded photos must load directly');
      return route.fulfill({status:200,contentType:'image/png',body:photo});
    }
    if (url.pathname === '/api/wms/weekly-work/image' && request.method()==='POST') {
      const body=request.postDataJSON();
      const match=body.dataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/);
      assert(match,'upload uses resized image bytes');
      const id=String(++photoUploads).padStart(64,'0');
      uploadedPhotos.set(id,{mime:match[1],bytes:Buffer.from(match[2],'base64')});
      return json({success:true,imageUrl:`/api/wms/weekly-work/image?id=${id}`});
    }
    if (url.pathname === '/api/wms/weekly-work/image' && request.method()==='GET') {
      const saved=uploadedPhotos.get(url.searchParams.get('id')); assert(saved);
      return route.fulfill({status:200,contentType:saved.mime,body:saved.bytes});
    }
    if (url.pathname === '/api/wms/product-catalog/update' && request.method()==='POST') {
      const body=request.postDataJSON(); assert.equal(body.skuId,originalLine.skuId); assert(body.imageUrl.startsWith('/api/wms/weekly-work/image?'));
      return json({success:true});
    }
    if (url.pathname === '/api/wms/vendor-orders/queue' && request.method()==='POST') {
      const body=request.postDataJSON(); assert.equal(body.action,'saveLineImage');
      store=applyPickingWaveStoreMutation(store,{...body,action:'saveVendorLineImage',now:new Date().toISOString()});
      return json({success:true,line:store.vendorOrderLines.find(line=>line.id===body.lineId)});
    }
    if (url.pathname === "/api/wms/picking-waves" && request.method() === "GET") return json({ ok: true, snapshot: clone() });
    if (url.pathname === "/api/wms/vendor-orders/queue" && request.method() === "GET") return json({ success: true, queueId, deletedDraftIds: store.deletedVendorDraftIds, consumedLineIds: [], draftUpdatedAtById: Object.fromEntries(store.vendorOrderDrafts.map(d => [d.id, d.updatedAt]) ) });
    if (url.pathname === "/api/wms/vendor-orders/completion" && request.method() === "POST") return json({ success: true, excludedLineIds: [], scope: { discontinued: [], routedVendorLineIds: [] }, partialCompletions: [] });
    if (url.pathname === "/api/wms/vendor-order-actions" && request.method() === "GET") return json({ success: true, delaySummaries: [] });
    if (url.pathname === "/api/wms/product-catalog" && request.method() === "GET") return json({ ok: true, items: [] });
    if (url.pathname === "/api/wms/vendor-orders/delay" && request.method() === "POST") {
      const body = request.postDataJSON();
      store = applyPickingWaveStoreMutation(store, { action: "setSentVendorDelay", ...body, now: new Date().toISOString() });
      return json({ success: true, line: store.vendorOrderLines.find(line => line.id === body.lineId) });
    }
    if (url.pathname === "/api/wms/picking-waves" && request.method() === "POST") {
      const body = request.postDataJSON();
      assert(['saveVendorWorkspace','deleteVendorLines'].includes(body.action));
      if (body.action === 'saveVendorWorkspace') {
        if (failNextSave) { failNextSave = false; return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({ok:false,error:'검증용 저장 실패'})}); }
        savedStatuses.push(...body.drafts.map(draft=>draft.status));
      }
      store = applyPickingWaveStoreMutation(store, body);
      return json({ ok: true });
    }
    return route.fulfill({ status: 418, contentType: "application/json", body: JSON.stringify({ ok: false, error: "test deny" }) });
  });
  await page.goto("http://127.0.0.1:3111/wms/vendor-orders/manage", { waitUntil: "networkidle" });
  assert.equal(await page.getByRole('button',{name:'승인',exact:true}).count(),0,'approval step removed');
  await page.getByRole("spinbutton").first().fill("18");
  assert(await page.getByRole('spinbutton').first().evaluate(element=>{
    const data=new DataTransfer(); data.setData('text/plain','18');
    return element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
  }),'photo paste handler must not block text paste into quantity field');
  const preview=page.locator('[data-vendor-card-preview="preview-line"] img');
  await preview.waitFor();
  assert((await preview.getAttribute('alt')).includes('18개'));
  const photoCard=page.locator('[data-vendor-sku="77990001"]');
  await preview.click();
  assert(await photoCard.evaluate(element=>document.activeElement===element),'clicking photo focuses paste target');
  async function sendPhotoInput(kind,mime='image/png',repeat=1) {
    await photoCard.evaluate((element,{kind,mime,bytes,repeat})=>{
      const data=new DataTransfer(); data.items.add(new File([new Uint8Array(bytes)],mime==='image/png'?'photo.png':'note.txt',{type:mime}));
      for(let i=0;i<repeat;i++) element.dispatchEvent(kind==='paste'
        ? new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true})
        : new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}));
    },{kind,mime,bytes:[...photo],repeat});
  }
  for(const kind of ['paste','drop']) {
    const before=await preview.getAttribute('src');
    const saved=page.waitForResponse(response=>response.url().endsWith('/api/wms/vendor-orders/queue')&&response.request().method()==='POST');
    await sendPhotoInput(kind,'image/png',kind==='paste'?2:1);
    await saved;
    await page.waitForFunction(old=>{
      const img=document.querySelector('[data-vendor-card-preview="preview-line"] img');
      return img&&img.src!==old&&img.complete&&img.naturalWidth>0;
    },before);
    assert.equal(await page.getByRole('spinbutton').first().inputValue(),'18','photo saves preserve unsaved quantity');
  }
  assert.equal(photoUploads,2,'paste duplicate guard and drop each upload once');
  assert(store.vendorOrderLines[0].imageUrl.endsWith('2'.padStart(64,'0')),'dropped photo saved to matching SKU');
  await sendPhotoInput('drop','text/plain');
  await photoCard.getByRole('alert').waitFor();
  assert.equal(photoUploads,2,'non-image drop cannot upload');
  failNextSave=true;
  await page.getByRole('button',{name:'카카오톡용 이미지 저장',exact:true}).click();
  await page.getByText('검증용 저장 실패',{exact:false}).first().waitFor();
  assert.equal(downloadCount,0,'failed save must not download an unsaved order');
  assert.equal(store.vendorOrderDrafts[0].status,'draft');
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'카카오톡용 이미지 저장',exact:true}).click();
  const download=await downloadPromise;
  await download.saveAs('.tmp/vendor-draft-export.png');
  await preview.waitFor();
  const previewBytes=await preview.evaluate(async img=>Array.from(new Uint8Array(await (await fetch(img.src)).arrayBuffer())));
  assert.deepEqual(fs.readFileSync('.tmp/vendor-draft-export.png'),Buffer.from(previewBytes),'download is byte-identical to editable draft preview');
  assert.equal(store.vendorOrderLines[0].shortageQuantity,18,'export saves edited quantity');
  assert.equal(store.vendorOrderDrafts[0].status,'draft','image download does not approve or send');
  const draws=await page.evaluate(()=>window.__vendorCardDraws);
  const quantity=draws.findLast(draw=>draw.method==='fillText'&&draw.args[0]==='주문수량 18개');
  assert(quantity,'order quantity label is rendered into PNG');
  const card=draws.filter(draw=>draw.id===quantity.id);
  const picture=card.find(draw=>draw.method==='drawImage');
  const name=card.find(draw=>draw.method==='fillText'&&draw.args[0]===originalLine.productName);
  const option=card.find(draw=>draw.method==='fillText'&&draw.args[0]===originalLine.optionLabel);
  assert(picture&&name&&option);
  assert(picture.args[1]+picture.args[3]<name.args[2]&&name.args[2]<option.args[2]&&option.args[2]<quantity.args[2], 'PNG order: large photo, product, option, quantity');
  assert(picture.args[2]>=900,'product photo fills card width');
  const text=card.filter(draw=>draw.method==='fillText').map(draw=>String(draw.args[0])).join(' ');
  assert(!text.includes(originalLine.skuId)&&!text.includes('SKU')&&!text.includes('바코드'),'SKU and barcode omitted from shared card');
  const address=card.filter(draw=>draw.method==='fillText'&&/강원도|전망길|1층/.test(String(draw.args[0])));
  assert(address.length>0&&address.every(draw=>parseFloat(draw.font.match(/([\d.]+)px/)[1])>=48),'large delivery address');
  await preview.screenshot({path:'.tmp/vendor-card-layout-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  await preview.screenshot({path:'.tmp/vendor-card-layout-mobile.png'});
  await page.setViewportSize({width:1280,height:900});
  await page.screenshot({path:'.tmp/vendor-no-approval-draft.png',fullPage:true});
  await page.getByRole('spinbutton').first().fill('24');
  failNextSave=true;
  await page.getByRole('button',{name:'전송완료',exact:true}).click();
  await page.getByText('검증용 저장 실패',{exact:false}).first().waitFor();
  assert.equal(store.vendorOrderDrafts[0].status,'draft','failed save never marks sent');
  await page.getByRole('spinbutton').first().waitFor();
  await page.getByRole('button',{name:'전송완료',exact:true}).click();
  await page.reload({ waitUntil: "networkidle" });
  const sentOrder=page.locator('[data-vendor-order-id="preview-draft"]');
  assert.deepEqual(await sentOrder.getByRole('button').allTextContents(),['발주결과처리'],'sent order exposes only result processing');
  assert.equal(await sentOrder.getByRole('checkbox').count(),0);
  await page.screenshot({path:'.tmp/vendor-no-approval-sent.png',fullPage:true});
  await page.getByRole("button", { name: "발주결과처리", exact: true }).click();
  await sendPhotoInput('paste');
  await sendPhotoInput('drop');
  assert.equal(photoUploads,2,'sent result view cannot replace photos');
  await page.getByRole("link", { name: "후속처리 목록", exact: true }).waitFor();
  assert.equal(store.vendorOrderDrafts[0].status, "sent");
  assert.equal(store.vendorOrderLines[0].shortageQuantity,24);
  assert(!savedStatuses.includes('approved'),'no hidden approval save');
  await page.getByRole('button',{name:'입고지연',exact:true}).click();
  await page.getByRole('textbox',{name:'입고지연 메모',exact:true}).fill('브라우저 mock 지연');
  await page.getByRole('button',{name:'입고지연 저장',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "발주결과처리", exact: true }).click();
  await page.getByText("입고지연", { exact: false }).first().waitFor();
  assert(store.vendorOrderLines[0].receivingDelayedAt);
  assert.equal(store.vendorOrderLines[0].receivingDelayMemo, "브라우저 mock 지연");
  assert.equal(await page.getByRole('link', {name:/웨이브 목록|피킹 완료 화면으로|입고관리|단종·해제 관리|발주결과/}).count(),0);
  assert.equal(await page.getByText('간단 입고',{exact:true}).count(),0);
  assert.equal(await page.getByRole('heading',{level:1}).count(),1,'single page title');
  assert.equal(await page.getByRole('button',{name:'카카오톡용 이미지 저장',exact:true}).count(),0,'hide export controls during result processing');
  assert.equal(await page.getByText('제품링크 미등록',{exact:true}).count(),0);
  assert.equal(await page.getByText('쿠팡 바코드 미등록',{exact:true}).count(),0);
  const actions=page.getByLabel('상품 결과처리',{exact:true});
  const labels=['미납분재발주요청','단종으로이동','거래처수정','보충분 입고완료','입고지연 해제','삭제'];
  async function checkLayout() {
    const buttons=actions.getByRole('button');
    assert.equal(await buttons.count(),6,'exactly six result actions');
    const names=(await buttons.allTextContents()).map(text=>text.replace(/\s+/g,''));
    assert.deepEqual(names,labels.map(text=>text.replace(/\s+/g,'')));
    const boxes=await Promise.all(labels.map((_,index)=>buttons.nth(index).boundingBox()));
    assert(boxes.every(Boolean));
    assert(Math.max(...boxes.map(box=>box.width))-Math.min(...boxes.map(box=>box.width))<1,'equal widths');
    assert(Math.max(...boxes.map(box=>box.height))-Math.min(...boxes.map(box=>box.height))<1,'equal heights');
    assert(Math.abs(boxes[0].y-boxes[2].y)<1 && Math.abs(boxes[3].y-boxes[5].y)<1 && boxes[3].y>boxes[0].y,'two rows of three actions');
    assert(Math.abs(boxes[0].x-boxes[3].x)<1 && Math.abs(boxes[1].x-boxes[4].x)<1 && Math.abs(boxes[2].x-boxes[5].x)<1,'aligned columns');
  }
  await checkLayout();
  await actions.screenshot({path:'.tmp/vendor-actions-clean-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  await checkLayout();
  await actions.screenshot({path:'.tmp/vendor-actions-clean-mobile.png'});
  await page.setViewportSize({width:1280,height:900});
  assert(calls.every(call => call.startsWith("GET /api/") || ['POST /api/wms/picking-waves','POST /api/wms/vendor-orders/completion','POST /api/wms/vendor-orders/delay','POST /api/wms/weekly-work/image','POST /api/wms/product-catalog/update','POST /api/wms/vendor-orders/queue'].includes(call)));
  await page.screenshot({path:'.tmp/phase3-vendor-preview.png',fullPage:true});
  page.once('dialog', dialog=>dialog.accept());
  await actions.getByRole('button',{name:'삭제',exact:true}).click();
  await actions.waitFor({state:'hidden'});
  assert(store.deletedVendorLineIds['preview-line'],'moved delete button uses existing deletion action');
  store.vendorOrderDrafts=[{id:'legacy-draft',waveId:queueId,vendorName:originalLine.vendorName,status:'approved',createdAt:now,updatedAt:now}];
  store.vendorOrderLines=[{...originalLine,id:'legacy-line',draftId:'legacy-draft'}];
  await page.reload({waitUntil:'networkidle'});
  await page.getByRole('spinbutton').first().fill('7');
  assert.equal(await page.getByText('승인완료',{exact:true}).count(),0,'legacy approved orders show as editable drafts');
  await page.getByRole('button',{name:'전송완료',exact:true}).click();
  await page.getByRole('button',{name:'발주결과처리',exact:true}).waitFor();
  assert.equal(store.vendorOrderDrafts[0].status,'sent');
  assert.equal(store.vendorOrderLines[0].shortageQuantity,7,'legacy approved draft is still editable');
  console.log("PASS: paste/drop photos saved and previewed; duplicate/non-image/sent photo changes blocked; unsaved quantity retained; card/download identical; no approval and sent lock; all APIs intercepted.");
  await browser.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
