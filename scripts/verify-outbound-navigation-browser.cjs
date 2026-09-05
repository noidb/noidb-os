// Real dashboard/complete routes, isolated API fixtures. No business API may be forwarded.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require(require.resolve("playwright", { paths: [process.env.NOIDB_TEST_DEPENDENCIES || process.cwd()] }));
const base = process.env.NOIDB_TEST_URL || "http://127.0.0.1:3114";
const origin = new URL(base);
if (!["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) throw new Error("Outbound navigation fixtures are localhost-only.");
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
const work = { id: waveId, title: "2026-09-04 입고 출고작업", updatedAt: now, state: null, purchaseOrderCount: 6, skuCount: 6, totalQuantity: 30, centerCount: 1, expectedDates: ["2026-09-04"], delay: "출고 유예 1일째", pickedSkuCount: 6, remainingShipmentPoCount: 2, remainingOutputPoCount: 4,
  documentHref: `${root}/complete`, pickingHref: root, vendorHref: `${root}/vendor-orders`, canComplete: false };
const missingText = "연결된 Shipment 묶음을 찾지 못했습니다. 작업센터에서 최신 상태를 다시 열어 주세요.";
const forbidden = [], errors = [], results = [];
let currentPage;

async function runCase(browser, width, target) {
  const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 1080 }, serviceWorkers: "block" });
  const shipmentPreviews = [], previews = [], selectionMutations = [];
  const fixtureSnapshot = JSON.parse(JSON.stringify(snapshot));
  const href = `${root}/complete?generation=${target.generationId}#${target.anchor}`;
  await context.addInitScript(({ id, selectedId }) => {
    try {
      localStorage.setItem("noidb_picking_wave_shared_migration_v1", "fixture");
      localStorage.setItem("noidb_vendor_order_shared_migration_v1", "fixture");
      // Deliberately conflicting saved state: the URL must win over a later selected group/scroll.
      sessionStorage.setItem(`noidb:wms:active-output-generation:${id}`, selectedId);
      sessionStorage.setItem(`noidb:wms:complete-position:${id}`, "0");
    } catch { /* Initial opaque about:blank has no storage access. */ }
  }, { id: waveId, selectedId: generations[2].generationId });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin.origin) return route.abort();
    if (!url.pathname.startsWith("/api/")) {
      if (request.method() === "GET") return route.continue();
      forbidden.push(`${request.method()} ${url.pathname}`); return route.abort();
    }
    if (request.method() === "GET" && url.pathname === "/api/wms/work-center") return route.fulfill({ json: { overview: { today: "2026-09-05", works: [{ ...work, nextLabel: target.label, nextHref: href }], pendingVendorCount: 0, pendingVendorSkuCount: 0, receivingVendorSkuCount: 0 } } });
    if (request.method() === "GET" && url.pathname === "/api/wms/picking-waves") return route.fulfill({ json: { ok: true, snapshot: fixtureSnapshot } });
    if (request.method() === "POST" && url.pathname === "/api/wms/picking-waves" && target.selectOther) {
      try {
        const body = request.postDataJSON();
        assert.equal(body.action, "saveWave", "Only the explicit group-selection fixture may save a wave.");
        assert.equal(body.wave.selectedOutputGenerationId, generations[1].generationId);
        assert.deepEqual(body.wave, { ...fixtureSnapshot.waves[0], selectedOutputGenerationId: generations[1].generationId, updatedAt: body.wave.updatedAt }, "Changing the selected group must preserve all other wave/generation data.");
        selectionMutations.push(body);
        fixtureSnapshot.waves[0] = structuredClone(body.wave);
        fixtureSnapshot.revision += 1;
        fixtureSnapshot.updatedAt = body.wave.updatedAt;
        return route.fulfill({ json: { ok: true, snapshot: fixtureSnapshot } });
      } catch (error) {
        forbidden.push(error.message);
        return route.fulfill({ status: 400, json: { ok: false, error: error.message } });
      }
    }
    if (request.method() === "GET" && url.pathname === "/api/wms/product-catalog") return route.fulfill({ json: { configured: true, items: [] } });
    if (request.method() === "GET" && url.pathname === "/api/wms/supplier-hub-orders") return route.fulfill({ json: { configured: true, orders: poNumbers.map(purchaseOrderNumber => ({ purchaseOrderNumber, expectedDate: "2026-09-04", fulfillmentCenter: "동탄1" })), upcomingInboundSummary: [] } });
    if (request.method() === "POST" && url.pathname === "/api/wms/import-latest-purchase-orders") return route.fulfill({ json: { addedPurchaseOrderNumbers: [], updatedPurchaseOrderNumbers: [], skippedDuplicatePurchaseOrderNumbers: [], updatedScheduleChanges: [], totalPurchaseOrders: 6, totalSkuTypes: 6, totalQuantity: 30 } });
    if (request.method() === "POST" && url.pathname === "/api/wms/hanjin-upload/shipment-preview") {
      const body = request.postDataJSON(); shipmentPreviews.push(body.purchaseOrderNumbers);
      return route.fulfill({ json: { preview: { canGenerate: true, matchedPurchaseOrderCount: body.purchaseOrderNumbers.length, missingPurchaseOrderNumbers: [], selectedReprintFileName: "fixture-result.xlsx", candidateFiles: [{ fileName: "fixture-result.xlsx", exactMatch: true, matchedPurchaseOrderCount: body.purchaseOrderNumbers.length, modifiedTime: now }], blockingReasons: [] } } });
    }
    if (request.method() === "POST" && url.pathname === "/api/wms/hanjin-upload/preview") {
      previews.push(request.postDataJSON());
      return route.fulfill({ json: { preview: { canGenerate: true, fulfillmentCenterCount: 1, shippingGroupCount: 3, blockingReasons: [], shippingGroups: [] } } });
    }
    if (request.method() === "POST" && url.pathname === "/api/wms/po-confirm/inspect-source") {
      // The completed-wave navigation scenario does not need a new confirmation template.
      return route.fulfill({ json: { folderAccessible: true, source: null, error: "격리 검증: 신규 발주확정 양식은 이 탐색 테스트에서 사용하지 않습니다." } });
    }
    if (request.method() !== "GET") {
      forbidden.push(`${request.method()} ${url.pathname}`);
      return route.fulfill({ status: 400, json: { ok: false, error: "No business writes or file generation in navigation fixtures." } });
    }
    return route.fulfill({ json: { configured: false, items: [], waves: [], drafts: [], shipments: [], records: [], results: [], data: [], errors: [], orders: [] } });
  });
  const page = await context.newPage(); currentPage = page;
  page.setDefaultTimeout(20000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("download", () => forbidden.push("Unexpected download"));
  try {
    await page.goto(`${base}/wms/work-center`);
    const link = page.getByRole("link", { name: "계속하기 →", exact: true });
    await link.waitFor();
    assert.equal(await link.getAttribute("href"), href);
    await page.mouse.wheel(0, 1);
    const dashboardScroll = await link.evaluate(element => {
      window.scrollTo(0, 300);
      const position = window.scrollY;
      element.click();
      return position;
    });
    await page.waitForURL(url => url.pathname === `${root}/complete` && url.searchParams.get("generation") === target.generationId && url.hash === `#${target.anchor}`);
    const targetSection = page.locator(`#${target.anchor}`);
    await targetSection.waitFor();
    if (target.invalid) {
      await page.getByRole("alert").filter({ hasText: missingText }).waitFor();
      assert.equal(await page.locator("#hanjin-step-3").getByRole("button", { name: /^Shipment 파일/ }).count(), 0);
      assert.equal(await page.locator("#shipment-output-set").getByRole("button", { name: "Shipment 출력세트 생성", exact: true }).count(), 0);
      assert.deepEqual(shipmentPreviews, [], "Unknown generation must not preview a different group.");
    } else {
      const summary = target.anchor === "hanjin-step-3" ? `현재 Shipment 대상 · 묶음 ${target.number} · 발주 2건` : `현재 출력세트: 묶음 ${target.number} · 발주 2건`;
      await targetSection.getByText(summary, { exact: false }).waitFor();
      await page.locator("#hanjin-step-3").getByRole("button", { name: /^Shipment 파일/ }).waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll("#hanjin-step-3 button")].some(button => !button.disabled && button.textContent.startsWith("Shipment 파일")));
      assert(shipmentPreviews.length > 0);
      for (const poSet of shipmentPreviews) assert.deepEqual(poSet, generations[target.number - 1].purchaseOrderNumbers, "URL-selected PO set must not fall back to the latest generation.");
      assert.equal(await page.getByRole("button", { name: `묶음 ${target.number} · 발주 2건`, exact: true }).count(), 1);
      if (target.anchor === "shipment-output-set") assert.equal(await targetSection.getByRole("button", { name: "Shipment 출력세트 생성", exact: true }).isEnabled(), true);
    }
    // Let debounced source validation and nested generation rendering settle, without manually scrolling.
    await page.waitForFunction(id => { const section = document.getElementById(id); const rect = section?.getBoundingClientRect(); return Boolean(rect && rect.top >= -2 && rect.top < innerHeight - 50); }, target.anchor);
    if (!target.invalid) {
      await page.waitForFunction(({ id, text }) => {
        const button = [...document.querySelectorAll(`#${id} button`)].find(element => element.textContent.trim() === text);
        const rect = button?.getBoundingClientRect();
        return Boolean(rect && rect.top >= 0 && rect.bottom <= innerHeight);
      }, { id: target.anchor, text: target.anchor === "shipment-output-set" ? "Shipment 출력세트 생성" : "Shipment 파일 생성" });
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Horizontal overflow at ${width}`);
    const bounds = await targetSection.boundingBox();
    await page.screenshot({ path: path.join(output, `navigation-${target.anchor}-${target.number || "invalid"}-${width}.png`) });
    assert.equal(selectionMutations.length, 0, "Entering a generation deep link must not save selection automatically.");
    let changedSelection = null;
    if (target.selectOther) {
      const beforePreviewCount = shipmentPreviews.length;
      await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === "/api/wms/picking-waves" && response.request().method() === "POST"),
        page.getByRole("button", { name: "묶음 2 · 발주 2건", exact: true }).click(),
      ]);
      await page.locator("#hanjin-step-3").getByText("현재 Shipment 대상 · 묶음 2 · 발주 2건", { exact: false }).waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll("#hanjin-step-3 button")].some(button => !button.disabled && button.textContent.trim() === "Shipment 파일 재생성"));
      assert.equal(new URL(page.url()).searchParams.get("generation"), target.generationId, "The regression specifically covers selection while the original deep-link query remains present.");
      assert(shipmentPreviews.length > beforePreviewCount, "Selecting a different group must run its own tracking preview.");
      for (const poSet of shipmentPreviews.slice(beforePreviewCount)) assert.deepEqual(poSet, generations[1].purchaseOrderNumbers);
      assert.equal(selectionMutations.length, 1, "One explicit group selection must save exactly once.");
      assert.equal(fixtureSnapshot.waves[0].selectedOutputGenerationId, generations[1].generationId);
      changedSelection = { generationId: generations[1].generationId, purchaseOrderNumbers: generations[1].purchaseOrderNumbers, sharedSaveCount: selectionMutations.length };
    }
    await page.goBack();
    await page.getByRole("heading", { name: "오늘 할 일", exact: true }).waitFor();
    await page.waitForFunction(expected => Math.abs(window.scrollY - expected) < 5, dashboardScroll);
    results.push({ width, anchor: target.anchor, selectedGeneration: target.generationId, invalidBlocked: Boolean(target.invalid), anchorTop: bounds.y, actionInViewport: !target.invalid, shipmentPreviewPoSets: shipmentPreviews, dashboardScrollRestored: dashboardScroll, changedSelection });
  } catch (error) {
    console.error(JSON.stringify({ width, target, url: page.url(), anchors: await page.evaluate(() => Object.fromEntries(["po-confirm", "hanjin-step-1", "hanjin-step-3", "shipment-output-set"].map(id => [id, document.getElementById(id)?.getBoundingClientRect().top]))).catch(() => ({})), shipmentPreviews, previews, scrollY: await page.evaluate(() => window.scrollY).catch(() => 0) }));
    await page.screenshot({ path: path.join(output, "navigation-failure.png") }).catch(() => {});
    throw error;
  } finally { await context.close(); currentPage = null; }
}

const output = process.env.NOIDB_BROWSER_OUTPUT || "tmp/outbound-navigation-browser-check";
async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: process.env.NOIDB_TEST_BROWSER || "chrome" });
  try {
    for (const width of [390, 1920]) {
      await runCase(browser, width, { number: 1, generationId: generations[0].generationId, anchor: "hanjin-step-3", label: "Shipment 묶음 1 계속하기", selectOther: width === 390 });
      await runCase(browser, width, { number: 2, generationId: generations[1].generationId, anchor: "shipment-output-set", label: "묶음 2 · Shipment 출력세트" });
      await runCase(browser, width, { generationId: "GEN-DOES-NOT-EXIST", anchor: "hanjin-step-3", label: "잘못된 묶음 연결 검증", invalid: true });
    }
    assert.deepEqual(forbidden, []); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, apiIsolation: true, fileGeneration: 0, operatingWrites: 0, savedGenerations: 3, results }));
  } catch (error) {
    if (currentPage) await currentPage.screenshot({ path: path.join(output, "navigation-failure.png") }).catch(() => {});
    console.error(JSON.stringify({ forbidden, errors, results }));
    throw error;
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
