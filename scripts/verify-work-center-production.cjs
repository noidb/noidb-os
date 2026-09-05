// Production verification: GET snapshots only; browser business writes are intercepted.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const base = "https://noidb-os.vercel.app";
const waveId = "WAVE-20260902-926d76fa";
const output = process.env.NOIDB_PRODUCTION_CHECK_OUTPUT || "tmp/work-center-production-check";
const fingerprint = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function snapshot() {
  const started = performance.now();
  const response = await fetch(base + "/api/wms/picking-waves", { cache: "no-store" });
  assert.equal(response.status, 200);
  const { snapshot: data } = await response.json();
  assert.ok(data);
  const wave = data.waves.find(row => row.id === waveId);
  assert.ok(wave, "Existing baseline work must still exist without recreation");
  const items = data.items.filter(row => row.waveId === waveId);
  return {
    at: new Date().toISOString(), snapshotMs: Math.round(performance.now() - started),
    summary: { purchaseOrders: wave.sourcePurchaseOrderNumbers.length, skus: items.length, quantity: items.reduce((sum, row) => sum + row.totalQuantity, 0), generations: (wave.outputGenerations || []).length },
    fingerprints: Object.fromEntries(["waves", "items", "baskets", "shipments", "poConfirmationRecords", "vendorOrderDrafts", "vendorOrderLines"].map(key => [key, fingerprint(data[key] || [])])),
    responseBytes: Buffer.byteLength(JSON.stringify(data)),
  };
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  if (process.argv.includes("--before")) {
    const before = await snapshot();
    await fs.writeFile(path.join(output, "before.json"), JSON.stringify(before, null, 2));
    console.log(JSON.stringify({ readOnly: true, baseline: before.summary, snapshotMs: before.snapshotMs, responseBytes: before.responseBytes }));
    return;
  }
  const before = JSON.parse(await fs.readFile(path.join(output, "before.json"), "utf8"));
  const started = performance.now();
  const response = await fetch(base + "/api/wms/work-center", { cache: "no-store" });
  assert.equal(response.status, 200);
  const rawOverview = await response.text();
  const overviewMs = Math.round(performance.now() - started);
  const { overview } = JSON.parse(rawOverview);
  const work = overview.works.find(row => row.id === waveId);
  assert.ok(work);
  assert.deepEqual([work.purchaseOrderCount, work.skuCount, work.totalQuantity, work.centerCount], [33, 915, 979, 14]);
  assert.ok(!work.state || work.state.status === "active", "Baseline work stays active after its inbound date");
  const { chromium } = require(require.resolve("playwright", { paths: [process.env.NOIDB_TEST_DEPENDENCIES || process.cwd()] }));
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  let interceptedWrites = 0;
  const errors = [];
  try {
    const context = await browser.newContext();
    await context.route("**/api/**", async route => {
      const request = route.request();
      if (request.method() === "GET" && new URL(request.url()).pathname === "/api/wms/work-center") return route.continue();
      if (request.method() !== "GET") interceptedWrites++;
      return route.fulfill({ json: { configured: false, items: [], waves: [], drafts: [], shipments: [], records: [], results: [], data: [], errors: [], orders: [], addedPurchaseOrderNumbers: [], updatedPurchaseOrderNumbers: [], skippedDuplicatePurchaseOrderNumbers: [], updatedScheduleChanges: [], totalPurchaseOrders: 0, totalSkuTypes: 0, totalQuantity: 0, snapshot: { waves: [], items: [], baskets: [], vendorOrderDrafts: [], vendorOrderLines: [], poConfirmationRecords: [] } } });
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base + "/wms/work-center");
    await page.getByRole("heading", { name: "오늘 할 일", exact: true }).waitFor();
    await page.getByText("발주 33건 · SKU 915개 · 총수량 979개 · 센터 14곳", { exact: true }).waitFor();
    for (const width of [360, 390, 412, 430, 1920]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 1080 });
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "overflow " + width);
      await page.screenshot({ path: path.join(output, `production-${width}.png`), fullPage: true });
    }
    assert.equal(errors.length, 0, errors.join("\n"));
  } finally { await browser.close(); }
  const after = await snapshot();
  const changedCollections = Object.keys(before.fingerprints).filter(key => before.fingerprints[key] !== after.fingerprints[key]);
  const result = { readOnly: true, baseline: after.summary, overviewBytes: Buffer.byteLength(rawOverview), fullSnapshotBytes: after.responseBytes, overviewMs, fullSnapshotMs: after.snapshotMs, widths: [360,390,412,430,1920], browserErrors: errors, interceptedWrites, changedCollections, actualExternalUploadTest: false, physicalMobileTest: false };
  await fs.writeFile(path.join(output, "after.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  assert.deepEqual(changedCollections, [], "Operating collections changed during deployment window; inspect user activity before claiming preservation");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
