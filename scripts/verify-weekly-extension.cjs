const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const core = require("../browser-extension/noidb-supplier-sync/weekly-core.js");
const dir = path.resolve(__dirname, "../browser-extension/noidb-supplier-sync");
const request = { requestId: "weekly-test-001", startDate: "2026-08-07", endDate: "2026-09-07" };
const headers = ["구분", "번호", "SKU 번호", "SKU 명", "입고/반출일자", "물류센터", "세금타입", "수량"];
const makeRows = (start, count) => Array.from({ length: count }, (_, index) => ["발주", "140000000", String(start + index), `상품 ${start + index}`, "2026-09-07 01:33:37", "YAS1", "과세", "1"]);
function page(number, total = 39, pageSize = 10) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return { ...request, pageNumber: number, totalCount: total, totalCountObserved: number === 1, headers, rows: makeRows((number - 1) * pageSize + 1, Math.min(pageSize, Math.max(0, total - (number - 1) * pageSize))), filtersClear: true,
    nextPageNumber: number < pageCount ? number + 1 : null, paginationHighestPage: Math.min(pageCount, Math.ceil(number / 10) * 10), paginationPageCount: number === pageCount ? pageCount : null };
}
const initial = () => ({ ...request, pages: [] });
assert.equal(core.validateRequest(request), "");
assert.match(core.validateRequest({ ...request, startDate: "2026-02-30" }), /시작일/);
assert.match(core.validateRequest({ ...request, requestId: "../another" }), /번호/);
assert.match(core.validateRequest({ ...request, startDate: "2025-01-01" }), /93일/);
assert.equal(core.allowedSite("https://noidb-os.vercel.app/wms/inbound"), true);
assert.equal(core.allowedSite("http://localhost:3000/wms/inbound?test=1"), true);
assert.equal(core.allowedSite("https://noidb-os.vercel.app.attacker.test/wms/inbound"), false);
assert.equal(core.allowedSite("https://noidb-os.vercel.app/other"), false);
assert.equal(new URL(core.receiptUrl(request, 2)).searchParams.has("totalCount"), false, "이전 페이지가 캐시한 합계를 재전송하지 않아야 합니다.");
assert.equal(new URL(core.receiptUrl(request, 2)).searchParams.get("page"), "2");
assert.equal(new URL(core.receiptUrl(request)).searchParams.has("page"), false, "최초 조회는 검색 건수를 새로 계산하도록 page 파라미터를 보내지 않습니다.");
let capture = initial();
for (let number = 1; number <= 4; number += 1) capture = core.appendPage(capture, page(number));
const payload = core.completePayload(capture);
assert.equal(payload.rows.length, 39);
assert.equal(payload.coverageComplete, true);
assert.equal(payload.headers[2], "SKU번호");
assert.equal(payload.headers[4], "입고/반출시각");
assert.equal(core.verifyFreshFirstPage(capture, page(1)).rows.length, 39);
assert.throws(() => core.verifyFreshFirstPage(capture, { ...page(1), totalCount: 40 }), /건수가 변경/);
assert.throws(() => core.verifyFreshFirstPage(capture, { ...page(1), rows: makeRows(100, 10) }), /첫 페이지가 변경/);
assert.throws(() => core.verifyFreshFirstPage(capture, { ...page(1), totalCountObserved: false }), /직접 확인/);
assert.throws(() => core.completePayload(core.appendPage(initial(), page(1))), /모든 페이지/);
assert.throws(() => core.appendPage(initial(), { ...page(1), filtersClear: false }), /필터/);
assert.throws(() => core.appendPage(initial(), { ...page(1), startDate: "2026-07-01" }), /기간/);
assert.throws(() => core.appendPage(initial(), { ...page(1), rows: [[...makeRows(1, 1)[0].slice(0, 4), "2026-07-01", ...makeRows(1, 1)[0].slice(5)]] }), /기간 밖/);
assert.throws(() => core.appendPage(initial(), { ...page(1), nextPageNumber: null }), /다음 페이지/);
const first = core.appendPage(initial(), page(1));
assert.throws(() => core.appendPage(first, { ...page(2), totalCount: 40 }), /건수가 변경/);
assert.throws(() => core.appendPage(first, { ...page(2), rows: page(1).rows }), /반복/);
assert.throws(() => core.appendPage(first, { ...page(2), rows: page(2).rows.slice(0, 9) }), /예상 10행/);
assert.throws(() => core.appendPage(first, page(3)), /2페이지/);
assert.throws(() => core.appendPage(initial(), { ...page(1), totalCount: 10 }), /더 많은 페이지/);
assert.equal(core.completePayload(core.appendPage(initial(), page(1, 0))).rows.length, 0);
let many = initial();
for (let number = 1; number <= 21; number += 1) many = core.appendPage(many, page(number, 205));
assert.equal(core.completePayload(many).rows.length, 205, "페이지 번호가 10개씩 묶여도 전체 21페이지를 검증해야 합니다.");
// SKU duplicates are valid receipt events; deduplication belongs to period-wide coupon generation.
const repeatedSkuPage = page(1, 2);
repeatedSkuPage.rows[1][2] = repeatedSkuPage.rows[0][2];
repeatedSkuPage.rows[1][1] = "140000001";
assert.equal(core.completePayload(core.appendPage(initial(), repeatedSkuPage)).rows.length, 2);

async function verifyBackground() {
  const stored = {};
  const sent = [];
  const updates = [];
  let listener;
  let nextTab = 100;
  const chrome = {
    storage: { local: {
      get: async keys => keys === null ? { ...stored } : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, stored[key]])),
      set: async values => Object.assign(stored, structuredClone(values)),
      remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]; },
    } },
    tabs: { create: async () => ({ id: nextTab++ }), update: async (id, data) => { updates.push({ id, ...data }); }, sendMessage: async (id, message) => { sent.push({ id, message }); }, onRemoved: { addListener() {} } },
    runtime: { onMessage: { addListener(value) { listener = value; } } },
  };
  const context = vm.createContext({ chrome, console, URL, Date, Map, Promise, NOIDBWeeklyCore: core, importScripts() {} });
  vm.runInContext(fs.readFileSync(path.join(dir, "weekly-background.js"), "utf8"), context);
  const dispatch = (message, sender) => new Promise(resolve => { if (listener(message, sender, resolve) === false) resolve({}); });
  const site = { tab: { id: 7 }, frameId: 0, url: "https://noidb-os.vercel.app/wms/inbound" };
  const supplier = { tab: { id: 100 }, frameId: 0, url: core.receiptUrl(request) };
  assert.equal((await dispatch({ type: "NOIDB_WEEKLY_COLLECT_REQUEST", ...request }, { ...site, frameId: 1 })).accepted, false);
  assert.equal((await dispatch({ type: "NOIDB_WEEKLY_COLLECT_REQUEST", ...request }, site)).accepted, true);
  assert.equal(updates[0].url, core.receiptUrl(request));
  assert.equal((await dispatch({ type: "NOIDB_WEEKLY_SUPPLIER_READY" }, { ...supplier, tab: { id: 101 } })).request, undefined);
  assert.equal((await dispatch({ type: "NOIDB_WEEKLY_SUPPLIER_READY" }, supplier)).request.expectedPage, 1);
  assert.equal((await dispatch({ type: "NOIDB_WEEKLY_PAGE", requestId: request.requestId, page: page(1) }, { ...supplier, url: "https://supplier.coupang.com.evil.test/scm/receive/detail" })).accepted, false);
  assert.equal((await dispatch({ type: "NOIDB_WEEKLY_PAGE", requestId: request.requestId, phase: "collect", page: page(1) }, { ...supplier, url: core.receiptUrl({ ...request, startDate: "2026-08-08" }) })).accepted, false, "수집 탭의 실제 주소 기간과 payload가 다르면 거절합니다.");
  assert.equal((await dispatch({ type: "NOIDB_WEEKLY_PAGE", requestId: request.requestId, phase: "collect", page: page(1) }, { ...supplier, url: core.receiptUrl(request, 2) })).accepted, false, "수집 탭의 실제 페이지와 payload가 다르면 거절합니다.");
  for (let number = 1; number <= 4; number += 1) {
    const response = await dispatch({ type: "NOIDB_WEEKLY_PAGE", requestId: request.requestId, phase: "collect", page: page(number) }, { ...supplier, url: core.receiptUrl(request, number) });
    assert.equal(response.accepted, true);
    assert.equal(sent.some(item => item.message.type === "NOIDB_INBOUND_EXTENSION_TRANSFER"), false, "최종 새조회 확인 전에는 전송하지 않아야 합니다.");
    if (number < 4) {
      assert.equal(response.nextUrl, core.receiptUrl(request, number + 1));
      assert.equal(sent.some(item => item.message.type === "NOIDB_INBOUND_EXTENSION_TRANSFER"), false, "부분 페이지는 전송하지 않아야 합니다.");
    }
  }
  assert.equal((await dispatch({ type: "NOIDB_WEEKLY_SUPPLIER_READY" }, supplier)).request.phase, "verify");
  assert.equal((await dispatch({ type: "NOIDB_WEEKLY_PAGE", requestId: request.requestId, phase: "collect", page: page(1) }, supplier)).accepted, false, "이전 단계의 재전송으로 최종 새 조회를 건너뛰면 안 됩니다.");
  const completed = await dispatch({ type: "NOIDB_WEEKLY_PAGE", requestId: request.requestId, phase: "verify", page: page(1) }, supplier);
  assert.equal(completed.complete, true);
  const transferred = sent.find(item => item.message.type === "NOIDB_INBOUND_EXTENSION_TRANSFER");
  assert.equal(transferred.id, 7);
  assert.equal(transferred.message.payload.rows.length, 39);
  const transferKey = `noidbWeeklyTransfer:${request.requestId}`;
  await dispatch({ type: "NOIDB_INBOUND_EXTENSION_ACK", transferId: request.requestId, accepted: true }, { ...site, tab: { id: 8 } });
  assert.ok(stored[transferKey], "다른 탭의 ACK는 자료를 지우면 안 됩니다.");
  await dispatch({ type: "NOIDB_INBOUND_EXTENSION_ACK", transferId: request.requestId, accepted: false }, site);
  assert.ok(stored[transferKey], "분석 거절 ACK는 자료를 보존해야 합니다.");
  await dispatch({ type: "NOIDB_INBOUND_EXTENSION_ACK", transferId: "different", accepted: true }, site);
  assert.ok(stored[transferKey]);
  await dispatch({ type: "NOIDB_INBOUND_EXTENSION_ACK", transferId: request.requestId, accepted: true }, site);
  assert.equal(stored[transferKey], undefined);
  assert.equal(stored[`noidbWeeklySession:${request.requestId}`], undefined);
  const retry = { ...request, requestId: "weekly-retry" };
  await dispatch({ type: "NOIDB_WEEKLY_COLLECT_REQUEST", ...retry }, site);
  await dispatch({ type: "NOIDB_WEEKLY_PAGE", requestId: retry.requestId, phase: "collect", page: { ...page(1), filtersClear: false } }, { ...supplier, tab: { id: 101 } });
  assert.equal(stored["noidbWeeklyTransfer:weekly-retry"], undefined);
  assert.equal(stored["noidbWeeklySession:weekly-retry"].state, "error");
  assert.ok(sent.some(item => item.message.type === "NOIDB_WEEKLY_COLLECT_STATUS" && item.message.status === "error"));
  const empty = { ...request, requestId: "weekly-empty" };
  await dispatch({ type: "NOIDB_WEEKLY_COLLECT_REQUEST", ...empty }, site);
  const emptySupplier = { ...supplier, tab: { id: 102 } };
  await dispatch({ type: "NOIDB_WEEKLY_PAGE", requestId: empty.requestId, phase: "collect", page: page(1, 0) }, emptySupplier);
  assert.equal(stored["noidbWeeklyTransfer:weekly-empty"], undefined);
  assert.equal((await dispatch({ type: "NOIDB_WEEKLY_PAGE", requestId: empty.requestId, phase: "verify", page: page(1, 0) }, emptySupplier)).complete, true);
  assert.equal(stored["noidbWeeklyTransfer:weekly-empty"].rows.length, 0, "검색 결과 0건도 새 조회로 확인하고 정상 빈 결과를 전달합니다.");
  assert.equal(stored["noidbWeeklyTransfer:weekly-empty"].coverageComplete, true);
}

async function verifyBridge() {
  const handlers = {};
  const output = [];
  const messages = [];
  let onRuntime;
  const origin = "https://noidb-os.vercel.app";
  const window = { location: { href: `${origin}/wms/work-center`, origin }, addEventListener: (type, handler) => { handlers[type] = handler; }, postMessage: message => output.push(message), setInterval: () => 1, clearInterval() {} };
  const chrome = { runtime: { sendMessage: async message => { messages.push(message); return { accepted: true }; }, onMessage: { addListener(handler) { onRuntime = handler; } } } };
  const context = vm.createContext({ window, chrome, Date, Map, NOIDBWeeklyCore: core });
  vm.runInContext(fs.readFileSync(path.join(dir, "noidb-weekly-bridge.js"), "utf8"), context);
  const data = { type: "NOIDB_WEEKLY_COLLECT_REQUEST", ...request };
  window.location.href = `${origin}/wms/inbound`; // Next.js client navigation must still connect.
  await handlers.message({ source: {}, origin, data });
  await handlers.message({ source: window, origin: "https://attacker.test", data });
  assert.equal(messages.length, 0);
  await handlers.message({ source: window, origin, data });
  assert.equal(messages[0].type, data.type);
  assert.equal(output[0].type, "NOIDB_WEEKLY_COLLECT_ACK");
  onRuntime({ type: "NOIDB_INBOUND_EXTENSION_TRANSFER", payload: { transferId: "stale", coverageComplete: true } });
  assert.equal(output.length, 1);
  onRuntime({ type: "NOIDB_INBOUND_EXTENSION_TRANSFER", payload });
  assert.equal(output[1].type, "NOIDB_INBOUND_EXTENSION_TRANSFER");
  await handlers.message({ source: window, origin, data: { type: "NOIDB_INBOUND_EXTENSION_ACK", transferId: request.requestId, accepted: false } });
  assert.equal(messages.length, 1);
  await handlers.message({ source: window, origin, data: { type: "NOIDB_INBOUND_EXTENSION_ACK", transferId: request.requestId, accepted: true } });
  assert.equal(messages[1].type, "NOIDB_INBOUND_EXTENSION_ACK");
}

(async () => {
  await verifyBackground();
  await verifyBridge();
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.permissions, ["storage"], "주간 조회에 tabs/scripting/cookies 권한을 추가하지 않아야 합니다.");
  assert.equal(manifest.background.service_worker, "weekly-background.js");
  for (const filename of [manifest.background.service_worker, ...manifest.content_scripts.flatMap(script => script.js)]) assert.ok(fs.existsSync(path.join(dir, filename)));
  console.log("주간 입고 확장 검증 완료: 전체 페이지·기간·건수·최종 새조회·빈 결과·탭/출처 격리·ACK 일치·부분 수집 차단");
})().catch(error => { console.error(error); process.exitCode = 1; });
