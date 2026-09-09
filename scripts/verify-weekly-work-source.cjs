const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const crypto = require("node:crypto");

// Real source wrappers, merge/resolver and analysis; every external read is a
// memory fixture, and unexpected dependencies fail instead of touching live data.
function loadModule(relative, dependencies) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.resolve(__dirname, "..", relative), "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(javascript, { module, exports: module.exports, Buffer, console, Error, URL, Date, structuredClone,
    require(name) { assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name} in ${relative}`); return dependencies[name]; },
  }, { filename: relative });
  return module.exports;
}
const rules = loadModule("lib/wms/weekly-work-types.ts", {});
const safety = loadModule("lib/wms/inbound-import-safety.ts", { "node:crypto": crypto });
const sku = loadModule("lib/wms/sku-normalize.ts", {});
const picking = loadModule("lib/wms/picking-wave/shared-store-types.ts", {});
const purchaseParser = loadModule("lib/wms/weekly-purchase-files.ts", { exceljs: {}, jszip: {} });
const analysis = loadModule("lib/wms/weekly-work-analysis.ts", {
  "node:crypto": crypto, "./inbound-import-safety": safety, "./product-catalog": sku,
  "./weekly-work-types": rules, "./vendor-order/aggregate": { toVendorOrderQuantity: n => Math.ceil(Math.max(0, n) / 12) * 12 },
});
const period = { startDate: "2026-09-01", endDate: "2026-09-07" };
const event = safety.parseInboundSourceRows([{ 발주번호: "140245699", "SKU ID": "39136021", SKU명: "fixture 상품", "입고/반출시각": "2026-09-07 10:00:00", 구분: "입고", 수량: "1" }], "receipt.xlsx")[0];
const dataset = { sourceFile: "receipt.xlsx", fingerprint: "fixture", items: [event] };
const poHeaders = ["발주번호", "SKU ID", "상품명", "발주수량", "확정수량", "발주현황"];
const history = [["발주번호", "SKU ID", "입고수량", "반출", "최근입고일"]];
const catalog = [{ skuId: "39136021", productName: "fixture 상품", productLink: "", vendorName: "fixture 거래처", imageUrl: "https://example.test/a.png", optionLabel: "", modelName: "", barcode: "", currentStock: "", currentStatus: "" }];
const sourceFile = { id: "file-1", name: "recent.zip", modifiedTime: "2026-09-08T01:00:00Z", size: "1" };
const sourceRow = { purchaseOrderNumber: "140245699", skuId: "39136021", orderedQuantity: 3, confirmedQuantity: 3, receivedQuantity: 1,
  productName: "fixture 상품", optionName: "", sourceContainerFile: sourceFile.name, sourceEntryFile: "PO_140245699.xlsx", sourceSheet: "Sheet1", sourceRow: 21, sourceModifiedTime: sourceFile.modifiedTime, sourceId: sourceFile.id };
function createHarness(options = {}) {
  const failures = new Set(options.failures || []);
  let manifestChanged = false;
  const purchaseRows = options.purchaseRows || [poHeaders];
  const files = options.files || [sourceFile];
  const parsed = options.parsed || [{ documents: [{ purchaseOrderNumber: sourceRow.purchaseOrderNumber, rows: [{ ...sourceRow, ...options.row }], source: sourceFile, sourceEntryFile: sourceRow.sourceEntryFile, sourceSheet: "Sheet1" }], errors: [] }];
  const external = {
    resolveDriveFolderPath: async parts => {
      if (parts[1] === "발주서리스트다운") { if (failures.has("manifest")) throw new Error("manifest unavailable"); return "purchase"; }
      if (failures.has("drive")) throw new Error("receipt drive unavailable"); return "receive";
    },
    listOAuthDriveFolderFiles: async folder => folder === "receive" ? [] : manifestChanged ? [...files, { ...sourceFile, id: "changed" }] : files,
    downloadOAuthDriveFile: async id => {
      if (failures.has("download")) throw new Error("download unavailable");
      if (options.changeDuringRead) manifestChanged = true;
      return Buffer.from(id);
    },
  };
  const cache = { createParsedFileCache: () => async (_namespace, _key, reader) => (await reader()).value };
  const purchaseSource = loadModule("lib/wms/weekly-purchase-source.ts", {
    "node:crypto": crypto, "./google-drive-oauth-reader": external, "./parsed-file-cache": cache,
    "./weekly-purchase-files": { ...purchaseParser, parseWeeklyPurchaseFile: async bytes => structuredClone(parsed[files.findIndex(file => file.id === bytes.toString())]) },
  });
  const store = picking.emptyPickingWaveStoreSnapshot();
  const source = loadModule("lib/wms/weekly-work-source.ts", {
    "node:crypto": crypto, "./weekly-work-analysis": analysis, "./inbound-import-context": { readInboundWorkbook: () => { throw new Error("Unexpected workbook read"); } },
    "./inbound-import-safety": safety, "./google-drive-oauth-reader": external, "./parsed-file-cache": cache,
    "./google-sheets": { fetchSheetRows: async sheet => { const channel = sheet === "_입고요약" ? "history" : "purchases"; if (failures.has(channel)) throw new Error(`${channel} unavailable`); return structuredClone(channel === "history" ? history : purchaseRows); } },
    "./product-catalog": { fetchProductCatalog: async () => { if (failures.has("catalog")) throw new Error("catalog unavailable"); return { configured: true, items: structuredClone(catalog) }; } },
    "./picking-wave/server-store": { readPickingWaveStore: async () => { if (failures.has("picking")) throw new Error("picking unavailable"); return structuredClone(store); } },
    "./picking-wave/shared-store-types": picking, "./weekly-work-store": { readWeeklyWorkspace: async () => { if (failures.has("workspace")) throw new Error("workspace unavailable"); return { runs: [], productOverrides: {} }; } },
    "./weekly-purchase-source": purchaseSource,
  });
  return { source, analyze: () => source.loadWeeklySnapshot(period, { uploadedDatasets: [structuredClone(dataset)] }) };
}
async function main() {
  const good = createHarness();
  const snapshot = await good.analyze();
  assert.equal(snapshot.rulesVersion, 4);
  assert.equal(snapshot.vendorItems.length, 1);
  assert.equal(snapshot.vendorItems[0].shortageQuantity, 2);
  assert.equal(snapshot.source.supplementedPurchaseRows, 1);
  assert.equal(snapshot.operationalToken, await good.source.readWeeklyOperationalToken(), "analyzed and freshly read source tokens must agree despite supplemented read-model rows");
  assert.equal(snapshot.id, (await good.analyze()).id, "same-source repeated analysis has stable identity");
  for (const failure of ["manifest", "download", "drive", "history", "purchases"]) {
    const failed = await createHarness({ failures: [failure] }).analyze();
    assert.equal(failed.vendorItems.length, 0, `${failure}: unreadable receipt/order source never produces a shortage`);
    assert.ok(failed.unresolvedItems.length, `${failure}: unavailable data remains separately explainable`);
    assert.equal(failed.couponItems.length, 1, `${failure}: verified uploaded receipt still supplies the coupon candidate`);
  }
  const changed = await createHarness({ changeDuringRead: true }).analyze();
  assert.equal(changed.vendorItems.length, 0, "file upload during parse cannot expose stale source totals");
  assert.equal(changed.operationalToken, undefined);
  const mismatch = await createHarness({ row: { receivedQuantity: 2 } }).analyze();
  assert.equal(mismatch.vendorItems.length, 0, "I column is checked against actual receipt detail totals");
  assert.equal(mismatch.couponItems.length, 1, "PO I values never manufacture dated coupon receipts");
  const existing = [poHeaders, ["140245699", "39136021", "fixture 상품", "3", "3", "발주확정"]];
  const missing = await createHarness({ purchaseRows: existing, files: [], parsed: [] }).analyze();
  assert.equal(missing.vendorItems.length, 0, "an old ledger row without an available PO original must stay unresolved");
  const blankReceived = await createHarness({ row: { receivedQuantity: null } }).analyze();
  assert.equal(blankReceived.vendorItems.length, 0, "missing original cumulative receipt cannot be silently certified");
  const newerFile = { ...sourceFile, id: "newer", name: "newer.zip", modifiedTime: "2026-09-08T02:00:00Z" };
  const newerBroken = await createHarness({ purchaseRows: existing, files: [sourceFile, newerFile], parsed: [
    { documents: [{ purchaseOrderNumber: sourceRow.purchaseOrderNumber, rows: [sourceRow], source: sourceFile, sourceEntryFile: sourceRow.sourceEntryFile, sourceSheet: "Sheet1" }], errors: [] },
    { documents: [], errors: [{ code: "ITEM_INVALID", message: "newest H quantity is invalid", purchaseOrderNumber: "140245699", sourceFile: newerFile.name, sourceModifiedTime: newerFile.modifiedTime, sourceId: newerFile.id }] },
  ] }).analyze();
  assert.equal(newerBroken.vendorItems.length, 0, "a broken latest original cannot be filled from an older valid original or ledger");
  assert.ok(newerBroken.unresolvedItems[0].issues.some(issue => issue.includes("newest H")));
  const errorFiles = [sourceFile, newerFile];
  const errorResults = errorFiles.map(file => ({ documents: [], errors: [{ code: "ITEM_INVALID", message: `${file.name} invalid`, purchaseOrderNumber: "140245699", sourceFile: file.name, sourceModifiedTime: file.modifiedTime, sourceId: file.id }] }));
  const orderedErrors = await createHarness({ purchaseRows: existing, files: errorFiles, parsed: errorResults }).analyze();
  const reversedErrors = await createHarness({ purchaseRows: existing, files: [...errorFiles].reverse(), parsed: [...errorResults].reverse() }).analyze();
  assert.equal(orderedErrors.id, reversedErrors.id, "equivalent parse failures keep stable identity despite parallel source completion order");
  console.log("weekly-work-source: real merge/resolver/analysis, unchanged tokens, missing/unreadable/latest-broken originals, I validation and source races passed; VM fixtures only, zero operating writes");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
