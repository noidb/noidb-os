// Isolated browser regression. All business API traffic is intercepted; no operating data is changed.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require(require.resolve("playwright", { paths: [process.env.NOIDB_TEST_DEPENDENCIES || process.cwd()] }));
const base = process.env.NOIDB_TEST_URL || "http://localhost:3114";
const codes = ["R203509890009", "R016220590020", "R202602840022", "R015747670005", "R233587950001", "R216001780001", "R016220590007", "R016182040002", "R208367560003", "R214045040001", "R015747630003", "R203509340006", "R203509370009", "R204152670021", "R208367550002", "R226628310005", "R205742720001", "R205787100002", "R205787160008", "R203818230001", "R202602600006"];
const results = codes.map((barcode, i) => ({ purchaseOrderNumber: "140000001", skuId: String(80000000 + i), barcode, productName: "써지컬스틸 여성 반지, 실버, 25호", optionName: "실버, 25호", fulfillmentCenter: "대구3", expectedDate: "2026-09-04" }));

async function main() {
  const browser = await chromium.launch({ headless: true, channel: process.env.NOIDB_TEST_BROWSER || "chrome" });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, acceptDownloads: true });
  const page = await context.newPage();
  const failures = [];
  page.on("pageerror", error => failures.push(error.message));
  let submitted;
  await context.route("**/api/**", async route => {
    const request = route.request();
    if (request.url().includes("/api/wms/reprint/barcode")) {
      if (request.method() === "POST") {
        submitted = request.postDataJSON();
        return route.fulfill({ status: 200, body: "fixture workbook", headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": "attachment; filename=fixture.xlsx" } });
      }
      const terms = new URL(request.url()).searchParams.get("q").split(/[\n,]+/);
      return route.fulfill({ json: { results: results.filter(item => terms.some(term => item.barcode.includes(term))), unmatchedTerms: terms.filter(term => !results.some(item => item.barcode.includes(term))) } });
    }
    return route.fulfill({ status: 200, json: { configured: false, items: [], waves: [], drafts: [], shipments: [], records: [], results: [], data: [], errors: [], orders: [], addedPurchaseOrderNumbers: [], updatedPurchaseOrderNumbers: [], skippedDuplicatePurchaseOrderNumbers: [], updatedScheduleChanges: [], totalPurchaseOrders: 0, totalSkuTypes: 0, totalQuantity: 0 } });
  });
  const waitList = async n => { await page.waitForFunction(n => document.querySelectorAll('input[type="checkbox"]').length === n, n); };
  const find = async text => { await page.locator("#barcode-query").fill(text); await page.getByRole("button", { name: "찾아서 목록에 추가", exact: true }).click(); await page.waitForFunction(() => !document.querySelector("#barcode-query").disabled); };
  try {
    await page.goto(base + "/wms/reprint");
    await find(codes.slice(0, 20).join("\n")); await waitList(20);
    await page.getByRole("spinbutton", { name: codes[0] + " 출력 장수", exact: true }).fill("3");
    await find(codes[20]); await waitList(21);
    await page.getByRole("button", { name: "전체해제", exact: true }).click();
    assert.equal(await page.locator('input[type="checkbox"]:checked').count(), 0);
    assert.equal(await page.locator("article").count(), 21);
    await page.getByRole("button", { name: "전체선택", exact: true }).click();
    assert.equal(await page.locator('input[type="checkbox"]:checked').count(), 21);
    await page.getByRole("checkbox", { name: codes[1] + " 선택", exact: true }).uncheck();
    await page.reload(); await waitList(21);
    assert.equal(await page.locator("#barcode-query").inputValue(), codes[20]);
    assert.equal(await page.getByRole("spinbutton", { name: codes[0] + " 출력 장수", exact: true }).inputValue(), "3");
    assert.equal(await page.locator('input[type="checkbox"]:checked').count(), 20);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "선택 바코드 한 파일로 저장", exact: true }).click();
    await download;
    assert.equal(submitted.items.length, 20); assert.equal(submitted.items[0].quantity, 3);
    assert.equal(await page.locator("article").count(), 21);
    await page.getByRole("button", { name: "목록 비우기", exact: true }).click(); await waitList(0);
    await page.getByRole("button", { name: "방금 지운 목록 복원", exact: true }).click(); await waitList(21);

    // The photo is optional in CI; when supplied, exercise a real file drop and the actual WASM decoder.
    let photoCount = null, photoSeconds = null;
    if (process.env.NOIDB_PHOTO_TEST_PATH) {
      await page.getByRole("button", { name: "목록 비우기", exact: true }).click();
      const bytes = await fs.readFile(process.env.NOIDB_PHOTO_TEST_PATH);
      const transfer = await page.evaluateHandle(({ base64 }) => {
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const dt = new DataTransfer(); dt.items.add(new File([bytes], "labels.png", { type: "image/png" })); return dt;
      }, { base64: bytes.toString("base64") });
      const started = Date.now();
      const dropzone = page.getByRole("button", { name: /사진을 여기로 드래그앤드롭/ });
      assert.equal(await dropzone.evaluate(el => getComputedStyle(el).borderTopStyle), "dashed");
      await dropzone.dispatchEvent("drop", { dataTransfer: transfer });
      await page.waitForFunction(() => !document.querySelector("#barcode-query").disabled, { }, { timeout: 300000 });
      photoCount = await page.locator('input[type="checkbox"]').count();
      photoSeconds = Math.round((Date.now() - started) / 1000);
      const recognized = (await page.locator("#barcode-query").inputValue()).split("\n");
      console.log("ACTUAL_PHOTO", JSON.stringify({ detected: photoCount, missing: codes.filter(code => !recognized.includes(code)), extra: recognized.filter(code => !codes.includes(code)), status: await page.locator(".photo-results").innerText().catch(() => ""), error: await page.getByRole("alert").allTextContents() }));
      assert.equal(photoCount, 21, "Provided 21-label reference photo must resolve all 21 exact barcodes");
      assert.deepEqual([...recognized].sort(), [...codes].sort(), "Printed-text OCR must not add phantom barcode numbers");
      await dropzone.dispatchEvent("drop", { dataTransfer: transfer });
      await page.getByRole("button", { name: "사진 읽기 중단", exact: true }).click();
      await page.waitForFunction(() => !document.querySelector("#barcode-query").disabled);
      assert.equal(await page.locator("article").count(), 21, "Cancelling another photo must preserve the accumulated list");
    }
    await page.getByRole("button", { name: "전체선택", exact: true }).click();
    const widths = [360, 390, 412, 430, 1920];
    const outputDir = process.env.NOIDB_BROWSER_OUTPUT || "tmp/reprint-browser-check";
    await fs.mkdir(outputDir, { recursive: true });
    for (const width of widths) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 1080 });
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "overflow at " + width);
      assert.equal(await page.evaluate(() => [...document.querySelectorAll("main *, .save-bar *")].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1); }).length), 0, "clipped element at " + width);
      await page.screenshot({ path: path.join(outputDir, "reprint-" + width + ".png"), fullPage: false });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 1150));
    await page.waitForTimeout(100);
    const before = await page.evaluate(() => window.scrollY);
    // Header HOME is above viewport. Programmatic DOM click avoids auto-scroll before navigation.
    await page.locator('a[href="/wms/work-center"]').evaluate(link => link.click());
    await page.waitForURL("**/wms/work-center"); await page.goBack(); await waitList(21);
    await page.waitForFunction(expected => Math.abs(window.scrollY - expected) < 5, before);
    const after = await page.evaluate(() => window.scrollY);
    // Native navigation from reprint to another WMS route, then actual shared Back button.
    await page.evaluate(() => { const link = document.createElement("a"); link.href = "/wms/reprint?roundtrip=1"; document.body.append(link); link.click(); });
    await page.waitForURL("**/wms/reprint?roundtrip=1"); await waitList(21);
    await page.getByRole("button", { name: "← 뒤로가기", exact: true }).click();
    await page.waitForURL(url => url.pathname === "/wms/reprint" && !url.search);
    await page.waitForFunction(expected => Math.abs(window.scrollY - expected) < 5, before);
    assert.equal(failures.length, 0, failures.join("\n"));
    console.log(JSON.stringify({ passed: true, fixtures: "isolated API", list: 21, deselectPreservesList: true, quantities: true, downloadSelectedOnly: true, restoreOnReload: true, photoCount, photoSeconds, widths, backScroll: { before, after } }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
