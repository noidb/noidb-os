const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("C:/Users/noidb/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const { fixture, createRoute } = require("./verify-outbound-completion.cjs");
const base = process.env.NOIDB_TEST_URL || "http://localhost:3000";
if (!["localhost","127.0.0.1"].includes(new URL(base).hostname)) throw new Error("Local mocked browser test only.");
const output = "outputs/outbound-completion-20260908";
(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const failures = [];
  const results = [];
  try {
    for (const width of [1280, 390]) {
      const api = createRoute(fixture());
      async function contextForWidth() {
        const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
        await context.addInitScript(() => { localStorage.setItem("noidb_picking_wave_shared_migration_v1", "fixture"); localStorage.setItem("noidb_vendor_order_shared_migration_v1", "fixture"); });
        await context.route("**/*", async route => {
          const request = route.request(), url = new URL(request.url());
          if (url.origin !== new URL(base).origin) return route.abort();
          if (!url.pathname.startsWith("/api/")) return request.method() === "GET" ? route.continue() : route.abort();
          if (url.pathname === "/api/wms/work-center") {
            const result = request.method() === "GET" ? await api.GET() : await api.POST({ json: async () => request.postDataJSON() });
            return route.fulfill({ status: result.status, json: result.body });
          }
          if (url.pathname === "/api/wms/import-latest-purchase-orders") return route.fulfill({ json: { addedPurchaseOrderNumbers: [], updatedPurchaseOrderNumbers: [], skippedDuplicatePurchaseOrderNumbers: [], updatedScheduleChanges: [], totalPurchaseOrders: 0, totalSkuTypes: 0, totalQuantity: 0 } });
          if (request.method() !== "GET") { failures.push("Unexpected write " + url.pathname); return route.fulfill({ status: 400, json: { error: "Unexpected fixture write" } }); }
          return route.fulfill({ json: { configured: false, items: [], waves: [], drafts: [], shipments: [], records: [], results: [], data: [], errors: [], orders: [] } });
        });
        return context;
      }
      const context = await contextForWidth();
      const page = await context.newPage();
      page.on("pageerror", error => failures.push(error.message));
      await page.goto(base + "/wms/work-center");
      const active = page.getByRole("region", { name: "작업 중 · 1개" });
      await active.getByRole("button", { name: "출고완료", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "취소", exact: true }).click();
      assert.equal(api.writes(), 0, "cancel must preserve pending work");
      await active.getByRole("button", { name: "출고완료", exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "출고완료 저장", exact: true }).click();
      await page.getByRole("heading", { name: "작업 중 · 0개", exact: true }).waitFor();
      await page.reload();
      await page.getByRole("heading", { name: "작업 중 · 0개", exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "출고완료", exact: true }).count(), 0);
      await page.screenshot({ path: output + "/completed-" + width + ".png", fullPage: true });
      const second = await contextForWidth();
      const devicePage = await second.newPage();
      await devicePage.goto(base + "/wms/work-center");
      await devicePage.getByRole("heading", { name: "작업 중 · 0개", exact: true }).waitFor();
      await devicePage.getByText("완료·보관 (1)", { exact: true }).click();
      await devicePage.getByText("서류·피킹·발주·작업 관리", { exact: true }).click();
      await devicePage.getByRole("button", { name: "작업 중으로 복원", exact: true }).click();
      await devicePage.getByRole("dialog").getByRole("button", { name: "작업 중으로 복원 저장", exact: true }).click();
      await devicePage.getByRole("heading", { name: "작업 중 · 1개", exact: true }).waitFor();
      assert.equal(api.snapshot().outboundWorkStates["WAVE-DISPATCH-TEST"].history.length, 2);
      const dimensions = await devicePage.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      assert(dimensions.scroll <= dimensions.width + 1, "horizontal overflow " + JSON.stringify(dimensions));
      results.push({ width, completion: true, cancelPreserved: true, reloadHidden: true, secondDeviceHidden: true, restore: true, overflow: false });
      await context.close();
      await second.close();
    }
    assert.deepEqual(failures, []);
    await fs.writeFile(output + "/browser-results.json", JSON.stringify({ results, failures }, null, 2));
    console.log("Outbound completion browser PASS: desktop/mobile direct completion, cancel, reload and second device, preserved completed history and restore, no horizontal overflow.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
