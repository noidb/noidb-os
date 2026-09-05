// Real inbound page with every business API isolated by fixtures. No Sheet/Drive write is forwarded.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require(require.resolve("playwright", { paths: [process.env.NOIDB_TEST_DEPENDENCIES || process.cwd()] }));

const base = process.env.NOIDB_TEST_URL || "http://127.0.0.1:3114";
const origin = new URL(base);
if (!["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) throw new Error("Inbound browser fixture is localhost-only.");
const output = path.join(process.cwd(), "tmp", "inbound-browser-check");
const errors = [];
const forbidden = [];
const downloads = [];

const dates = ["2026-09-05", "2026-09-04", "2026-09-03", "2026-09-02", "2026-09-01", "2026-08-31", "2026-08-30"];
const results = dates.map((actualDate, index) => ({
  actualDate,
  purchaseOrderCount: 1,
  receivedSkuCount: 1,
  partialSkuCount: 1,
  missingSkuCount: 1,
  couponItems: [{ skuId: String(70000001 + index), productName: `검증상품 ${index + 1}, 실버`, productLink: `https://example.com/${index + 1}` }],
  missingItems: [{
    skuId: String(70000001 + index),
    productName: `검증상품 ${index + 1}, 실버`,
    productLink: actualDate === "2026-09-01" ? "" : `https://example.com/${index + 1}`,
  }],
  nameConflicts: [],
}));

async function runCase(browser, width) {
  const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 1080 }, serviceWorkers: "block" });
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin.origin) return route.abort();
    if (!url.pathname.startsWith("/api/")) {
      if (request.method() === "GET") return route.continue();
      forbidden.push(`${request.method()} ${url.pathname}`);
      return route.abort();
    }
    if (request.method() === "GET" && url.pathname === "/api/wms/inbound-results") {
      return route.fulfill({ json: { success: true, results } });
    }
    if (request.method() === "POST" && url.pathname === "/api/wms/inbound-results") {
      return route.fulfill({
        status: 200,
        contentType: "application/zip",
        headers: {
          "X-NOIDB-File-Name": encodeURIComponent("입고결과_fixture.zip"),
          "X-NOIDB-Coupon-Count": "8",
          "X-NOIDB-Missing-Count": "6",
          "X-NOIDB-Drive-Saved": width < 500 ? "true" : "false",
          "X-NOIDB-Coupon-File-Name": encodeURIComponent("쿠폰_fixture_02.xlsx"),
          "X-NOIDB-Missing-File-Name": encodeURIComponent("미입고_fixture_02.xlsx"),
          ...(width < 500 ? {} : { "X-NOIDB-Drive-Save-Warning": encodeURIComponent("Drive fixture 자동저장 경고") }),
        },
        body: "fixture-zip",
      });
    }
    if (request.method() === "POST" && url.pathname === "/api/wms/inbound-drive-sync") {
      const body = request.postDataJSON();
      assert.equal(body.action, "preview", "Browser fixture must never apply inbound data.");
      return route.fulfill({ json: {
        success: true,
        canApply: false,
        newFiles: [{ id: "fixture-file", name: "입고검증.xlsx", modifiedTime: "2026-09-05T00:00:00Z", size: "100" }],
        modifiedFiles: [],
        result: { parsed: 2, totalInbound: 7, candidateEvents: 2, duplicateEvents: 1, overlapDuplicateEvents: 1, previewToken: "fixture-token" },
        message: "입고 중복 검토는 완료했습니다. 제품DB 반영은 셀별 변경 검증 후 사용할 수 있습니다. 기존 입고결과의 쿠폰·미입고 파일은 계속 생성할 수 있습니다.",
      } });
    }
    forbidden.push(`${request.method()} ${url.pathname}`);
    return route.fulfill({ status: 400, json: { success: false, error: "No business writes in inbound browser fixture." } });
  });

  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("download", download => downloads.push(download.suggestedFilename()));
  await page.goto(`${base}/wms/inbound`);
  await page.getByRole("heading", { name: "입고결과·쿠폰", exact: true }).waitFor();

  const allDates = page.getByLabel(/전체 실제 입고일/);
  await allDates.waitFor();
  assert.equal(await allDates.locator("option").count(), 7, "All receipt dates must be available beyond the recent five.");
  await allDates.selectOption("2026-08-30");
  await page.getByRole("heading", { name: "2026-08-30 실제 입고결과", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "쿠폰·미입고 파일 생성", exact: true }).isEnabled(), true);

  await allDates.selectOption("2026-09-01");
  await page.getByText(/제품링크가 없는 SKU 1개/).waitFor();
  assert.equal(await page.getByRole("button", { name: "쿠폰·미입고 파일 생성", exact: true }).isEnabled(), true, "Missing links must not drop or block the unreceived SKU file.");

  const outputDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "쿠폰·미입고 파일 생성", exact: true }).click();
  assert.equal((await outputDownload).suggestedFilename(), "입고결과_fixture.zip");
  await page.getByText(width < 500
    ? /쿠폰 8개.*미입고 6개.*파일 쿠폰_fixture_02\.xlsx \/ 미입고_fixture_02\.xlsx.*Drive 저장 완료/
    : /쿠폰 8개.*미입고 6개.*파일 쿠폰_fixture_02\.xlsx \/ 미입고_fixture_02\.xlsx.*Drive fixture 자동저장 경고/).waitFor();

  await page.getByRole("button", { name: "새 입고파일 확인", exact: true }).click();
  await page.getByText(/새 입고이벤트 2건.*겹침 2건 제외/).waitFor();
  await page.getByText("입고 중복 검토는 완료했습니다. 제품DB 반영은 셀별 변경 검증 후 사용할 수 있습니다. 기존 입고결과의 쿠폰·미입고 파일은 계속 생성할 수 있습니다.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /입고파일.*반영/ }).count(), 0, "읽기 전용 미리보기 화면에 적용 버튼이 없어야 함");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Horizontal overflow at ${width}px`);
  assert.equal(await page.locator("[data-nextjs-dialog]").count(), 0, `Next error overlay at ${width}px`);
  await page.screenshot({ path: path.join(output, `inbound-${width}.png`), fullPage: true });
  await context.close();
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: process.env.NOIDB_TEST_BROWSER || "chrome" });
  try {
    await runCase(browser, 390);
    await runCase(browser, 1920);
  } finally {
    await browser.close();
  }
  assert.deepEqual(forbidden, [], `Forbidden network or download: ${forbidden.join(", ")}`);
  assert.deepEqual(downloads, ["입고결과_fixture.zip", "입고결과_fixture.zip"], "Only the two mocked fixture downloads are allowed.");
  assert.deepEqual(errors, [], `Browser errors: ${errors.join(" / ")}`);
  console.log("입고 화면 브라우저 검증 통과: 390/1920px, 전체 7개 날짜 선택, 서버 최신 개수·Drive 성공/실패·파일명 표시, C열 빈링크 경고·SKU 유지, 중복 읽기전용 미리보기·적용버튼 0, 운영 쓰기 0");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
