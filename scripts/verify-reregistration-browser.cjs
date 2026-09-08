const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const JSZip = require("jszip");
const ExcelJS = require("exceljs");
const { chromium } = require("C:/Users/noidb/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { buildQuoteWorkbook } = require("../lib/excel/quote.ts");
const { buildWimsRegistrationAuditFromRows, buildWimsRegistrationCellUpdates } = require("../lib/wms/wims-registration-audit.ts");

(async () => {
  const outputDirectory = "outputs/reregistration-20260908";
  fs.mkdirSync(outputDirectory, { recursive: true });
  const errors = [], unexpectedWrites = [], registrations = [], wimsApplyRequests = [], dialogs = [];
  const wimsSheetRows = [
    ["현재상태", "모델SKU", "SKU ID", "바코드", "상품명", "창고번호", "누적입고", "발주가능상태"],
    ["등록파일생성", "mn011236-GO", "", "", "검수중 목걸이", "711", "32", ""],
    ["등록파일생성", "wp24041505-16", "", "", "검수완료 피어싱", "712", "24", ""],
  ];
  const wimsText = [
    "상품명\t상품 등록일\t카테고리\t바코드\t원본 견적서\t견적서 ID\tSKU ID\t상태\t등록 진행 단계",
    "검수중 목걸이, 유광골드 mn011236-GO\t2026/09/08\t남성패션목걸이\t바코드 없음(쿠팡 바코드 생성 요청)\t다운로드\t2897812\t-\t상품 검수중\t가격/정책 상품정보",
    "검수완료 피어싱, 16mm wp24041505-16\t2026/09/08\t여성피어싱\tR259891680004\t다운로드\t2897813\t79392730\t상품 검수 완료\t가격/정책 상품정보 발주서 발행",
  ].join("\n");
  let releaseSlowCheck, slowCheckStarted;
  const slowStarted = new Promise(resolve => { slowCheckStarted = resolve; });
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 960 }, acceptDownloads: true });
    await context.addInitScript(() => { delete window.showDirectoryPicker; });
    await context.route("**/api/**", async route => {
      const req = route.request(), url = new URL(req.url()), method = req.method();
      const body = req.postData() ? req.postDataJSON() : null;
      let result = { success: true, ok: true, configured: true, items: [], records: [], drafts: [], suppliers: ["프리스타일"] };
      if (url.pathname === "/api/google-sheet" && method === "GET" && url.searchParams.has("model")) {
        const model = url.searchParams.get("model"); console.log("CHECK MODEL", model);
        if (model === "SLOW001") {
          slowCheckStarted();
          await new Promise(resolve => { releaseSlowCheck = resolve; });
        }
        result = { configured: true, duplicate: model !== "NEW001", reregisterable: ["PAUSED001", "SLOW001"].includes(model), reason: "판매중지 상태가 아닌 기존 모델입니다." };
      } else if (url.pathname === "/api/auth/noidb-action-session") {
        result = { configured: true, authenticated: true };
      } else if (url.pathname === "/api/export-quote" && method === "POST") {
        const quote = await buildQuoteWorkbook(body);
        return route.fulfill({ status: 200, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: quote.buffer });
      } else if (url.pathname === "/api/google-sheet" && method === "POST") {
        if (body.action === "cloudDraftSave") result = { configured: true, ok: true };
        else {
          registrations.push(body);
          assert.equal(body.syncMode, "reregisterStopped");
          result = { configured: true, synced: true, reregistered: true, registrationStage: { updatedRows: 1 } };
        }
      } else if (url.pathname === "/api/wms/wims-registration/audit" && method === "POST") {
        result = buildWimsRegistrationAuditFromRows(body.rows, wimsSheetRows);
      } else if (url.pathname === "/api/wms/wims-registration/apply" && method === "POST") {
        wimsApplyRequests.push(body);
        assert.equal(body.confirmation, "WIMS 검수상태 반영");
        assert.equal(body.includeReviewing, true);
        assert.equal(body.rows.length, 2);
        const audit = buildWimsRegistrationAuditFromRows(body.rows, wimsSheetRows);
        assert.equal(body.dryRunToken, audit.dryRunToken);
        const cellUpdates = buildWimsRegistrationCellUpdates(wimsSheetRows, audit, body.includeReviewing);
        for (const update of cellUpdates) wimsSheetRows[update.row - 1][update.col - 1] = update.value;
        result = { applied: true, writtenRowCount: new Set(cellUpdates.map(update => update.row)).size, writtenCellCount: cellUpdates.length, backupSheetName: "제품DB_UI검증백업" };
      } else if (method !== "GET") unexpectedWrites.push(`${method} ${url.pathname}`); else if (url.pathname !== "/api/google-sheet") return route.fulfill({status:503, contentType:"application/json", body:JSON.stringify({success:false,configured:false,error:"브라우저 테스트에서 사용하는 등록 API만 연결되어 있습니다."})});
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
    });
    const page = await context.newPage();
    page.on("pageerror", error => { errors.push(error.message); console.log("PAGE ERROR", error.message); });
    page.on("dialog", dialog => { dialogs.push(dialog.message()); return dialog.accept(); });
    const initialCheck = page.waitForResponse(response => response.url().includes("/api/google-sheet?model="), { timeout: 30000 }); await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded", timeout: 90000 }); await initialCheck;
    const field = label => page.locator("label.field").filter({ has: page.locator("span", { hasText: new RegExp(`^${label}$`) }) });
    const modelInput = field("모델명").first().locator("input");
    await modelInput.waitFor({ timeout: 90000 });
    await field("카테고리").locator("select").selectOption("목걸이");
    await field("색상옵션").locator("input").fill("골드");
    await field("사이즈").locator("input").fill("Free");
    await field("쿠팡 상품명").locator("input").fill("재등록 UI 테스트 상품");
    await modelInput.fill("PAUSED001");
    await page.getByText("기존 행 재등록 가능", { exact: true }).waitFor().catch(async error => { console.log((await page.locator(".basicInfoCard").innerText()).slice(0, 2200)); await page.screenshot({path: outputDirectory + "/failure.png"}); throw error; });
    await page.getByRole("button", { name: /^실제 등록용/ }).click();
    assert.equal(await page.getByText("기존 모델입니다. 판매중지 상태가 아닌 모델의 일괄 등록은 차단됩니다.", { exact: true }).count(), 0);
    await page.getByText(/판매중지 제품의 기존 행을 맨 위로 옮기고/).waitFor();
    await page.screenshot({ path: `${outputDirectory}/reregistration-desktop.png`, fullPage: true });

    const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
    await page.getByRole("button", { name: "실제 등록파일 일괄 생성 및 저장", exact: true }).click();
    const download = await downloadPromise;
    await download.saveAs(`${outputDirectory}/reregistration-fixture.zip`);
    await page.getByText(/기존 1행 재등록 완료/).waitFor({ timeout: 30000 });
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].model, "PAUSED001");
    assert.equal(await page.getByRole("button", { name: "테스트 ZIP 생성", exact: true }).count(), 1, "실제 등록 실행 후 연습모드로 돌아가야 합니다.");
    const zip = await JSZip.loadAsync(fs.readFileSync(`${outputDirectory}/reregistration-fixture.zip`));
    const quoteEntry = Object.values(zip.files).find(file => file.name.endsWith("견적서_PAUSED001_목걸이.xlsx"));
    assert(quoteEntry, "실제 다운로드 ZIP에 견적서가 있어야 합니다.");
    const quote = new ExcelJS.Workbook();
    await quote.xlsx.load(await quoteEntry.async("nodebuffer"));
    const sheet = quote.worksheets.find(candidate => candidate.name.startsWith("QF_"));
    let modelColumn;
    sheet.getRow(5).eachCell((cell, column) => { if (cell.text.trim() === "모델명/품번") modelColumn = column; });
    assert(modelColumn);
    assert.equal(sheet.getRow(9).getCell(modelColumn).text, "PAUSED001");

    await modelInput.fill("SLOW001");
    await slowStarted;
    await modelInput.fill("BLOCKED001");
    await page.getByText("판매중지 상태가 아닌 기존 모델입니다.", { exact: true }).waitFor();
    releaseSlowCheck();
    await page.waitForTimeout(200);
    assert.equal(await page.getByText("기존 행 재등록 가능", { exact: true }).count(), 0, "이전 모델의 늦은 응답이 새 모델을 재등록 가능으로 바꾸면 안 됩니다.");
    await page.getByRole("button", { name: /^실제 등록용/ }).click();
    await page.getByRole("button", { name: "실제 등록파일 일괄 생성 및 저장", exact: true }).click();
    await page.getByText(/기존 모델의 일괄 저장은 안전을 위해 차단했습니다/).waitFor();
    assert.equal(registrations.length, 1, "일반 중복 모델은 저장 요청을 보내면 안 됩니다.");

    await page.setViewportSize({ width: 390, height: 844 });
    await modelInput.fill("PAUSED001");
    await page.getByText("기존 행 재등록 가능", { exact: true }).waitFor().catch(async error => { console.log((await page.locator(".basicInfoCard").innerText()).slice(0, 2200)); await page.screenshot({path: outputDirectory + "/failure.png"}); throw error; });
    await page.getByRole("button", { name: /^실제 등록용/ }).click();
    await page.locator(".batchModePanel").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${outputDirectory}/reregistration-mobile.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, "모바일 가로 넘침이 없어야 합니다.");
    await page.setViewportSize({ width: 1280, height: 960 });
    const wimsPanel = page.locator("#wims-registration");
    await wimsPanel.locator("textarea").fill(wimsText);
    await wimsPanel.getByRole("button", { name: "등록상태 분류", exact: true }).click();
    await wimsPanel.getByRole("button", { name: "제품DB와 읽기 전용 대조", exact: true }).click();
    const applyWimsButton = wimsPanel.getByRole("button", { name: "검수상태 2건 반영", exact: true });
    await applyWimsButton.waitFor();
    await wimsPanel.screenshot({ path: outputDirectory + "/wims-before-apply.png" });
    assert.equal(wimsApplyRequests.length, 0, "대조 단계에서는 상태 반영 요청이 없어야 합니다.");
    await applyWimsButton.click();
    await wimsPanel.getByText("2건 검수상태 반영·재확인 완료 · 백업 제품DB_UI검증백업", { exact: true }).waitFor();
    await wimsPanel.getByText("현재 WIMS에서 조치할 상품이 없습니다.", { exact: true }).waitFor();
    assert.equal(wimsApplyRequests.length, 1);
    assert(dialogs.some(message => message.includes("검수완료 1건 연결 · 검수중 1건 승인대기 상태 반영")));
    assert.deepEqual(wimsSheetRows[1], ["신상승인대기", "mn011236-GO", "", "", "검수중 목걸이", "711", "32", ""]);
    assert.deepEqual(wimsSheetRows[2], ["완료", "wp24041505-16", "79392730", "R259891680004", "검수완료 피어싱, 16mm wp24041505-16", "712", "24", ""]);
    await wimsPanel.screenshot({ path: outputDirectory + "/wims-after-apply.png" });
    assert.deepEqual(unexpectedWrites, [], "등록 외 예상하지 않은 쓰기 요청이 없어야 합니다.");
    assert.deepEqual(errors, [], "화면 실행 오류가 없어야 합니다.");
    fs.writeFileSync(`${outputDirectory}/browser-results.json`, JSON.stringify({ passed: true, registrations: registrations.map(value => ({ model: value.model, syncMode: value.syncMode })), checks: ["판매중지 재등록 가능 표시", "실제 다운로드 ZIP의 견적서 모델명", "실제 등록 실행 후 연습모드", "일반 중복 저장 차단", "이전 모델의 지연 응답 무시", "390px 가로 넘침 없음", "WIMS 검수중1+승인1 실제 반영 버튼·토큰·확인문·재대조"], wimsApplyRequestCount: wimsApplyRequests.length, wimsResultRows: wimsSheetRows, errors, unexpectedWrites }, null, 2));
    console.log("PASS browser: 판매중지 재등록, 실제 ZIP 견적서 모델명, 기존 중복 차단, 지연 응답 격리, 모바일 화면, WIMS 2건 상태반영 버튼·재대조. 외부 API는 모두 모의 응답.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
