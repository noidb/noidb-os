const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require("C:/Users/noidb/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const { createHarness, state, snapshot } = require("./verify-weekly-work-route.cjs");

(async () => {
  const h = createHarness();
  const source = snapshot();
  source.id = "weekly-browser-completion";
  source.vendorItems = [
    ["2001", "거래처 주문 검증", "order"],
    ["3001", "미납 재발주 검증", "reorder"],
    ["4001", "단종 신청 검증", "discontinue"],
    ["38256624", "단종 등록 보류 상품", "hold"],
  ].map(([skuId, productName]) => ({ ...source.vendorItems[0], skuId, productName, discontinued: skuId === "38256624", shortageQuantity: 5, confirmedQuantity: 8, receivedQuantity: 3, suggestedQuantity: 12, relatedPurchaseOrderNumbers: ["139000001"], shortageDetails: [{ purchaseOrderNumber: "139000001", confirmedQuantity: 8, receivedQuantity: 3, shortageQuantity: 5 }], issues: ["사용 가능한 현재고를 확인한 뒤 주문 수량을 설정해 주세요."] }));
  const workspace = state.emptyWeeklyWorkspace();
  const run = state.addWeeklyRun(workspace, source);
  run.reviews["3001"].decision = "reorder";
  run.reviews["4001"].decision = "discontinue";
  run.generated = h.makeOutput(run, "all").generated;
  h.installRun(run);
  const errors = [], unexpected = [], statusCalls = [];
  fs.mkdirSync("outputs/weekly-completion-20260908", { recursive: true });
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname === "/api/wms/image-proxy") return route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="#eee8da"/><circle cx="120" cy="120" r="65" fill="none" stroke="#b89a60" stroke-width="12"/></svg>' });
      let response;
      if (url.pathname === "/api/wms/weekly-work") {
        if (request.method() === "GET") response = await h.route.GET();
        else { const data = request.postDataJSON(); if (data.action === "status") statusCalls.push(data.kind); response = await h.post(data); }
      } else if (url.pathname === "/api/wms/weekly-work/advertising") response = { status: 200, body: { success: true, ...h.selectionFor(h.current()) } };
      else { unexpected.push(request.method() + " " + url.pathname); response = { status: 404, body: { success: false, error: "Unexpected test API" } }; }
      return route.fulfill({ status: response.status, contentType: "application/json", body: JSON.stringify(response.body) });
    });
    await page.goto("http://localhost:3000/wms/inbound", { waitUntil: "domcontentloaded", timeout: 90000 });
    const reviews = page.locator('[aria-labelledby="weekly-review-title"]');
    await reviews.getByRole("button", { name: /^전체 / }).click({ timeout: 90000 });
    await reviews.getByRole("heading", { name: "거래처 주문 검증", exact: true }).waitFor();
    assert.equal(await reviews.locator("article").count(), 4, "Generating files alone must leave tasks active");
    assert.equal(await page.getByRole("button", { name: "쿠폰·광고 파일 받기 ↓", exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: /처리한 항목 완료 표시로 이동/ }).count(), 0, "The scroll-only completion action is removed");
    assert.equal(await reviews.getByText("거래처에 주문할 수량", { exact: true }).count(), 0);
    assert.equal(await reviews.getByText("추가 주문 제안", { exact: true }).count(), 0);
    assert.equal(await reviews.getByText(/기존 주문과 배송 진행 상태를 확인했으며/).count(), 0);
    const blocked = reviews.locator("article").filter({ hasText: "SKU 38256624" });
    assert.equal(await blocked.locator('option[value="order"]').evaluate(option => option.disabled), true);
    assert.match(await blocked.innerText(), /단종으로 등록된 상품이라 거래처 발주를 선택할 수 없습니다/);
    assert.equal(await blocked.getByRole("link", { name: /단종·해제 관리/ }).getAttribute("href"), "/wms/vendor-orders/status-requests");
    assert(await page.getByRole("button", { name: "거래처 발주대기로 이동 →", exact: true }).isEnabled());
    await page.screenshot({ path: "outputs/weekly-completion-20260908/before-desktop.png", fullPage: true });

    const complete = async (name, sku) => {
      await page.getByRole("button", { name, exact: true }).click();
      await page.getByText("처리 완료를 저장했습니다. 완료한 항목은 목록에서 제외하고 아래 완료 이력에 보관했습니다.", { exact: true }).waitFor();
      if (sku) await page.waitForFunction(id => ![...document.querySelectorAll('[aria-labelledby="weekly-review-title"] article')].some(element => element.textContent.includes("SKU " + id)), sku);
    };
    await complete("쿠폰·광고 등록 완료");
    assert.equal(await page.locator('[aria-labelledby="weekly-coupon-title"]').count(), 0);
    assert.equal(await page.locator('[class*="outputChoices"]').getByText("30% 쿠폰·광고등록 엑셀", { exact: true }).count(), 0);
    await complete("거래처 주문 완료", "2001");
    await complete("쿠팡 재발주 요청 완료", "3001");
    await complete("쿠팡 단종 신청 완료", "4001");
    assert.equal(await reviews.locator("article").count(), 1);
    assert.equal(await page.locator('[class*="outputChoices"] label').count(), 0);
    await page.reload({ waitUntil: "domcontentloaded" });
    await reviews.getByRole("button", { name: /^전체 / }).click({ timeout: 30000 });
    assert.equal(await reviews.locator("article").count(), 1, "Completed rows remain hidden after reload");
    assert.equal(await page.locator('[aria-labelledby="weekly-coupon-title"]').count(), 0);
    const history = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^처리 완료 이력/ }) }).first();
    await history.locator("summary").first().click();
    assert.match(await history.innerText(), /SKU 2001/);
    assert.match(await history.innerText(), /SKU 3001/);
    assert.match(await history.innerText(), /SKU 4001/);
    await page.screenshot({ path: "outputs/weekly-completion-20260908/after-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "outputs/weekly-completion-20260908/after-mobile.png", fullPage: true });
    assert(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "No 390px horizontal overflow");
    assert.deepEqual(statusCalls, ["coupon", "vendor", "reorder", "discontinue"]);
    assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
    fs.writeFileSync("outputs/weekly-completion-20260908/results.json", JSON.stringify({ passed: true, statusCalls, checks: ["downloads retain active tasks", "all four explicit completion buttons remove active rows and files", "reload preserves completion", "history retains records", "discontinued order block explained", "redundant quantity and shortcut controls removed", "390px no overflow"], errors, unexpected }, null, 2));
    console.log("PASS weekly completion browser: real UI/API status, completed task and file removal, reload, history, discontinued reason, simplified controls, mobile.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
