// Actual React pages with isolated API fixtures. Never forward a business API request.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require(require.resolve("playwright", { paths: [process.env.NOIDB_TEST_DEPENDENCIES || process.cwd()] }));
const base = process.env.NOIDB_TEST_URL || "http://localhost:3114";
const baseUrl = new URL(base);
if (!["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname)) throw new Error("Picking browser fixtures are localhost-only.");

const waveId = "WAVE-FIXTURE-PICKING";
const now = "2026-09-05T01:00:00.000Z";
const poNumbers = ["140000001", "140000002"];
const wave = {
  id: waveId, displayName: "격리 검증 출고작업", workerName: "브라우저 fixture", status: "in_progress",
  sourcePurchaseOrderNumbers: poNumbers, completedGroupIds: [], productDbConfigured: true, createdAt: now, updatedAt: now,
  outputGenerations: [{ generationId: "GEN-FIXTURE-1", waveId, purchaseOrderNumbers: [poNumbers[0]], createdAt: now, updatedAt: now, expectedShippingGroupCount: 1, invoiceFileName: "fixture-invoice.xlsx", status: "invoice_generated" }],
};
const items = Array.from({ length: 45 }, (_, index) => {
  const sku = String(80000000 + index);
  return {
    id: `${waveId}-${sku}`, waveId, productCode: sku, productName: `검증 반지 ${index + 1}, 실버, 20호`, barcode: `R${String(100000000000 + index)}`,
    modelName: `MODEL${index + 1}`, modelSku: `MODEL${index + 1}-SI`, optionLabel: "실버, 20호", category: "반지", gender: "여성", vendorName: "검증거래처",
    imageUrl: `https://fixture-images.invalid/old-${sku}.png`, catalogWarehouseNumber: `귀걸이A-${index + 1}`, catalogBarcode: `R${String(100000000000 + index)}`,
    totalQuantity: 5, sources: [{ purchaseOrderNumber: poNumbers[0], basketNumber: "1", requestedQuantity: 2 }, { purchaseOrderNumber: poNumbers[1], basketNumber: "2", requestedQuantity: 3 }],
    locationStatus: "unlocated", modelSortKey: `MODEL${index + 1}`, locationSortKey: "", status: "pending", pickedQuantity: 0, shortageQuantity: 0, allocations: [], createdAt: now, updatedAt: now,
  };
});
const catalog = items.map(item => ({
  skuId: item.productCode, modelSku: item.modelSku, modelName: item.modelName, category: item.category, gender: item.gender,
  productName: item.productName, optionLabel: item.optionLabel, imageUrl: "", warehouseNumber: item.catalogWarehouseNumber, boxNumber: "", currentStock: "20", currentStatus: "", costVatIncluded: "1000",
  vendorName: item.vendorName, barcode: item.barcode, countryOfOrigin: "중국", productLink: `https://fixture-products.invalid/${item.productCode}`,
}));
const snapshot = {
  schemaVersion: 1, revision: 0, updatedAt: now, waves: [structuredClone(wave)], items: structuredClone(items),
  baskets: poNumbers.map((purchaseOrderNumber, index) => ({ basketNumber: String(index + 1), purchaseOrderNumber, fulfillmentCenter: "대구3", waveId, status: "pending", createdAt: now, updatedAt: now })),
  poConfirmationRecords: [], vendorOrderDrafts: [], vendorOrderLines: [], warehouseZones: [], warehouseShelves: [], warehouseBoxes: [], warehouseModelLocations: [], warehouseSkuExceptions: [], warehouseMigrationMappings: [], shipments: [],
  deletedWaveIds: {}, deletedItemIds: {}, deletedBasketKeys: {}, deletedPoConfirmationNumbers: {}, deletedVendorDraftIds: {}, deletedVendorLineIds: {}, deletedWarehouseSkuIds: {}, deletedShipmentIds: {}, completedCreateOperations: {}, completedShipmentCreateOperations: {}, outboundWorkStates: {},
};
const mutations = [];
const unexpectedMutations = [];
const externalRequests = [];
const pageErrors = [];
const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=", "base64");

function upsert(key, incoming) {
  const index = snapshot[key].findIndex(value => value.id === incoming.id);
  if (index < 0) snapshot[key].push(structuredClone(incoming));
  else if ((incoming.updatedAt || incoming.createdAt) > (snapshot[key][index].updatedAt || snapshot[key][index].createdAt)) snapshot[key][index] = structuredClone(incoming);
}
function applyFixtureMutation(body) {
  mutations.push(structuredClone(body));
  if (body.action === "saveProgress") {
    assert.equal(body.wave.id, waveId);
    assert(body.items.every(item => item.waveId === waveId));
    body.items.forEach(item => upsert("items", item));
    upsert("waves", body.wave);
  } else if (body.action === "saveVendorDraft") upsert("vendorOrderDrafts", body.draft);
  else if (body.action === "saveVendorLine") upsert("vendorOrderLines", body.line);
  else throw new Error(`Unexpected fixture mutation: ${body.action}`);
  snapshot.revision += 1;
  snapshot.updatedAt = new Date().toISOString();
}
async function isolateContext(browser, viewport) {
  const context = await browser.newContext({ viewport, serviceWorkers: "block" });
  await context.addInitScript(() => {
    // Avoid the existing browser-to-shared-store first-use migration in this fresh fixture context.
    // Playwright also evaluates init scripts in the initial opaque about:blank document.
    try {
      localStorage.setItem("noidb_picking_wave_shared_migration_v1", "fixture");
      localStorage.setItem("noidb_vendor_order_shared_migration_v1", "fixture");
    } catch { /* Storage becomes available after navigating to the local app origin. */ }
  });
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) {
      if (url.origin !== baseUrl.origin) {
        externalRequests.push(request.url());
        return route.abort();
      }
      if (url.pathname === "/api/wms/picking-waves") {
        if (request.method() === "POST") {
          try { applyFixtureMutation(request.postDataJSON()); }
          catch (error) { unexpectedMutations.push(error.message); return route.fulfill({ status: 400, json: { ok: false, error: error.message } }); }
        }
        return route.fulfill({ json: { ok: true, snapshot: structuredClone(snapshot) } });
      }
      if (request.method() !== "GET") {
        unexpectedMutations.push(`${request.method()} ${url.pathname}`);
        return route.fulfill({ status: 400, json: { success: false, error: "This isolated test does not permit this mutation." } });
      }
      if (url.pathname === "/api/wms/product-catalog") return route.fulfill({ json: { configured: true, items: catalog } });
      if (url.pathname === "/api/wms/supplier-hub-orders") return route.fulfill({ json: { configured: true, orders: poNumbers.map(purchaseOrderNumber => ({ purchaseOrderNumber, expectedDate: "2026-09-04", fulfillmentCenter: "대구3" })) } });
      if (url.pathname === "/api/wms/image-proxy") return route.fulfill({ contentType: "image/png", body: tinyPng });
      return route.fulfill({ json: { configured: false, success: true, items: [], waves: [], drafts: [], shipments: [], records: [], results: [], data: [], errors: [], orders: [], statusRequests: [], delaySummaries: [], statusFileGenerations: [] } });
    }
    if (url.origin !== baseUrl.origin) {
      externalRequests.push(request.url());
      // Nothing leaves the fixture browser, including product image hosts.
      if (request.resourceType() === "image") return route.fulfill({ contentType: "image/png", body: tinyPng });
      return route.abort();
    }
    if (request.method() !== "GET") {
      unexpectedMutations.push(`${request.method()} ${url.pathname}`);
      return route.abort();
    }
    return route.continue();
  });
  context.on("page", page => page.on("pageerror", error => pageErrors.push(error.message)));
  return context;
}

async function main() {
  const browser = await chromium.launch({ headless: true, channel: process.env.NOIDB_TEST_BROWSER || "chrome" });
  const outputDir = process.env.NOIDB_BROWSER_OUTPUT || "tmp/picking-browser-check";
  await fs.mkdir(outputDir, { recursive: true });
  const context = await isolateContext(browser, { width: 390, height: 844 });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const pickingUrl = `${base}/wms/picking/waves/${waveId}`;
  const vendorUrl = `${pickingUrl}/vendor-orders`;
  const firstSku = items[0].productCode, secondSku = items[1].productCode, anchorSku = items[20].productCode;
  const card = sku => page.locator(`[data-picking-sku="${sku}"]`);
  const waitList = async () => {
    await page.waitForFunction(count => document.querySelectorAll("[data-picking-sku]").length === count, items.length);
    await page.waitForFunction(sku => !document.querySelector(`[data-picking-sku="${sku}"] img`), firstSku);
  };
  const openTransfer = async () => {
    await page.getByRole("button", { name: /^선택 거래처발주로 이동/ }).click();
    await page.getByRole("dialog", { name: "부족수량 확인 · 거래처 발주" }).waitFor({ state: "visible" });
  };
  const setTransfer = async (sku, quantity) => page.getByRole("spinbutton", { name: `SKU ${sku} 부족수량`, exact: true }).fill(String(quantity));
  const submitTransfer = async () => {
    await page.getByRole("button", { name: "부족수량 저장 · 초안 연결", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
  };
  try {
    await page.goto(pickingUrl);
    await waitList();
    assert.equal(mutations.length, 0, "Loading picking must not write fixture state.");
    await page.getByRole("button", { name: "전체선택", exact: true }).click();
    assert.equal(await page.locator('[data-picking-sku] input[type="checkbox"]:checked').count(), items.length);
    await page.getByRole("button", { name: "전체해제", exact: true }).click();
    assert.equal(await page.locator('[data-picking-sku] input[type="checkbox"]:checked').count(), 0);
    await card(firstSku).getByRole("checkbox").check();
    await card(secondSku).getByRole("checkbox").check();

    const beforePreview = structuredClone(snapshot);
    await openTransfer();
    assert.equal(await page.getByRole("spinbutton", { name: `SKU ${firstSku} 부족수량`, exact: true }).inputValue(), "5");
    await setTransfer(firstSku, 3); await setTransfer(secondSku, 0);
    for (const width of [360, 390, 412, 430, 1920]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 1080 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `dialog overflow at ${width}`);
      const bounds = await page.getByRole("dialog").boundingBox();
      assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `dialog clipped at ${width}`);
      await page.screenshot({ path: path.join(outputDir, `picking-transfer-${width}.png`) });
    }
    await page.getByRole("button", { name: "취소", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.deepEqual(snapshot, beforePreview, "Preview and cancel must not save picking or vendor rows.");
    assert.equal(mutations.length, 0);

    await page.setViewportSize({ width: 390, height: 844 });
    await openTransfer(); await setTransfer(firstSku, 3); await setTransfer(secondSku, 0); await submitTransfer();
    const progressWrites = mutations.filter(body => body.action === "saveProgress");
    assert.equal(progressWrites.length, 1);
    assert.deepEqual(progressWrites[0].items.map(item => item.productCode), [firstSku]);
    assert.equal(snapshot.items.find(item => item.productCode === firstSku).shortageQuantity, 3);
    assert.equal(snapshot.items.find(item => item.productCode === firstSku).pickedQuantity, 2);
    assert.deepEqual(snapshot.items.filter(item => item.productCode !== firstSku), beforePreview.items.filter(item => item.productCode !== firstSku));
    assert.equal(snapshot.waves[0].status, "in_progress");
    assert.deepEqual(snapshot.waves[0].outputGenerations, wave.outputGenerations);
    assert.equal(snapshot.vendorOrderLines.length, 1);
    assert.equal(snapshot.vendorOrderDrafts.length, 1);
    assert.equal(snapshot.vendorOrderLines[0].shortageQuantity, 12);
    assert.equal(snapshot.vendorOrderLines[0].optionLabel, "실버, 20호");
    const afterTransferCount = mutations.length;
    await openTransfer(); await setTransfer(secondSku, 0); await submitTransfer();
    assert.equal(mutations.length, afterTransferCount, "Retrying an identical transfer must not save or duplicate any rows.");
    assert.equal(snapshot.vendorOrderLines.length, 1);

    await page.getByRole("button", { name: "전체해제", exact: true }).click();
    await card(firstSku).getByRole("checkbox").check();
    await card(anchorSku).getByRole("checkbox").check();
    await card(anchorSku).evaluate(element => window.scrollBy(0, element.getBoundingClientRect().top - 140));
    // Capture and click in one browser task. Lazy layout can change the card position between
    // separate evaluate round trips; the position at the actual click is the return contract.
    const beforePosition = await card(anchorSku).evaluate(element => {
      const before = { scrollY: window.scrollY, offset: element.getBoundingClientRect().top };
      element.querySelectorAll("button")[1].click();
      return before;
    });
    await page.waitForURL(url => url.pathname === `/wms/products/${anchorSku}`);
    await page.getByRole("heading", { name: "상품정보 확인·수정", exact: true }).waitFor();
    await page.getByRole("button", { name: "← 목록으로 돌아가기", exact: true }).click();
    await page.waitForURL(url => url.pathname === `/wms/picking/waves/${waveId}`);
    await waitList();
    await page.waitForFunction(({ sku, offset }) => { const element = document.querySelector(`[data-picking-sku="${sku}"]`); return element && Math.abs(element.getBoundingClientRect().top - offset) < 6; }, { sku: anchorSku, offset: beforePosition.offset });
    assert.equal(await card(firstSku).getByRole("checkbox").isChecked(), true);
    assert.equal(await card(anchorSku).getByRole("checkbox").isChecked(), true);
    assert.equal(await page.locator('[data-picking-sku] input[type="checkbox"]:checked').count(), 2);
    // content-visibility:auto intentionally skips off-screen card layout and innerText.
    // A real scroll gesture also ends the short anchor-settling window, as intended.
    await page.mouse.wheel(0, -1);
    await card(firstSku).scrollIntoViewIfNeeded();
    await page.waitForFunction(sku => (document.querySelector(`[data-picking-sku="${sku}"]`)?.innerText || "").includes("검증 반지"), firstSku);
    assert.equal(await card(firstSku).locator("img").count(), 0, "Blank catalog image must not revive a stored wave image.");
    assert.match(await card(firstSku).innerText(), /이미지\s*없음/);
    // The mobile tap target may be 48px; its fixed image/placeholder area is 44px.
    const imageBounds = await card(firstSku).locator("button").first().locator("div").first().boundingBox();
    assert(imageBounds && imageBounds.width === 44 && imageBounds.height === 44, "Empty image must retain its 44px slot.");
    for (const width of [360, 390, 412, 430, 1920]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 1080 });
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `picking overflow at ${width}`);
      await page.screenshot({ path: path.join(outputDir, `picking-list-${width}.png`) });
    }

    const beforeVendorVisit = mutations.length;
    await page.goto(vendorUrl);
    await page.getByRole("heading", { name: "거래처별 부족분 발주서", exact: true }).waitFor();
    await page.getByPlaceholder("메모", { exact: true }).waitFor();
    assert.equal(mutations.length, beforeVendorVisit, "Opening vendor drafts must not save/recalculate-delete operating rows.");
    assert.equal(await page.getByPlaceholder("메모", { exact: true }).isEditable(), true, "In-progress picking must allow shortage ordering.");
    assert.equal(await page.getByRole("button", { name: "승인", exact: true }).isEnabled(), true);
    assert.equal(await page.getByRole("spinbutton").inputValue(), "12");
    await page.getByRole("spinbutton").fill("17");
    await page.getByPlaceholder("메모", { exact: true }).fill("목걸이만 보내주세요");
    await page.getByRole("button", { name: "승인", exact: true }).click();
    await page.getByRole("button", { name: "전송완료", exact: true }).waitFor();
    assert.equal(snapshot.vendorOrderLines.length, 1);
    assert.equal(snapshot.vendorOrderLines[0].shortageQuantity, 17);
    assert.equal(snapshot.vendorOrderLines[0].memo, "목걸이만 보내주세요");
    await page.getByRole("button", { name: "메시지 미리보기", exact: true }).click();
    const sharedText = await page.locator("pre").innerText();
    assert.match(sharedText, /실버, 20호/);
    assert.doesNotMatch(sharedText, /https?:\/\/|fixture-products/);
    await page.getByRole("button", { name: "전송완료", exact: true }).click();
    await page.getByRole("button", { name: "전송완료 해제", exact: true }).waitFor();
    assert.equal(snapshot.vendorOrderDrafts[0].status, "sent");
    assert(snapshot.vendorOrderDrafts[0].sentAt);
    const beforeReload = mutations.length;
    await page.reload();
    await page.getByRole("button", { name: "전송완료 해제", exact: true }).waitFor();
    assert.equal(mutations.length, beforeReload);
    assert.equal(snapshot.vendorOrderLines.length, 1);
    assert.equal(snapshot.vendorOrderLines[0].shortageQuantity, 17);
    assert.equal(snapshot.vendorOrderLines[0].memo, "목걸이만 보내주세요");

    const mobileContext = await isolateContext(browser, { width: 390, height: 844 });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(vendorUrl);
    await mobilePage.getByRole("button", { name: "전송완료 해제", exact: true }).waitFor();
    assert.equal(mutations.length, beforeReload, "A second device context must read shared sent status without writes.");
    await mobilePage.screenshot({ path: path.join(outputDir, "vendor-shared-sent-390.png") });
    await mobileContext.close();
    assert.deepEqual(unexpectedMutations, []);
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ passed: true, apiIsolation: true, skuCount: items.length, previewCancelNoWrites: true, selectedOnlySave: firstSku, repeatedTransferNoWrites: true, checkedStateRestored: true, scrollAnchorRestored: beforePosition, blankImagePreserved: true, inProgressVendorEditing: true, sentStatusShared: true, manualQuantity: 17, fullOption: "실버, 20호", widths: [360, 390, 412, 430, 1920], interceptedMutations: mutations.length, blockedExternalRequests: externalRequests.length }));
  } catch (error) {
    await page.screenshot({ path: path.join(outputDir, "picking-failure.png"), fullPage: false }).catch(() => {});
    console.error(JSON.stringify({ url: page.url(), alerts: await page.getByRole("alert").allTextContents().catch(() => []), position: await page.evaluate(({ sku, id }) => ({ scrollY: window.scrollY, anchorOffset: document.querySelector(`[data-picking-sku="${sku}"]`)?.getBoundingClientRect().top, saved: sessionStorage.getItem(`noidb_picking_list_state:${id}`) }), { sku: anchorSku, id: waveId }).catch(() => null), unexpectedMutations, pageErrors }));
    throw error;
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
