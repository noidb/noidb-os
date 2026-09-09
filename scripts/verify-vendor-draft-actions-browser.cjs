// Isolated browser fixture: every API request is intercepted; no production data is read or written.
const assert = require("node:assert/strict"), fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
const { chromium } = require("C:/Users/noidb/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const { emptyPickingWaveStoreSnapshot } = require("../lib/wms/picking-wave/shared-store-types.ts");
const { applyPickingWaveStoreMutation } = require("../lib/wms/picking-wave/server-store.ts");
const queueId = "VENDOR-QUEUE-actions-browser", now = "2026-09-08T10:00:00.000Z";
const out = "outputs/vendor-draft-actions-20260908";
const baseUrl = (process.argv.find(arg => arg.startsWith("--base-url=")) || "--base-url=http://localhost:3000").slice("--base-url=".length).replace(/\/$/, "");
const chosenWidth = Number((process.argv.find(arg => arg.startsWith("--width=")) || "").split("=")[1]);
const widths = [390, 1280].filter(width => !chosenWidth || width === chosenWidth);
assert(widths.length, "--width must be 390 or 1280");
function fixture() {
  const snapshot = emptyPickingWaveStoreSnapshot(); snapshot.activeVendorQueueId = queueId;
  snapshot.vendorOrderDrafts = ["창성", "보호거래처"].map((vendorName, index) => ({ id: queueId + "::" + vendorName,
    waveId: queueId, vendorName, status: index ? "approved" : "draft", createdAt: now, updatedAt: now }));
  snapshot.vendorOrderLines = ["78483551", "78483550", "90000001", "90000002", "90000003", ...Array.from({ length: 12 }, (_, i) => String(91000000 + i))].map((skuId, index) => {
    const vendorName = index === 4 ? "보호거래처" : "창성";
    return { id: queueId + "::" + skuId, draftId: queueId + "::" + vendorName, waveId: queueId, vendorName, skuId,
      productName: "상품 " + skuId, category: "반지", modelName: skuId === "91000011" ? "테스트 모델" : "기타 모델 " + skuId, optionLabel: "실버", barcode: "R" + skuId, imageUrl: "",
      shortageQuantity: 24, actualShortageQuantity: 3, memo: "보존할 메모", currentStock: "0", relatedPurchaseOrderNumbers: ["PO" + index],
      isManuallyAdded: true, ...(index === 3 ? { receivedQuantity: 2, receivingHistory: [{ quantity: 2, receivedAt: now }] } : {}), createdAt: now, updatedAt: now };
  });
  const missing = snapshot.vendorOrderLines.find(line => line.skuId === "91000011");
  missing.vendorName = "거래처 미등록"; missing.draftId = queueId + "::거래처 미등록"; missing.optionLabel = "14호";
  snapshot.vendorOrderDrafts.push({ id: missing.draftId, waveId: queueId, vendorName: missing.vendorName, status: "draft", createdAt: now, updatedAt: now });
  return snapshot;
}
const catalog = [
  { skuId: "91000011", vendorName: "창성", productName: "상품 91000011", optionLabel: "로즈골드, 14호", imageUrl: "/fixture-catalog.png" },
  { skuId: "99000001", vendorName: "검색거래처", productName: "검색 추가 상품", optionLabel: "실버", imageUrl: "", modelName: "별도검색모델" },
  { skuId: "99000002", vendorName: "창성", productName: "추가 옵션 로즈골드", optionLabel: "로즈골드, 15호", imageUrl: "" },
  { skuId: "99000004", vendorName: "창성", productName: "추가 옵션 실버", optionLabel: "실버, 14호", imageUrl: "" },
  { skuId: "99000003", vendorName: "창성", productName: "단종 옵션", optionLabel: "골드, 14호", imageUrl: "", currentStatus: "단종" },
].map(item => ({ ...item, modelName: item.modelName || "테스트 모델", currentStatus: item.currentStatus || "판매중", modelSku: "", category: "반지", gender: "공용", warehouseNumber: "", boxNumber: "", currentStock: "0", barcode: "R" + item.skuId, productLink: "" }));
async function run(browser, width) {
  let snapshot = fixture(), completionExcluded = [], completionFailure = null;
  const mutations = [], completionCalls = [], unexpected = [], errors = [], downloads = [];
  let acceptDialog = true;
  const context = await browser.newContext({ viewport: { width, height: 844 }, acceptDownloads: true });
  await context.addInitScript(() => {
    window.__exportOutputs = { copies: [], shares: [], blobs: 0 };
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async text => window.__exportOutputs.copies.push(text) } });
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "share", { configurable: true, value: async data => { window.__exportOutputs.shares.push({ text: data.text, files: data.files.length }); } });
    const createObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => { window.__exportOutputs.blobs++; return createObjectURL(blob); };
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => acceptDialog ? dialog.accept() : dialog.dismiss());
  page.on("download", download => downloads.push(download.suggestedFilename()));
  await context.route("**/fixture-catalog.png", route => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cWZkAAAAASUVORK5CYII=", "base64") }));
  await context.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const body = method === "POST" ? request.postDataJSON() : null;
    let status = 200, result;
    try {
      if (url.pathname === "/api/wms/picking-waves") {
        if (method === "POST") {
          mutations.push(body);
          snapshot = applyPickingWaveStoreMutation(snapshot, body);
        }
        result = { ok: true, snapshot };
      } else if (url.pathname === "/api/wms/vendor-orders/completion") {
        completionCalls.push(body);
        if (completionFailure) { status = 503; result = { success: false, error: completionFailure }; }
        else result = { success: true, excludedLineIds: completionExcluded };
      } else if (url.pathname === "/api/wms/vendor-orders/queue") {
        assert.equal(method, "GET", "the fixture only authorizes queue reads");
        result = { success: true, queueId, consumedLineIds: [] };
      } else if (url.pathname === "/api/wms/product-catalog/update") {
        const item = catalog.find(item => item.skuId === body.skuId);
        if (item) item.currentStatus = body.currentStatus;
        result = { success: true };
      } else if (url.pathname === "/api/wms/product-catalog") result = { success: true, configured: true, items: catalog };
      else if (url.pathname === "/api/wms/vendor-order-actions") result = { success: true, delaySummaries: [] };
      else {
        unexpected.push(method + " " + url.pathname);
        assert.notEqual(method, "POST", "unexpected writes are forbidden");
        result = { success: true, ok: true, items: [], records: [], connected: false };
      }
    } catch (error) { status = 409; result = { ok: false, success: false, error: error.message }; }
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(result) });
  });
  const card = sku => page.locator(`[data-vendor-sku="${sku}"]`);
  const check = sku => page.getByRole("checkbox", { name: `상품 ${sku} 선택`, exact: true });
  const selection = page.getByRole("region", { name: "선택 상품 작업", exact: true });
  const ids = skus => skus.map(sku => queueId + "::" + sku);
  try {
    await page.goto(`${baseUrl}/wms/picking/waves/${queueId}/vendor-orders`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await card("78483551").waitFor({ timeout: 90000 });
    console.log(width + ": editor loaded");
    if (width >= 1000) {
      const rowHeights = await page.locator('[data-vendor-group="창성"] [data-vendor-sku]').evaluateAll(nodes => {
        const rows = new Map();
        for (const node of nodes) {
          const rect = node.getBoundingClientRect();
          const key = Math.round(rect.top);
          rows.set(key, [...(rows.get(key) || []), rect.height]);
        }
        return [...rows.values()].filter(heights => heights.length > 1);
      });
      assert(rowHeights.length > 0, "desktop fixture has at least one two-card row");
      for (const heights of rowHeights) assert(Math.max(...heights) - Math.min(...heights) <= 1, "cards in the same row keep equal heights with or without the option button");
    }
    await card("91000011").getByText("거래처: 창성", { exact: true }).waitFor();
    assert(await card("91000011").locator("input").evaluateAll(inputs => inputs.some(input => input.value === "로즈골드, 14호")), "size-only saved option is filled from exact SKU catalog");
    assert((await card("91000011").locator("img").first().getAttribute("src")).includes("fixture-catalog.png"), "missing photo is filled from catalog");
    assert.equal(snapshot.vendorOrderLines.find(line => line.skuId === "91000011").vendorName, "거래처 미등록", "catalog display preparation does not silently write originals");
    await card("90000001").getByRole("button", { name: "거래처 수정", exact: true }).click();
    await card("90000001").getByRole("button", { name: /등록된 거래처 .*펼치기/ }).click();
    const vendorList = card("90000001").getByRole("list", { name: "등록된 거래처 목록" });
    assert(await vendorList.getByRole("button", { name: "검색거래처", exact: true }).count(), "registered list is not limited to the current vendor");
    await card("90000001").getByPlaceholder("이름으로 검색").fill("검색");
    assert.equal(await vendorList.getByRole("button").count(), 1);
    await vendorList.getByRole("button", { name: "검색거래처", exact: true }).click();
    assert.equal(await card("90000001").getByLabel("거래처 이름 · 직접 입력 가능", { exact: true }).inputValue(), "검색거래처");
    await card("90000001").getByRole("button", { name: "취소", exact: true }).click();
    await card("91000011").getByRole("button", { name: "+ 옵션 추가", exact: true }).click();
    const optionDialog = page.getByRole("dialog", { name: "같은 모델 옵션 추가", exact: true });
    await optionDialog.waitFor();
    assert(await optionDialog.getByRole("checkbox", { name: /SKU 91000011/ }).isDisabled(), "existing option cannot be added twice");
    assert(await optionDialog.getByRole("checkbox", { name: /SKU 99000003/ }).isDisabled(), "discontinued option cannot be added");
    await optionDialog.getByLabel("색상·호수·SKU 검색", { exact: true }).fill("15호");
    assert.equal(await optionDialog.getByRole("checkbox").count(), 1, "size filter narrows real model options");
    await optionDialog.getByRole("checkbox", { name: /SKU 99000002/ }).check();
    await optionDialog.getByLabel("색상·호수·SKU 검색", { exact: true }).fill("");
    await optionDialog.getByRole("checkbox", { name: /SKU 99000004/ }).check();
    await page.screenshot({ path: out + "/options-" + width + ".png" });
    await optionDialog.getByRole("button", { name: "선택한 2개 옵션 추가", exact: true }).click();
    await optionDialog.waitFor({ state: "detached" });
    for (const sku of ["99000002", "99000004"]) { assert.equal(await card(sku).count(), 1); assert.equal(await card(sku).getByRole("spinbutton").inputValue(), "10"); }
    assert.equal(await card("91000011").count(), 1, "anchor remains unchanged after adding its options");
    const optionOrder = await page.locator("[data-vendor-sku]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-vendor-sku")));
    const optionPositions = ["91000011", "99000002", "99000004"].map(sku => optionOrder.indexOf(sku)).sort((a, b) => a - b);
    assert.equal(optionPositions[2] - optionPositions[0], 2, "new options appear beside the original model instead of at the bottom");
    await page.getByRole("button", { name: "변경내용 저장", exact: true }).click();
    await page.getByRole("region", { name: "선택 상품 작업", exact: true }).waitFor({ state: "detached" });
    assert.equal(mutations.filter(m => m.action === "saveVendorWorkspace").length, 1, "all draft edits are saved by one atomic request");
    assert.equal(mutations.filter(m => m.action === "saveVendorLine").length, 0, "workspace save never posts one request per SKU");
    assert.equal(mutations.filter(m => m.action === "saveVendorDraft").length, 0, "workspace save never posts a separate status request");
    assert.equal(snapshot.vendorOrderLines.filter(line => ["99000002", "99000004"].includes(line.skuId)).length, 2, "added options are saved by their own SKU identities");
    await page.reload({ waitUntil: "domcontentloaded" }); await card("99000004").waitFor();
    assert.equal(await card("99000002").count(), 1, "added options survive reopening");
    await card("99000004").getByRole("button", { name: "단종", exact: true }).click();
    await card("99000004").waitFor({ state: "detached" });
    assert.equal(catalog.find(item => item.skuId === "99000004").currentStatus, "단종", "catalog status is saved before the card disappears");
    assert(snapshot.vendorOrderLines.some(line => line.skuId === "99000004"), "status completion hides the draft card while preserving source history");
    assert.equal(await check("90000002").isDisabled(), true, "received row cannot be selected");
    assert.match(await check("90000002").getAttribute("title"), /입고·원가 이력/);
    assert.equal(await check("90000003").isDisabled(), true, "approved row cannot be selected");
    assert.match(await check("90000003").getAttribute("title"), /승인·전송/);
    await card("90000001").getByRole("spinbutton").fill("48");
    await card("90000001").getByPlaceholder("메모", { exact: true }).fill("저장 전 메모 유지");
    await check("78483551").check(); await check("78483550").check();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await selection.waitFor();
    const bounds = await selection.boundingBox();
    assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 844,
      "selection actions remain within viewport after deep scrolling");
    assert(await page.evaluate(() => window.scrollY > 1500), "fixture reaches deep scroll");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "no horizontal overflow");
    await page.screenshot({ path: `${out}/selection-${width}.png` });
    const beforeCancel = structuredClone(snapshot);
    acceptDialog = false;
    await selection.getByRole("button", { name: "선택한 상품 삭제 (2)", exact: true }).click();
    assert.deepEqual(snapshot, beforeCancel, "cancel preserves all server data");
    assert.equal(mutations.filter(m => m.action === "deleteVendorLines").length, 0, "cancel never sends a deletion");
    assert.equal(await check("78483551").isChecked(), true);
    acceptDialog = true;
    await selection.getByRole("button", { name: "선택한 상품 삭제 (2)", exact: true }).click();
    await card("78483551").waitFor({ state: "detached" });
    assert.equal(await card("78483550").count(), 0);
    const deletes = mutations.filter(m => m.action === "deleteVendorLines");
    assert.equal(deletes.length, 1);
    assert.deepEqual([...deletes[0].lineIds].sort(), ids(["78483550", "78483551"]).sort());
    assert.equal(snapshot.vendorOrderLines.length, beforeCancel.vendorOrderLines.length - 2);
    assert.equal(await card("90000001").getByRole("spinbutton").inputValue(), "48", "unselected unsaved quantity survives");
    assert.equal(await card("90000001").getByPlaceholder("메모", { exact: true }).inputValue(), "저장 전 메모 유지", "unselected unsaved memo survives");
    assert.equal(snapshot.vendorOrderLines.find(line => line.skuId === "90000001").shortageQuantity, 24, "deletion does not silently save unrelated edits");
    await page.reload({ waitUntil: "domcontentloaded" });
    await card("90000001").waitFor({ timeout: 30000 });
    assert.equal(await card("78483551").count(), 0, "deleted row stays absent after reopening");
    assert.equal(await card("78483550").count(), 0);
    console.log(width + ": cancellation, deletion, dirty values and reload passed");
    // Another device changes this exact line after the editor baseline was loaded.
    await check("90000001").check();
    snapshot.vendorOrderLines = snapshot.vendorOrderLines.map(line => line.skuId === "90000001" ? { ...line, memo: "다른 기기 메모", updatedAt: "2026-09-08T10:01:00.000Z" } : line);
    const beforeConflict = structuredClone(snapshot);
    await selection.getByRole("button", { name: "선택한 상품 삭제 (1)", exact: true }).click();
    await selection.getByRole("alert").waitFor();
    assert.deepEqual(snapshot, beforeConflict, "409 leaves the entire snapshot intact");
    assert.equal(await check("90000001").isChecked(), true, "409 keeps the user's selection");
    assert.equal(await card("90000001").count(), 1);
    await page.screenshot({ path: `${out}/conflict-${width}.png` });
    // Completion status changes while the editor remains open; focus triggers a fresh check.
    completionExcluded = ids(["90000001"]);
    const previousChecks = completionCalls.length;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await card("90000001").waitFor({ state: "detached" });
    assert(completionCalls.length > previousChecks);
    assert.equal(await selection.getByRole("button", { name: /선택한 상품 삭제/ }).count(), 0, "completed selected row leaves selection actions; dirty save may remain");
    assert.equal(snapshot.vendorOrderLines.find(line => line.skuId === "90000001").memo, "다른 기기 메모", "completion hide preserves original row history");
    // Every output path must stop on a failed final completion check.
    completionFailure = "테스트: 처리 상태를 확인할 수 없습니다. 다시 확인해 주세요.";
    assert.equal(await page.getByRole("button", { name: "메시지 미리보기", exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "메시지 복사", exact: true }).count(), 0);
    for (const name of ["카카오톡으로 공유"]) {
      const calls = completionCalls.length;
      await page.getByRole("button", { name, exact: true }).click();
      await page.getByRole("alert").filter({ hasText: completionFailure }).first().waitFor();
      await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
      assert(completionCalls.length > calls, `${name} checks fresh completion`);
      assert.equal(await page.locator("pre").count(), 0, "no preview is output after the failed check");
    }
    const outputs = await page.evaluate(() => window.__exportOutputs);
    assert.deepEqual(outputs, { copies: [], shares: [], blobs: 0 }, "failed check never copies, shares, or renders downloadable output");
    assert.equal(downloads.length, 0);
    await page.screenshot({ path: `${out}/export-error-${width}.png` });
    completionFailure = null;
    await page.getByRole("button", { name: "+ 상품 추가", exact: true }).click();
    const search = page.getByPlaceholder("SKU ID, 상품명, 모델명, 옵션명, 거래처로 검색", { exact: true });
    await search.waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute("placeholder") === "SKU ID, 상품명, 모델명, 옵션명, 거래처로 검색");
    assert.equal(await search.evaluate(element => document.activeElement === element), true, "product search opens with the typing cursor in the search field");
    await search.fill("91000011");
    const alreadyAddedResult = page.getByRole("button", { name: /상품 91000011.*이미 추가됨/ });
    assert.equal(await alreadyAddedResult.isDisabled(), true, "existing draft SKU is visibly marked and cannot be added again from product search");
    assert.equal(await search.getAttribute("lang"), "ko", "product search explicitly requests the Korean IME");
    await search.fill("검색");
    assert.equal(await search.inputValue(), "검색", "Hangul input survives filtering rerenders");
    await search.blur(); await search.focus();
    assert.equal(await search.inputValue(), "검색", "Hangul input survives blur and refocus");
    await search.fill("99000001");
    await page.getByRole("button", { name: /검색 추가 상품.*SKU 99000001/ }).click();
    await card("99000001").waitFor();
    assert.equal(await card("99000001").getByRole("spinbutton").inputValue(), "10", "approved order exposes product add with the ring default quantity");
    const protectedOrder = page.locator('[data-vendor-group="보호거래처"] [data-vendor-sku]');
    assert.equal(await protectedOrder.last().getAttribute("data-vendor-sku"), "99000001", "product search additions appear at the end of their vendor list");
    assert.equal(snapshot.vendorOrderDrafts.find(draft => draft.vendorName === "보호거래처").status, "approved", "opening search and selecting a product does not block on a preliminary server save");
    await page.getByRole("button", { name: "변경내용 저장", exact: true }).click();
    await page.getByRole("region", { name: "선택 상품 작업", exact: true }).waitFor({ state: "detached" });
    await page.reload({ waitUntil: "domcontentloaded" }); await card("99000001").waitFor();
    assert.equal(snapshot.vendorOrderLines.filter(line => line.skuId === "99000001").length, 1, "approved order's added product survives saving and reopen");
    assert.equal(await protectedOrder.last().getAttribute("data-vendor-sku"), "99000001", "end placement survives saving and reopening");
    assert.equal(snapshot.vendorOrderDrafts.find(draft => draft.vendorName === "보호거래처").status, "resend_needed", "the actual save records that an approved order needs review");
    const protectedDraft = snapshot.vendorOrderDrafts.find(draft => draft.vendorName === "보호거래처");
    protectedDraft.status = "approved";
    protectedDraft.updatedAt = new Date(Date.parse(protectedDraft.updatedAt) + 1000).toISOString();
    await page.reload({ waitUntil: "domcontentloaded" }); await card("99000001").waitFor();
    const mutationsBeforeRevision = mutations.length;
    await page.getByRole("button", { name: "발주내용 수정", exact: true }).click();
    await page.getByRole("button", { name: "+ 상품 검색 추가", exact: true }).last().waitFor();
    assert.equal(mutations.length, mutationsBeforeRevision, "editing an approved order opens immediately without a preliminary server save");
    assert.equal(errors.length, 0, errors.join("\n"));
    const result = { width, passed: true, checks: ["catalog vendor/photo/size option completion without writes", "registered vendor list and search selection", "same model option search, disabled existing/discontinued options, multi-add and save/reopen", "approved product add after edit transition and save/reopen", "fixed selection toolbar at deep scroll", "cancel is read-only", "atomic exact selection deletion", "unselected dirty quantity and memo preserved", "deletion persists on reopen", "receiving and approved locks", "409 retains selection and state", "focus completion hides selected row without history loss", "failed export check blocks preview/copy/share/download"], mutationCount: mutations.length, completionCheckCount: completionCalls.length, errors, unexpected };
    fs.writeFileSync(`${out}/results-${width}.json`, JSON.stringify(result, null, 2));
    console.log("PASS vendor draft browser", JSON.stringify(result));
  } catch (error) {
    await page.screenshot({ path: `${out}/failure-${width}.png`, fullPage: true }).catch(() => {});
    fs.writeFileSync(`${out}/failure-${width}.json`, JSON.stringify({ error: error.stack, errors, unexpected, mutations, completionCalls: completionCalls.length, url: page.url() }, null, 2));
    throw error;
  } finally { await context.close(); }
}
async function runManage(browser, width, missingQueue = false, failPreparation = false) {
  let snapshot = fixture();
  snapshot.vendorOrderLines = snapshot.vendorOrderLines.filter(line => line.skuId !== "91000011");
  snapshot.vendorOrderDrafts = snapshot.vendorOrderDrafts.filter(draft => draft.vendorName !== "거래처 미등록");
  const originalLine = snapshot.vendorOrderLines[0];
  for (const [oldId, status] of [["old-unsent", "draft"], ["old-sent", "sent"]]) {
    snapshot.vendorOrderDrafts.push({ id: oldId + "::이력", waveId: oldId, vendorName: "이력", status, createdAt: now, updatedAt: now });
    snapshot.vendorOrderLines.push({ ...originalLine, id: oldId + "::80000000", waveId: oldId, draftId: oldId + "::이력", vendorName: "이력", skuId: "80000000", productName: "이력 상품" });
  }
  if (missingQueue) {
    snapshot.activeVendorQueueId = undefined;
    snapshot.vendorOrderLines = snapshot.vendorOrderLines.map(line => { const pending = { ...line }; delete pending.receivedQuantity; delete pending.receivingHistory; return pending; });
  }
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  const page = await context.newPage(), errors = [], mutations = [];
  let reads = 0, preparations = 0, failNext = failPreparation;
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => dialog.accept());
  await context.route("**/__vendor-actions-fixture", route => route.fulfill({ contentType: "text/html", body: "<html><body>Storage signal fixture</body></html>" }));
  await context.route("**/api/**", async route => {
    const req = route.request(), pathname = new URL(req.url()).pathname, method = req.method(), body = method === "POST" ? req.postDataJSON() : null;
    let result, status = 200;
    try {
      if (pathname === "/api/wms/picking-waves") {
        if (method === "POST") { mutations.push(body); snapshot = applyPickingWaveStoreMutation(snapshot, body); }
        else reads++;
        result = { ok: true, snapshot };
      } else if (pathname === "/api/wms/vendor-orders/queue") {
        if (method === "POST") {
          preparations++;
          if (failNext) { failNext = false; throw new Error("테스트: 초기 취합 실패, 다시 시도해 주세요."); }
          const operationId = "manage-prepare-" + preparations;
          snapshot = applyPickingWaveStoreMutation(snapshot, { action: "consolidateVendorOrders", operationId, lines: [], now });
          result = { success: true, receipt: snapshot.vendorQueueReceipts[operationId] };
        } else result = { success: true, queueId: snapshot.activeVendorQueueId || null, consumedLineIds: Object.keys(snapshot.vendorQueueConsumedLineIds || {}) };
      } else if (pathname === "/api/wms/vendor-orders/completion") result = { success: true, excludedLineIds: [] };
      else if (pathname === "/api/wms/product-catalog") result = { success: true, configured: true, items: [] };
      else if (pathname === "/api/wms/vendor-order-actions") result = { success: true, delaySummaries: [] };
      else { assert.equal(method, "GET", "no unexpected writes"); result = { success: true, ok: true, items: [], records: [], connected: false }; }
    } catch (error) { status = 409; result = { ok: false, success: false, error: error.message }; }
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(result) });
  });
  try {
    await page.goto(baseUrl + "/wms/vendor-orders/manage", { waitUntil: "domcontentloaded", timeout: 90000 });
    const card = page.locator('[data-vendor-sku="78483551"]');
    if (failPreparation) {
      await page.getByRole("alert").filter({ hasText: "초기 취합 실패" }).waitFor();
      assert.equal(preparations, 1, "failed initial preparation is not retried invisibly");
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.waitForTimeout(350);
      assert(await page.getByRole("alert").filter({ hasText: "초기 취합 실패" }).isVisible(), "a successful status read cannot erase the failed initial preparation guidance");
      assert.equal(snapshot.activeVendorQueueId, undefined, "failed initial preparation preserves source data");
      await page.getByRole("button", { name: "기존 발주대기 함께 취합", exact: true }).click();
    }
    await card.waitFor({ timeout: 60000 });
    console.log("manage editor loaded", { width, missingQueue, failPreparation });
    if (missingQueue) {
      assert.equal(preparations, failPreparation ? 2 : 1, "missing queue is prepared once, with an explicit retry after failure");
      await page.reload({ waitUntil: "domcontentloaded" }); await card.waitFor();
      assert.equal(preparations, failPreparation ? 2 : 1, "reopening an existing queue does not reconsolidate");
    } else {
      assert.equal(preparations, 0, "existing queue is never automatically consolidated");
      const history = page.locator("details").filter({ has: page.locator("summary", { hasText: "이전 발주서" }) });
      await history.locator("summary").click();
      assert.equal(await history.locator('a[href*="' + queueId + '"]').count(), 0, "active queue is not repeated in history");
      assert.equal(await history.locator('a[href="/wms/vendor-orders/manage"]').count(), 1, "old unsent row links to the current queue");
      assert.equal(await history.locator('a[href="/wms/picking/waves/old-sent/vendor-orders"]').count(), 1, "sent history remains separately accessible");
      const historyLine = structuredClone(snapshot.vendorOrderLines.find(line => line.waveId === "old-sent"));
      await history.locator('a[href="/wms/picking/waves/old-sent/vendor-orders"]').locator("xpath=../..").getByRole("button", { name: "삭제", exact: true }).click();
      await history.locator('a[href="/wms/picking/waves/old-sent/vendor-orders"]').waitFor({ state: "detached" });
      await page.getByRole("button", { name: "↶ 발주서 삭제", exact: true }).click();
      await history.locator('a[href="/wms/picking/waves/old-sent/vendor-orders"]').waitFor();
      assert.deepEqual(snapshot.vendorOrderLines.find(line => line.id === historyLine.id), historyLine, "explicit history undo restores original rows through the dedicated action");
      assert(mutations.some(mutation => mutation.action === "restoreVendorDraft"));
      const signalPage = await context.newPage();
      await signalPage.goto(baseUrl + "/__vendor-actions-fixture");
      await page.bringToFront();
      const signal = () => signalPage.evaluate(() => localStorage.setItem("noidb_vendor_order_queue_changed", String(Date.now())));
      snapshot.vendorOrderLines = snapshot.vendorOrderLines.map(line => line.id === originalLine.id ? { ...line, shortageQuantity: 36, updatedAt: "2026-09-08T11:00:00.000Z" } : line);
      await card.evaluate(element => element.setAttribute("data-refresh-marker", "kept"));
      await signal();
      await page.getByRole("alert").filter({ hasText: "다른 화면에서 발주 목록이 변경되었습니다" }).waitFor();
      assert.equal(await card.getAttribute("data-refresh-marker"), "kept", "clean background refresh does not remount the editor");
      assert.notEqual(await card.getByRole("spinbutton").inputValue(), "36", "background refresh waits for an explicit reload");
      await page.getByRole("button", { name: "최신 목록 다시 확인", exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[data-vendor-sku="78483551"] input[type="number"]')?.value === "36");
      const beforeDirty = reads;
      await card.getByRole("spinbutton").fill("48");
      await card.getByPlaceholder("메모", { exact: true }).fill("다른 창 갱신 중 입력 보존");
      snapshot.vendorOrderLines = snapshot.vendorOrderLines.map(line => line.id === originalLine.id ? { ...line, shortageQuantity: 60, memo: "다른 창 최신 메모", updatedAt: "2026-09-08T12:00:00.000Z" } : line);
      await signal();
      await page.getByRole("alert").filter({ hasText: "다른 화면에서 발주 목록이 변경되었습니다" }).waitFor();
      assert.equal(await card.getByRole("spinbutton").inputValue(), "48");
      assert.equal(await card.getByPlaceholder("메모", { exact: true }).inputValue(), "다른 창 갱신 중 입력 보존");
      assert(await page.getByRole("button", { name: "최신 목록 다시 확인", exact: true }).isDisabled());
      assert(reads > beforeDirty, "storage event reads fresh data while retaining dirty fields");
      await page.screenshot({ path: out + "/manage-dirty-" + width + ".png" });
      await page.reload({ waitUntil: "domcontentloaded" }); await card.waitFor();
      assert.equal(await card.getByRole("spinbutton").inputValue(), "60", "reopening reads latest stored data");
      const cleanStart = reads;
      await signal(); await page.waitForTimeout(600);
      assert(reads - cleanStart < 12, "unchanged snapshots do not create cross-window refresh loops");
      assert.equal(preparations, 0);
      await signalPage.close();
    }
    assert.equal(errors.length, 0, errors.join("\n"));
    const result = { width, missingQueue, failPreparation, passed: true, preparations, reads, errors };
    fs.writeFileSync(out + "/manage-" + width + "-" + missingQueue + "-" + failPreparation + ".json", JSON.stringify(result, null, 2));
    console.log("PASS manage freshness", JSON.stringify(result));
  } catch (error) {
    await page.screenshot({ path: out + "/manage-failure-" + width + ".png", fullPage: true }).catch(() => {});
    console.error("manage detail", { error: error.stack, errors, reads, preparations, mutations }); throw error;
  } finally { await context.close(); }
}
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  try {
    for (const width of widths) { if (!process.argv.includes("--manage-only")) await run(browser, width); if (!process.argv.includes("--draft-only") && !process.argv.includes("--initial-only")) await runManage(browser, width); }
    if (!process.argv.includes("--draft-only")) { await runManage(browser, widths[0], true); await runManage(browser, widths[0], true, true); }
  }
  finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
