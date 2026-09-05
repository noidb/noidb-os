// Isolated UI only: every business API is intercepted, no operating writes.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require(require.resolve("playwright", { paths: [process.env.NOIDB_TEST_DEPENDENCIES || process.cwd()] }));
const base = process.env.NOIDB_TEST_URL || "http://localhost:3114";
const id = "WAVE-20260902-926d76fa";
const root = `/wms/picking/waves/${id}`;
const work = { id, title: "2026-09-04 입고 출고작업", updatedAt: "2026-09-04T00:00:00Z", state: null, purchaseOrderCount: 33, skuCount: 915, totalQuantity: 979, centerCount: 14, expectedDates: ["2026-09-04"], delay: "출고 유예 1일째", pickedSkuCount: 915, remainingShipmentPoCount: 2, remainingOutputPoCount: 2, nextLabel: "Shipment 묶음 2 계속하기", nextHref: root + "/complete?generation=GEN-2#hanjin-step-3", documentHref: root + "/complete", pickingHref: root, vendorHref: root + "/vendor-orders", canComplete: false };
async function main() {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  let overview = { today: "2026-09-05", works: [work], pendingVendorCount: 4, pendingVendorSkuCount: 38, receivingVendorSkuCount: 2 };
  const changes = [];
  let overviewReads = 0;
  const overviewResponse = () => structuredClone(overview);
  await context.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === "/api/wms/work-center") {
      if (request.method() === "GET") { overviewReads++; return route.fulfill({ json: { overview: overviewResponse() } }); }
      const change = request.postDataJSON(); changes.push(change);
      assert.equal(change.waveId, id); assert.equal(change.confirmed, true);
      overview = { ...overview, works: [{ ...work, state: { status: change.status, updatedAt: "2026-09-05T00:00:00Z", history: [] } }] };
      return route.fulfill({ json: { overview: overviewResponse() } });
    }
    if (url.pathname === "/api/wms/picking-waves") return route.fulfill({ json: { ok: true, snapshot: { waves: [], items: [], baskets: [], poConfirmationRecords: [], vendorOrderDrafts: [], vendorOrderLines: [] } } });
    if (url.pathname === "/api/wms/supplier-hub-orders") return route.fulfill({ json: { orders: [{ purchaseOrderNumber: "900000002", fulfillmentCenter: "동탄1", expectedDate: "2026-09-08", capturedAt: "2026-09-05T00:00:00Z", orderType: "테스트 발주", items: [{ lineNo: 1, productName: "여성 반지, 실버, 20호", orderedQuantity: 2 }] }], upcomingInboundSummary: [] } });
    return route.fulfill({ json: { configured: false, items: [], waves: [], drafts: [], shipments: [], records: [], results: [], data: [], errors: [], orders: [], addedPurchaseOrderNumbers: [], updatedPurchaseOrderNumbers: [], skippedDuplicatePurchaseOrderNumbers: [], updatedScheduleChanges: [], totalPurchaseOrders: 0, totalSkuTypes: 0, totalQuantity: 0 } });
  });
  try {
    await page.goto(base + "/wms/work-center");
    await page.getByRole("heading", { name: "오늘 할 일", exact: true }).waitFor();
    await page.getByText("발주 33건 · SKU 915개 · 총수량 979개 · 센터 14곳", { exact: true }).waitFor();
    assert.equal(changes.length, 0, "Opening overview must not change lifecycle");
    assert.equal(await page.getByRole("link", { name: "계속하기 →", exact: true }).getAttribute("href"), work.nextHref);
    assert.equal(await page.getByRole("link", { name: "전체 웨이브", exact: false }).count(), 0);
    assert.equal(await page.locator('a[href="/wms/vendor-orders/receiving"]').count(), 0, "complex receiving is not in main flow");
    const output = process.env.NOIDB_BROWSER_OUTPUT || "tmp/work-center-browser-check";
    await fs.mkdir(output, { recursive: true });
    for (const width of [360, 390, 412, 430, 1920]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 1080 });
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "overflow " + width);
      assert.equal(await page.getByRole("link", { name: "계속하기 →", exact: true }).evaluate(el => el.getBoundingClientRect().bottom < innerHeight), true, "next action above fold " + width);
      await page.screenshot({ path: path.join(output, `work-center-${width}.png`) });
    }
    await page.getByRole("button", { name: "신규·미연결 발주서 검토하기", exact: true }).click();
    const products = page.locator("summary").filter({ hasText: "상품 목록 보기 (1)" });
    await products.waitFor();
    assert.equal(await products.evaluate(element => element.parentElement.open), false, "new PO SKU list is initially collapsed");
    assert.equal(await page.locator('a').filter({ hasText: /^기존 출고작업에 추가$/ }).getAttribute("aria-disabled"), "true");
    await products.click();
    await page.getByText("여성 반지, 실버, 20호", { exact: true }).waitFor();
    await page.setViewportSize({ width: 360, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "expanded PO must fit mobile");
    await page.getByRole("button", { name: "목록 접기", exact: true }).click();
    await page.setViewportSize({ width: 1920, height: 1080 });
    const card = page.getByTestId("outbound-work");
    await card.locator("summary").click();
    assert.equal(await card.getByRole("button", { name: "작업완료", exact: true }).isDisabled(), true);
    await card.getByRole("button", { name: "보관하기", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "취소", exact: true }).click();
    assert.equal(changes.length, 0);
    await card.getByRole("button", { name: "보관하기", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "보관 저장", exact: true }).click();
    await page.getByRole("heading", { name: "작업 중 · 0개", exact: true }).waitFor();
    await page.locator("summary").filter({ hasText: "완료·보관" }).click();
    await card.locator("summary").click();
    await card.getByRole("button", { name: "작업 중으로 복원", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "작업 중으로 복원 저장", exact: true }).click();
    await page.getByRole("heading", { name: "작업 중 · 1개", exact: true }).waitFor();
    assert.deepEqual(changes.map(change => change.status), ["archived", "active"]);
    await page.reload(); await page.getByRole("heading", { name: "작업 중 · 1개", exact: true }).waitFor();
    const beforeFocus = overviewReads;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForFunction(() => document.querySelector("h1")?.textContent === "오늘 할 일");
    assert.ok(overviewReads >= beforeFocus);
    assert.equal(errors.length, 0, errors.join("\n"));
    console.log(JSON.stringify({ ok: true, widths: [360,390,412,430,1920], nextActionAboveFold: true, generationDeepLink: true, pastDateVisible: true, archiveRestore: true, fixturesOnly: true, overviewReads }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
