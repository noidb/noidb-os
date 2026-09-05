// Full UI flow with browser API fixtures only. No live Sheets/Blob API is forwarded.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require(require.resolve("playwright", { paths: [process.env.NOIDB_TEST_DEPENDENCIES || process.cwd()] }));
const base = process.env.NOIDB_TEST_URL || "http://127.0.0.1:3114", origin = new URL(base);
if (!["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) throw new Error("Vendor fixtures are localhost-only.");
const now = "2026-09-05T01:00:00.000Z", sku = "80000001", waveId = "WAVE-FIXTURE-DELAY", nextWaveId = "WAVE-FIXTURE-NEXT";
const firstVendor = "검증거래처", nextVendor = "변경거래처", sentVendor = "전송거래처";
const wave = id => ({ id, displayName: "격리 검증 출고작업", status: "in_progress", workerName: "fixture", sourcePurchaseOrderNumbers: ["140000001"], completedGroupIds: [], createdAt: now, updatedAt: now });
const item = id => ({ id: `${id}-${sku}`, waveId: id, productCode: sku, productName: "검증 반지, 실버, 20호", barcode: "R100000000001", modelName: "MODEL1", modelSku: "MODEL1-SI", optionLabel: "실버, 20호", vendorName: firstVendor, totalQuantity: 5, sources: [{ purchaseOrderNumber: "140000001", basketNumber: "1", requestedQuantity: 5 }], locationStatus: "unlocated", modelSortKey: "MODEL1", locationSortKey: "", status: "pending", pickedQuantity: 0, shortageQuantity: 0, allocations: [], createdAt: now, updatedAt: now });
const line = { id: `${waveId}::${firstVendor}::${sku}`, draftId: `${waveId}::${firstVendor}`, waveId, vendorName: firstVendor, skuId: sku, productName: "검증 반지, 실버, 20호", modelName: "MODEL1", optionLabel: "실버, 20호", category: "반지", barcode: "R100000000001", imageUrl: "", currentStock: "0", actualShortageQuantity: 3, shortageQuantity: 17, relatedPurchaseOrderNumbers: ["140000001"], memo: "목걸이만", isManuallyAdded: true, createdAt: now, updatedAt: now };
const sentDraft = { id: `${waveId}::${sentVendor}`, waveId, vendorName: sentVendor, status: "sent", sentAt: now, statusBeforeSent: "approved", createdAt: now, updatedAt: now };
const sentLine = { ...line, id: `${sentDraft.id}::80000002`, draftId: sentDraft.id, vendorName: sentVendor, skuId: "80000002", productName: "전송완료 귀걸이, 골드", optionLabel: "골드" };
const snapshot = { schemaVersion: 1, revision: 1, updatedAt: now, waves: [wave(waveId), wave(nextWaveId)], items: [item(waveId), item(nextWaveId)], baskets: [waveId, nextWaveId].map(id => ({ waveId: id, basketNumber: "1", purchaseOrderNumber: "140000001", fulfillmentCenter: "대구3", status: "pending", createdAt: now, updatedAt: now })), vendorOrderDrafts: [{ ...sentDraft, id: line.draftId, vendorName: firstVendor, status: "draft", sentAt: undefined, statusBeforeSent: undefined }, sentDraft], vendorOrderLines: [line, sentLine], poConfirmationRecords: [], warehouseZones: [], warehouseShelves: [], warehouseBoxes: [], warehouseModelLocations: [], warehouseSkuExceptions: [], warehouseMigrationMappings: [], shipments: [], deletedWaveIds: {}, deletedItemIds: {}, deletedBasketKeys: {}, deletedPoConfirmationNumbers: {}, deletedVendorDraftIds: {}, deletedVendorLineIds: {}, deletedWarehouseSkuIds: {}, deletedShipmentIds: {}, completedCreateOperations: {}, completedShipmentCreateOperations: {}, outboundWorkStates: {} };
const catalog = [{ skuId: sku, modelSku: "MODEL1-SI", modelName: "MODEL1", productName: line.productName, optionLabel: line.optionLabel, category: "반지", vendorName: firstVendor, warehouseNumber: "여성반지-1", imageUrl: "", productLink: "", currentStock: "20", barcode: line.barcode }];
const delays = new Map(), delayWrites = [], sharedWrites = [], catalogWrites = [], failures = [];
function upsert(key, value) { const index = snapshot[key].findIndex(item => item.id === value.id); if (index < 0) snapshot[key].push(structuredClone(value)); else snapshot[key][index] = structuredClone(value); snapshot.revision += 1; }
async function isolated(browser, width) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: "block" });
  await context.addInitScript(() => { try { localStorage.setItem("noidb_picking_wave_shared_migration_v1", "fixture"); localStorage.setItem("noidb_vendor_order_shared_migration_v1", "fixture"); } catch {} });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (url.origin !== origin.origin) return route.abort();
    if (!url.pathname.startsWith("/api/")) { if (method === "GET") return route.continue(); failures.push(`${method} ${url.pathname}`); return route.abort(); }
    if (url.pathname === "/api/wms/vendor-order-actions") {
      if (method === "GET") return route.fulfill({ json: { success: true, delaySummaries: [...delays.values()], statusRequests: [], statusFileGenerations: [] } });
      const body = request.postDataJSON(); assert.equal(body.action, "delay"); assert.equal(body.skuId, sku); assert.equal(body.optionLabel, "실버, 20호");
      const previous = delays.get(sku); assert.equal(body.expectedLastActionAt, previous?.lastActionAt || null);
      delayWrites.push(body); const at = `2026-09-05T15:0${delayWrites.length}:00.000Z`;
      const summary = { skuId: sku, recentDelayedAt: body.delayed ? at : previous.recentDelayedAt, active: body.delayed, lastActionAt: at, vendorName: body.vendorName, memo: body.memo };
      delays.set(sku, summary); return route.fulfill({ json: { success: true, summary } });
    }
    if (url.pathname === "/api/wms/picking-waves") {
      if (method !== "GET") { const body = request.postDataJSON(); sharedWrites.push(body); if (body.action === "saveVendorDraft") upsert("vendorOrderDrafts", body.draft); else if (body.action === "saveVendorLine") upsert("vendorOrderLines", body.line); else { failures.push(body.action); return route.fulfill({ status: 400, json: { ok: false } }); } }
      return route.fulfill({ json: { ok: true, snapshot } });
    }
    if (url.pathname === "/api/wms/product-catalog/update" && method === "POST") {
      const body = request.postDataJSON(); assert.deepEqual(body, { skuId: sku, vendorName: nextVendor }); catalogWrites.push(body); catalog[0].vendorName = body.vendorName;
      return route.fulfill({ json: { success: true, updatedFields: ["vendorName"] } });
    }
    if (method !== "GET") { failures.push(`${method} ${url.pathname}`); return route.fulfill({ status: 400, json: { success: false } }); }
    if (url.pathname === "/api/wms/product-catalog") return route.fulfill({ json: { configured: true, items: catalog } });
    return route.fulfill({ json: { success: true, configured: false, items: [], orders: [], records: [], results: [], data: [], statusRequests: [], delaySummaries: [], statusFileGenerations: [] } });
  });
  context.on("page", page => { page.on("pageerror", error => failures.push(error.message)); page.on("dialog", dialog => dialog.accept()); page.on("download", () => failures.push("Unexpected download")); });
  return context;
}
async function main() {
  const browser = await chromium.launch({ headless: true, channel: process.env.NOIDB_TEST_BROWSER || "chrome" });
  const output = process.env.NOIDB_BROWSER_OUTPUT || "tmp/vendor-delay-browser-check"; await fs.mkdir(output, { recursive: true });
  const context = await isolated(browser, 390), page = await context.newPage(); page.setDefaultTimeout(20000);
  const url = `${base}/wms/picking/waves/${waveId}/vendor-orders`, card = () => page.locator(`[data-vendor-sku="${sku}"]`);
  try {
    await page.goto(url); await card().getByRole("button", { name: "입고지연", exact: true }).waitFor();
    assert.equal(sharedWrites.length, 0); assert.equal(delayWrites.length, 0);
    await card().getByRole("button", { name: "입고지연", exact: true }).click();
    await page.getByRole("dialog", { name: "입고지연 등록", exact: true }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "입고지연 메모", exact: true }).inputValue(), "목걸이만");
    await page.getByRole("button", { name: "취소", exact: true }).last().click(); assert.equal(delayWrites.length, 0);
    await card().getByRole("button", { name: "입고지연", exact: true }).click();
    await page.getByRole("textbox", { name: "입고지연 메모", exact: true }).fill("다음 주 금요일 입고");
    for (const width of [360, 390, 412, 430, 1920]) { await page.setViewportSize({ width, height: width < 500 ? 844 : 1080 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `dialog overflow ${width}`); const rect = await page.getByRole("dialog").boundingBox(); assert(rect.x >= 0 && rect.x + rect.width <= width); await page.screenshot({ path: path.join(output, `delay-dialog-${width}.png`) }); }
    await page.getByRole("button", { name: "입고지연 저장", exact: true }).click(); await page.getByRole("dialog").waitFor({ state: "hidden" });
    await card().getByText("입고지연 · 2026-09-06", { exact: true }).waitFor(); assert.equal(delayWrites.length, 1); assert.equal(sharedWrites.length, 0); assert.equal(snapshot.vendorOrderLines[0].shortageQuantity, 17);

    const nextContext = await isolated(browser, 390), pickingPage = await nextContext.newPage();
    await pickingPage.goto(`${base}/wms/picking/waves/${nextWaveId}`);
    await pickingPage.locator(`[data-picking-sku="${sku}"]`).getByText("입고지연 · 2026-09-06 · 다음 주 금요일 입고", { exact: true }).waitFor();
    await pickingPage.screenshot({ path: path.join(output, "next-picking-delay-390.png") });

    await page.setViewportSize({ width: 390, height: 844 });
    await card().getByRole("spinbutton").fill("19"); await card().getByPlaceholder("메모", { exact: true }).fill("목걸이만 19개");
    await card().getByRole("button", { name: "거래처 수정", exact: true }).click(); await card().getByPlaceholder("거래처", { exact: true }).fill(nextVendor);
    await card().getByRole("button", { name: "수정 저장", exact: true }).click();
    await page.getByRole("heading", { name: new RegExp(`^${nextVendor}`) }).waitFor();
    assert.equal(catalogWrites.length, 1); assert.equal(sharedWrites.filter(body => body.action === "saveVendorDraft").length, 1); assert.equal(sharedWrites.filter(body => body.action === "saveVendorLine").length, 1);
    assert.equal(snapshot.vendorOrderLines.length, 2); assert.equal(snapshot.vendorOrderLines[0].id, line.id); assert.equal(snapshot.vendorOrderLines[0].shortageQuantity, 19); assert.equal(snapshot.vendorOrderLines[0].memo, "목걸이만 19개"); assert.equal(snapshot.vendorOrderLines[0].vendorName, nextVendor); assert.deepEqual(snapshot.vendorOrderDrafts.find(draft => draft.id === sentDraft.id), sentDraft); assert.deepEqual(snapshot.vendorOrderLines.find(value => value.id === sentLine.id), sentLine);
    await page.reload(); await page.getByRole("heading", { name: new RegExp(`^${nextVendor}`) }).waitFor(); assert.equal(await card().getByRole("spinbutton").inputValue(), "19"); assert.equal(await card().getByPlaceholder("메모", { exact: true }).inputValue(), "목걸이만 19개"); await page.getByRole("button", { name: "전송완료 해제", exact: true }).waitFor();
    await card().getByRole("button", { name: "입고지연 해제", exact: true }).click(); await page.getByRole("textbox", { name: "입고지연 메모", exact: true }).fill("입고 확인"); await page.getByRole("button", { name: "지연 해제 저장", exact: true }).click(); await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(delayWrites.length, 2); assert.equal(delayWrites[1].vendorName, nextVendor); assert.equal(delays.get(sku).active, false); assert.equal(sharedWrites.length, 2);
    await pickingPage.evaluate(() => window.dispatchEvent(new Event("focus")));
    await pickingPage.waitForFunction(id => !(document.querySelector(`[data-picking-sku="${id}"]`)?.innerText || "").includes("입고지연"), sku);
    await page.screenshot({ path: path.join(output, "vendor-moved-and-released-390.png") });
    assert.deepEqual(failures, []); await nextContext.close();
    console.log(JSON.stringify({ passed: true, apiIsolation: true, previewCancelWrites: 0, delayEvents: 2, nextWaveCrossDeviceDate: "2026-09-06", releasePropagated: true, vendorMovedWithoutReload: true, reloadPreservedQuantity: 19, memoPreserved: true, sentStateUntouched: true, movedLineIdPreserved: true, sharedMoveWrites: 2, widths: [360, 390, 412, 430, 1920], operatingWrites: 0 }));
  } catch (error) { await page.screenshot({ path: path.join(output, "vendor-delay-failure.png") }).catch(() => {}); console.error(JSON.stringify({ failures, delayWrites, sharedWrites, alerts: await page.getByRole("alert").allTextContents() })); throw error; }
  finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
