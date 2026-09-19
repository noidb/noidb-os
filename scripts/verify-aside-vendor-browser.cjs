const assert = require('node:assert/strict');
const { chromium } = require('C:/Users/noidb/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

(async () => {
  const base = 'http://127.0.0.1:3111';
  const response = await fetch(base + '/api/wms/picking-waves');
  const data = await response.json();
  assert(response.ok && data.ok);
  const snapshot = structuredClone(data.snapshot);
  const waveId = 'ASIDE-VENDOR-20260917';
  snapshot.vendorOrderDrafts = snapshot.vendorOrderDrafts.filter(row => row.waveId === waveId);
  snapshot.vendorOrderLines = snapshot.vendorOrderLines.filter(row => row.waveId === waveId);
  assert.equal(snapshot.vendorOrderDrafts.length,4); assert.equal(snapshot.vendorOrderLines.length,19);
  snapshot.activeVendorQueueId = 'VENDOR-QUEUE-aside-readonly-test';
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const unexpected = [];
    await page.route('**/*', async route => {
      const req=route.request(), url=new URL(req.url());
      if (url.origin !== base) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const json = body => route.fulfill({ status:200,contentType:'application/json',body:JSON.stringify(body) });
      if (url.pathname === '/api/wms/picking-waves' && req.method() === 'GET') return json({ok:true,snapshot});
      if (url.pathname === '/api/wms/vendor-orders/queue' && req.method() === 'GET') return json({success:true,queueId:snapshot.activeVendorQueueId,deletedDraftIds:{},consumedLineIds:[],draftUpdatedAtById:{}});
      if (url.pathname === '/api/wms/product-catalog') return json({ok:true,items:[]});
      if (url.pathname === '/api/wms/vendor-order-actions' && req.method() === 'GET') return json({success:true,delaySummaries:[]});
      if (url.pathname === '/api/wms/vendor-orders/completion') return json({success:true,excludedLineIds:[],scope:{discontinued:[],routedVendorLineIds:[]},partialCompletions:[]});
      if (url.pathname === '/api/wms/image-proxy' && req.method() === 'GET') return route.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8/x8AAwMCAO+jfaoAAAAASUVORK5CYII=','base64')});
      unexpected.push(`${req.method()} ${url.pathname}`);
      return route.fulfill({status:418,contentType:'application/json',body:'{"error":"isolated test blocks unmocked API"}'});
    });
    await page.goto(base+'/wms/vendor-orders/manage',{waitUntil:'networkidle'});
    const groups=page.locator('[data-vendor-order-id^="ASIDE-VENDOR-20260917::"]');
    assert.equal(await groups.count(),4);
    for (let index=0;index<4;index++) await groups.nth(index).getByRole('button',{name:'발주결과처리',exact:true}).click();
    assert.equal(await groups.locator('[data-vendor-sku]').count(),19);
    assert.equal(await groups.getByRole('button',{name:'입고지연 해제',exact:true}).count(),10);
    assert.equal(await groups.getByRole('button',{name:'입고지연',exact:true}).count(),9);
    for (const line of snapshot.vendorOrderLines) assert.equal(await groups.locator(`[data-vendor-sku="${line.skuId}"]`).count(),1);
    for (let index=0;index<4;index++) await groups.nth(index).getByRole('button',{name:'발주결과처리',exact:true}).click();
    await page.screenshot({path:'.tmp/aside-vendor-import-screen.png',fullPage:true});
    assert.deepEqual(unexpected,[]);
    console.log('PASS: saved Aside19 -> four vendor orders ->19 unique result cards,10 delayed/9 unanswered; browser APIs isolated, no business writes.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
