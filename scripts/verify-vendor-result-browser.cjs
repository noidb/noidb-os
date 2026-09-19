const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { chromium } = require("C:/Users/noidb/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const { emptyPickingWaveStoreSnapshot } = require("../lib/wms/picking-wave/shared-store-types.ts");
const { applyPickingWaveStoreMutation } = require("../lib/wms/picking-wave/server-store.ts");

const now = "2026-09-20T00:00:00.000Z";
const waveId = "VENDOR-QUEUE-result-preview";
let store = emptyPickingWaveStoreSnapshot();
store.activeVendorQueueId = waveId;
const receipt = index => { const keys = [`9900000${index}`, `B-${index}`, `100${index}`, `900${index}`]; return [{ lineKey: JSON.stringify(keys), shipmentNumber: keys[0], boxId: keys[1], purchaseOrderNumber: keys[2], skuId: keys[3], deliveredQuantity: 12, receivedQuantity: 10, shortageQuantity: 2 }]; };
store.vendorOrderDrafts = [
  { id: "sent", waveId, vendorName: "원거래처", status: "sent", createdAt: now, updatedAt: now },
  { id: "target", waveId, vendorName: "새거래처", status: "draft", createdAt: now, updatedAt: now },
];
store.vendorOrderLines = [0, 1, 2, 3].map(index => ({ id: `source-${index}`, draftId: "sent", waveId, vendorName: "원거래처", skuId: `900${index}`, modelName: "검증", category: "", optionLabel: "기본", productName: `결과처리 ${index}`, imageUrl: "", barcode: "", actualShortageQuantity: 2, shortageQuantity: 12, currentStock: "", relatedPurchaseOrderNumbers: [`PO-${index}`], memo: "", isManuallyAdded: false, shipmentReceiptDetails: receipt(index), createdAt: now, updatedAt: now })).concat([{ id: "target-existing", draftId: "target", waveId, vendorName: "새거래처", skuId: "9999", modelName: "검증", category: "", optionLabel: "기본", productName: "기존 초안 품목", imageUrl: "", barcode: "", actualShortageQuantity: 1, shortageQuantity: 12, currentStock: "", relatedPurchaseOrderNumbers: ["PO-target"], memo: "", isManuallyAdded: true, createdAt: now, updatedAt: now }]);
const clone = () => structuredClone(store);
const reorder = require('./vendor-result-test-memory.cjs')({ getStore: () => store, setStore: value => { store = value; } });
const discontinued = [];

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(10000);
  const api = [];
  const unmocked = [];
  await page.route("**/*", async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin !== "http://127.0.0.1:3111") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    api.push(`${request.method()} ${url.pathname}`);
    const json = value => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(value) });
    if (url.pathname === "/api/wms/picking-waves" && request.method() === "GET") return json({ ok: true, snapshot: clone() });
    if (url.pathname === "/api/wms/vendor-orders/queue" && request.method() === "GET") return json({ success: true, queueId: waveId, deletedDraftIds: {}, consumedLineIds: [], draftUpdatedAtById: Object.fromEntries(store.vendorOrderDrafts.map(draft => [draft.id, draft.updatedAt]) ) });
    if (url.pathname === "/api/wms/product-catalog" && request.method() === "GET") return json({ ok: true, items: [] });
    if (url.pathname === "/api/wms/picking-waves" && request.method() === "POST") { const body = request.postDataJSON(); store = applyPickingWaveStoreMutation(store, body); return json({ ok: true, snapshot: clone() }); }
    if (url.pathname === "/api/wms/vendor-orders/completion") return json({ success: true, excludedLineIds: [], scope: { discontinued: [], routedVendorLineIds: [] }, partialCompletions: [] });
    if (url.pathname === "/api/wms/vendor-order-actions" && request.method() === "GET") return json({ success: true, delaySummaries: [] });
    if (url.pathname === '/api/wms/vendor-orders/reorder') return json(request.method() === 'GET' ? reorder.preview(url.searchParams.get('lineId')) : await reorder.move(request.postDataJSON()));
    if (url.pathname === "/api/wms/vendor-orders/delay") { const body = request.postDataJSON(); store = applyPickingWaveStoreMutation(store, { action: "setSentVendorDelay", ...body, now }); return json({ success: true, line: store.vendorOrderLines.find(line => line.id === body.lineId) }); }
    if (url.pathname === "/api/wms/vendor-order-actions" && request.method() === "POST") {
      const body = request.postDataJSON(); assert.equal(body.action, "queue-discontinue");
      const destinationId = `discontinue-${body.sourceLineId}`;
      store = applyPickingWaveStoreMutation(store, { action: "resolveSentVendorLine", lineId: body.sourceLineId, expectedUpdatedAt: body.expectedUpdatedAt, kind: "discontinue", destinationId, now });
      discontinued.push({ id: destinationId, skuId: body.skuId });
      return json({ success: true, line: store.vendorOrderLines.find(line => line.id === body.sourceLineId), statusRequest: { id: destinationId } });
    }
    unmocked.push(`${request.method()} ${url.pathname}`);
    return route.fulfill({ status: 418, contentType: "application/json", body: JSON.stringify({ error: "unmocked API" }) });
  });
  await page.goto("http://127.0.0.1:3111/wms/vendor-orders/manage", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "발주결과처리", exact: true }).click();
  const sourceGroup = page.locator('[data-vendor-order-id="sent"]');
  const targetGroup = page.locator('[data-vendor-order-id="target"]');
  await targetGroup.locator('[data-vendor-sku="9999"]').getByRole('spinbutton').fill('25');
  const actions = page.locator('[data-vendor-sku="9000"]').getByLabel("상품 결과처리");
  await expectCount(actions.getByRole("button"), 6);
  await actions.screenshot({ path: ".tmp/vendor-result-source.png" });
  page.once("dialog", dialog => dialog.accept());
  await actions.getByRole("button", { name: "단종으로 이동", exact: true }).first().click();
  await page.waitForFunction(() => !document.querySelector('[data-vendor-sku="9000"]'));
  assert.equal(store.vendorOrderLines.find(line => line.id === "source-0")?.sentResolution?.kind, "discontinue", "discontinue resolves source through reducer");
  const transferCard = page.locator('[data-vendor-sku="9002"]');
  await transferCard.getByRole("button", { name: "거래처 수정", exact: true }).click();
  const transferDialog = page.getByRole("dialog", { name: "전송완료 거래처 수정" });
  const vendorInput = transferDialog.getByRole("textbox", { name: '거래처 이름 · 직접 입력 가능', exact: true });
  await vendorInput.fill("새거래처");
  await transferDialog.getByRole("button", { name: "이동 수량 확인", exact: true }).click();
  await transferDialog.getByRole("button", { name: "확인 · 발주서 이동", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-vendor-order-id="sent"] [data-vendor-sku="9002"]'));
  assert(store.vendorOrderLines.some(line => line.vendorName === "새거래처" && line.vendorTransferSourceLineId === "source-2"), "transfer persists target draft line through reducer");
  assert.equal(await targetGroup.locator('[data-vendor-sku="9002"]').count(), 1, 'moved product must appear in target draft immediately without refresh');
  assert.equal(await targetGroup.locator('[data-vendor-sku="9999"]').getByRole('spinbutton').inputValue(), '25', 'unrelated unsaved quantity must survive transfer');
  assert.equal(store.vendorOrderLines.find(line => line.id === 'target-existing').shortageQuantity, 12, 'unsaved edits stay local');
  await page.waitForFunction(() => { const cards = [...document.querySelectorAll('[data-vendor-order-id="target"] [data-vendor-card-preview]')]; return cards.length === 2 && cards.every(card => { const image = card.querySelector('img'); return image?.complete && image.naturalWidth > 0; }); });
  await targetGroup.screenshot({ path: '.tmp/vendor-result-target.png' });
  await sourceGroup.locator('[data-vendor-sku="9001"]').getByRole('button', { name: '미납분재발주요청', exact: true }).click();
  await page.getByRole('dialog', { name: '입고 후 미납분재발주요청' }).getByRole('button', { name: '입고 확인 · 미납분재발주요청', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-vendor-order-id="sent"] [data-vendor-sku="9001"]'));
  assert.equal(store.vendorOrderLines.find(line => line.id === 'source-1').sentResolution.kind, 'reorder');
  assert.equal(reorder.rows().find(row => row.skuId === '9001').shortageQuantity, 2, 'original Coupang shortage2, not supplier order12');
  assert.deepEqual(discontinued.map(row => row.skuId), ['9000']);
  await page.locator('[data-vendor-sku="9003"]').getByRole("button", { name: "입고지연", exact: true }).click();
  await page.getByRole("textbox", { name: "입고지연 메모", exact: true }).fill("검증 지연");
  await page.getByRole("button", { name: "입고지연 저장", exact: true }).click();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "발주결과처리", exact: true }).click();
  assert(store.vendorOrderLines.some(line => line.id === "source-3" && line.receivingDelayedAt), "delay remains after reload");
  assert.deepEqual(await sourceGroup.locator('[data-vendor-sku]').evaluateAll(nodes => nodes.map(node => node.dataset.vendorSku)), ['9003'], 'only delayed product remains after reload');
  assert.equal(await targetGroup.locator('[data-vendor-sku="9002"]').count(), 1);
  await page.waitForFunction(() => { const image = document.querySelector('[data-vendor-order-id="sent"] [data-vendor-sku="9003"] [data-vendor-card-preview] img'); return image?.complete && image.naturalWidth > 0; });
  await sourceGroup.screenshot({ path: '.tmp/vendor-result-source.png' });
  await sourceGroup.locator('[data-vendor-sku="9003"]').getByRole('button', { name: '거래처 수정', exact: true }).click();
  await transferDialog.getByRole('textbox', { name: '거래처 이름 · 직접 입력 가능', exact: true }).fill('새로 만든 거래처');
  await transferDialog.getByRole('button', { name: '이동 수량 확인', exact: true }).click();
  await transferDialog.getByRole('button', { name: '확인 · 발주서 이동', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-vendor-group="새로 만든 거래처"] [data-vendor-sku="9003"]'));
  assert.equal(await sourceGroup.locator('[data-vendor-sku]').count(), 0, 'source has no outstanding products once delayed product is handled');
  assert.equal(store.vendorOrderDrafts.filter(draft => draft.vendorName === '새로 만든 거래처' && draft.status === 'draft').length, 1, 'new vendor gets one new draft');
  // Simulate subsequent sent orders, then transfer into a vendor with sent history only.
  const firstDestination = store.vendorOrderDrafts.find(draft => draft.vendorName === '새로 만든 거래처');
  for (const draft of store.vendorOrderDrafts.filter(draft => ['target',firstDestination.id].includes(draft.id))) { draft.status='sent'; draft.sentAt=new Date().toISOString(); }
  async function moveIntoSentVendor(sku, suffix) {
    await page.reload({waitUntil:'networkidle'});
    await targetGroup.getByRole('button',{name:'발주결과처리',exact:true}).click();
    await targetGroup.locator(`[data-vendor-sku="${sku}"]`).getByRole('button',{name:'거래처 수정',exact:true}).click();
    await transferDialog.getByRole('textbox',{name:'거래처 이름 · 직접 입력 가능',exact:true}).fill('새로 만든 거래처');
    await transferDialog.getByRole('button',{name:'이동 수량 확인',exact:true}).click();
    await transferDialog.getByRole('button',{name:'확인 · 발주서 이동',exact:true}).click();
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    const draft=store.vendorOrderDrafts.find(row=>row.vendorName==='새로 만든 거래처'&&!row.archivedAt&&row.status==='draft');
    assert(draft);
    const group=page.locator(`[data-vendor-order-id="${draft.id}"]`);
    assert.deepEqual(await group.locator('[data-vendor-sku]').evaluateAll(nodes=>nodes.map(node=>node.dataset.vendorSku)),[sku], 'new draft must exclude original sent products immediately');
    assert((await group.innerText()).startsWith(`새로 만든 거래처-${suffix}실제부족`),'additional order title must retain its sequence');
    assert.equal(store.vendorOrderLines.filter(line=>line.draftId===firstDestination.id).length,1,'original sent order unchanged');
    draft.status='sent'; draft.sentAt=new Date().toISOString();
  }
  await moveIntoSentVendor('9002',1);
  await moveIntoSentVendor('9999',2);
  assert.deepEqual(unmocked, [], `unexpected API: ${api.join(', ')}`);
  console.log('PASS: browser discontinue/reorder/transfer/delay and reload; existing and new target drafts appear immediately; local quantity preserved; reorder uses original shortage2 vs order12; all APIs intercepted, real reducers and routing in memory.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

async function expectCount(locator, count) { assert.equal(await locator.count(), count); }
