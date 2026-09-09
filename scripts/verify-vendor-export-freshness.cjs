const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), ts = require("typescript");
const compiled = ts.transpileModule(fs.readFileSync("app/wms/picking/waves/[waveId]/vendor-orders/ExportPanel.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
const stale = [{ skuId: "DELETED", shortageQuantity: 12, memo: "옛 메모" }, { skuId: "KEEP", shortageQuantity: 12, memo: "옛 수량" }];
const latest = [{ skuId: "KEEP", shortageQuantity: 36, actualShortageQuantity: 5, memo: "최신 메모", optionLabel: "은색", barcode: "R-KEEP" }];
function flatten(node) {
  if (node == null || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  return typeof node === "object" ? [node, ...flatten(node.props?.children)] : [];
}
function harness(options = {}) {
  const state = [], refs = [], initialized = new Set(); let cursor = 0, calls = 0, marked = 0, revised = 0;
  const shared = [], rendered = [], downloads = [];
  class FixtureZip { file() { return this; } async generateAsync() { return new Blob(["zip"]); } }
  const module = { exports: {} };
  const jsx = (type, props) => ({ type, props: props || {} });
  const react = {
    useState: initial => { const index = cursor++; if (!initialized.has(index)) { state[index] = initial; initialized.add(index); } return [state[index], value => { state[index] = typeof value === "function" ? value(state[index]) : value; }]; },
    useRef: initial => { const index = cursor++; return refs[index] ||= { current: initial }; },
  };
  const nav = {
    canShare: () => !options.noShare,
    share: async data => { shared.push(data); if (options.shareCancels) throw Object.assign(new Error("cancel"), { name: "AbortError" }); if (options.shareFails && shared.length === 1) throw new Error("share failed"); },
  };
  const deps = {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "jszip": { __esModule: true, default: FixtureZip },
    "@/lib/wms/vendor-order/render-order-image": { renderVendorOrderImage: async (_vendor, lines) => { rendered.push(structuredClone(lines)); return options.imageFails ? null : new Blob(["verified image"]); } },
    "@/lib/wms/ui-tokens": { wmsColors: {}, wmsGreenDarkButton: {}, wmsPrimaryButton: {}, wmsSecondaryButton: {} },
  };
  vm.runInNewContext(compiled, { module, exports: module.exports, Error, Array, Blob, File: global.File || require("node:buffer").File, navigator: nav, window: { innerWidth: options.mobile ? 390 : 1280, matchMedia: () => ({ matches: Boolean(options.mobile) }) },
    URL: { createObjectURL: () => "blob:fixture", revokeObjectURL: () => {} },
    document: { body: { appendChild: () => {} }, createElement: () => ({ click() { downloads.push(this.download); }, remove: () => {} }) },
    require: name => { assert(deps[name], name); return deps[name]; } });
  const props = { wave: { id: "W1" }, vendorName: "창성", lines: stale, status: "approved", busy: Boolean(options.busy), statusSaving: Boolean(options.statusSaving),
    onBeforeExport: options.noGuard ? undefined : async () => { calls++; if (options.failure) throw options.failure; return options.getLatest ? options.getLatest() : options.empty ? [] : latest; },
    onMarkSent: () => { marked++; }, onReviseAgain: () => { revised++; } };
  const render = () => { cursor = 0; return module.exports.default(props); };
  const elements = () => flatten(render());
  const button = name => elements().find(node => node.type === "button" && node.props.children === name);
  const click = name => { const found = button(name); assert(found, "button " + name); found.props.onClick(); };
  const settle = async () => { for (let i = 0; i < 20 && render().props["aria-busy"] && !options.busy; i++) await tick(); };
  return { render, elements, button, click, settle, shared, rendered, downloads, calls: () => calls, marked: () => marked, revised: () => revised };
}
(async () => {
  const h = harness();
  assert.equal(h.button("메시지 미리보기"), undefined);
  assert.equal(h.button("메시지 복사"), undefined);
  h.click("카카오톡으로 공유"); await h.settle();
  assert.equal(h.calls(), 1, "share always checks current lines");
  assert.deepEqual(h.rendered, [latest]);
  assert(h.button("공유창 열기"), "prepared files expose an immediate user-gesture share button");
  assert.equal(h.shared.length, 0, "rendering never consumes the click permission by opening share late");
  h.click("공유창 열기"); await h.settle();
  assert.equal(h.shared.length, 1);
  assert.equal(h.shared[0].files.length, 1);
  assert.equal(h.shared[0].title, undefined);
  assert.equal(h.shared[0].text, undefined);

  const manyLines = Array.from({ length: 17 }, (_, index) => ({ ...latest[0], skuId: `KEEP-${index}` }));
  const paged = harness({ getLatest: async () => manyLines });
  paged.click("카카오톡으로 공유"); await paged.settle();
  assert.equal(paged.rendered.length, 3, "large vendor orders are split before exceeding mobile canvas limits");
  paged.click("공유창 열기"); await paged.settle();
  assert.equal(paged.shared[0].files.length, 3, "all PNG pages are shared in one action");

  const mobileFallback = harness({ mobile: true, getLatest: async () => manyLines, shareFails: true });
  mobileFallback.click("카카오톡으로 공유"); await mobileFallback.settle();
  mobileFallback.click("공유창 열기"); await mobileFallback.settle();
  assert(mobileFallback.button("1/3 페이지 공유"), "mobile multi-file failure switches to one-page sharing");
  mobileFallback.click("1/3 페이지 공유"); await mobileFallback.settle();
  assert(mobileFallback.button("2/3 페이지 공유"), "successful single-page sharing advances to the next page");

  for (const options of [{ empty: true }, { failure: new Error("최신 상태 서버 연결 실패") }, { noGuard: true }, { failure: Object.assign(new Error("원본 확인 시간 초과"), { name: "AbortError" }) }]) {
    const failed = harness(options); failed.click("카카오톡으로 공유"); await failed.settle();
    assert.equal(failed.shared.length + failed.rendered.length + failed.downloads.length, 0);
    const alert = failed.elements().find(node => node.props.role === "alert"); assert(alert, "failed checks must be visible");
    if (options.empty) assert.equal(alert.props.children, "모든 품목이 처리되어 보낼 발주가 없습니다.");
  }

  let release; const pending = harness({ getLatest: () => new Promise(resolve => { release = resolve; }) });
  pending.click("카카오톡으로 공유");
  assert(pending.elements().filter(node => node.type === "button").every(node => node.props.disabled), "every action locks during the check");
  pending.click("전송완료"); pending.click("발주내용 수정");
  assert.equal(pending.calls(), 1); assert.equal(pending.marked(), 0); assert.equal(pending.revised(), 0);
  release(latest); await pending.settle();
  assert.equal(pending.shared.length, 0);
  pending.click("공유창 열기"); await pending.settle(); assert.equal(pending.shared.length, 1);

  const busy = harness({ busy: true }); busy.click("카카오톡으로 공유"); assert.equal(busy.calls(), 0);
  assert(busy.button("전송완료"), "another vendor's save may lock actions without showing a false saving label");
  const ownSave = harness({ busy: true, statusSaving: true }); assert(ownSave.button("저장 중..."), "only the vendor being saved shows the saving label");
  const fallback = harness({ noShare: true }); fallback.click("카카오톡으로 공유"); await fallback.settle();
  assert.deepEqual(fallback.rendered, [latest]); assert.equal(fallback.downloads.length, 1); assert.equal(fallback.shared.length, 0);
  const fallbackMany = harness({ noShare: true, getLatest: async () => manyLines }); fallbackMany.click("카카오톡으로 공유"); await fallbackMany.settle();
  assert.equal(fallbackMany.downloads.length, 1, "desktop fallback downloads one archive instead of many separate files");
  assert.match(fallbackMany.downloads[0], /_3장\.zip$/, "the single fallback archive identifies its image count");
  const cancelled = harness({ shareCancels: true }); cancelled.click("카카오톡으로 공유"); await cancelled.settle(); cancelled.click("공유창 열기"); await cancelled.settle();
  assert.equal(cancelled.shared.length, 1); assert.equal(cancelled.elements().filter(node => node.props.role === "alert").length, 0);
  const imageFailed = harness({ imageFails: true }); imageFailed.click("카카오톡으로 공유"); await imageFailed.settle();
  assert.equal(imageFailed.shared.length, 0); assert(imageFailed.elements().some(node => node.props.role === "alert"));
  console.log("PASS export freshness: current PNGs prepare before immediate share; mobile multi-file fallback, removed menus, failures, locking, download, and cancellation are verified.");
})().catch(error => { console.error(error); process.exitCode = 1; });
