const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { chromium } = require("C:/Users/noidb/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const { buildWorkCenterOverview } = require("../lib/wms/work-center.ts");
const { projectWaveDispatchedPurchaseOrders } = require("../lib/wms/dispatched-purchase-orders.ts");
const targetId = "WAVE-20260908-8af1667d";
const output = "outputs/cross-wave-dispatch-20260908";

(async () => {
  const response = await fetch("https://noidb-os.vercel.app/api/wms/picking-waves", { cache: "no-store" });
  assert(response.ok, "Production fixture read succeeds");
  const data = await response.json();
  assert(data.ok && data.snapshot, "Production snapshot is present");
  const snapshot = data.snapshot;
  const original = JSON.stringify(snapshot);
  const overview = buildWorkCenterOverview(snapshot);
  const target = overview.works.find(work => work.id === targetId);
  assert(target, "Target work exists");
  const projection = projectWaveDispatchedPurchaseOrders(snapshot, targetId);
  assert.equal(target.purchaseOrderCount, 10); assert.equal(target.skuCount, 98); assert.equal(target.totalQuantity, 152);
  assert.deepEqual(target.expectedDates, ["2026-09-11"]); assert.equal(target.delay, null);
  const completedOwnerIds = [...new Set(projection.completed.map(item => item.waveId))];
  assert(completedOwnerIds.length > 0);
  const posts = [], errors = [], apiReads = new Map();
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  let page;
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
    await context.addInitScript(() => localStorage.setItem("noidb_picking_wave_shared_migration_v1", JSON.stringify({ completedAt: "fixture", serverRevision: 0 })));
    await context.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() !== "GET") posts.push({ path: url.pathname, method: request.method(), action: request.postDataJSON()?.action });
      apiReads.set(url.pathname, (apiReads.get(url.pathname) || 0) + 1);
      if (url.pathname === "/api/wms/work-center") return route.fulfill({ json: { overview } });
      if (url.pathname === "/api/wms/picking-waves") return route.fulfill({ json: { ok: true, snapshot } });
      if (url.pathname === "/api/wms/supplier-hub-orders") return route.fulfill({ json: { orders: [], upcomingInboundSummary: [], totalPurchaseOrders: 0, totalSkuTypes: 0, totalQuantity: 0 } });
      return route.fulfill({ json: { success: true, ok: true, connected: false, configured: false, items: [], records: [], requests: [], orders: [], data: [], results: [], errors: [], waves: [], drafts: [], shipments: [], zones: [], shelves: [], boxes: [], addedPurchaseOrderNumbers: [], updatedPurchaseOrderNumbers: [], skippedDuplicatePurchaseOrderNumbers: [], updatedScheduleChanges: [], totalPurchaseOrders: 0, totalSkuTypes: 0, totalQuantity: 0 } });
    });
    page = await context.newPage(); page.on("pageerror", error => {errors.push(error.message);console.error("pageerror:",error.message);});
    await page.goto("http://localhost:3000/wms/work-center", { waitUntil: "domcontentloaded", timeout: 90000 });
    const active = page.locator('section[aria-labelledby="active-outbound-title"]');
    const card = active.locator('[data-testid="outbound-work"]').filter({ has: page.locator(`a[href*="${targetId}"]`) });
    await card.getByText(`발주 10건 · SKU 98개 · 총수량 152개 · 센터 ${target.centerCount}곳`, { exact: true }).waitFor({ timeout: 20000 });
    assert.doesNotMatch(await card.innerText(), /2026-09-09|출고 유예|일 경과/);
    for (const owner of completedOwnerIds) assert.equal(await active.locator('[data-testid="outbound-work"]').filter({ has: page.locator(`a[href*="${owner}"]`) }).count(), 0, "The completed owner is absent from active work");
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Main no overflow " + width);
      await page.screenshot({ path: path.join(output, `summary-main-${width}.png`), fullPage: true });
    }
    await page.locator("summary").filter({ hasText: /^완료·보관/ }).click();
    for (const owner of completedOwnerIds) {
      const work = overview.works.find(candidate => candidate.id === owner);
      const filed = page.locator('[data-testid="outbound-work"]').filter({ has: page.locator(`a[href*="${owner}"]`) });
      assert(await filed.isVisible()); assert.match(await filed.innerText(), new RegExp(`발주 ${work.purchaseOrderCount}건`));
    }
    await page.goto("http://localhost:3000/wms/picking/waves", { waitUntil: "domcontentloaded", timeout: 90000 });
    const classic = page.locator(".wms-active-wave-card").filter({ has: page.locator(`a[href*="${targetId}"]`) }).first();
    await classic.getByText("발주 10건", { exact: true }).waitFor({ timeout: 90000 });
    await classic.getByText("SKU 98개", { exact: true }).waitFor();
    await classic.getByText("총 수량 152개", { exact: true }).waitFor();
    assert.doesNotMatch(await classic.innerText(), /2026-09-09|출고 유예|일 경과/);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Wave summary no overflow " + width);
      await page.screenshot({ path: path.join(output, `summary-classic-${width}.png`), fullPage: true });
    }
    assert.equal(JSON.stringify(snapshot), original, "Read-only fixture stays unchanged");
    assert(posts.every(post => post.path === "/api/wms/import-latest-purchase-orders" || post.path === "/api/wms/picking-waves" && post.action === "migrate"), "Only automatic startup requests are stubbed; no completion/edit action is performed");
    assert.deepEqual(errors, []);
    const results = { passed: true, targetId, purchaseOrders: target.purchaseOrderCount, skuCount: target.skuCount, quantity: target.totalQuantity, centers: target.centerCount, expectedDates: target.expectedDates, excludedPurchaseOrders: projection.completedPurchaseOrderNumbers, completedOwnerIds, productionReads: 1, externalWrites: 0, posts, errors, apiReads: Object.fromEntries(apiReads) };
    fs.writeFileSync(path.join(output, "summary-browser-results.json"), JSON.stringify(results, null, 2));
    console.log("PASS cross-wave actual-data browser: main and wave list 10 POs / 98 SKU / 152 quantity, completed history, current dates, mobile. " + JSON.stringify(results));
  } catch(error) { if(page){fs.writeFileSync(path.join(output,"summary-debug.txt"),await page.locator("body").innerText());await page.screenshot({path:path.join(output,"summary-debug.png"),fullPage:true});}fs.writeFileSync(path.join(output,"summary-debug-api.json"),JSON.stringify({posts,errors,apiReads:Object.fromEntries(apiReads)},null,2));throw error; } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
