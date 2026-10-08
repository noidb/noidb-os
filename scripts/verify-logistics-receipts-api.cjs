const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const root = process.cwd();
const routeFile = path.join(root, "app/api/wms/logistics/receipts/route.ts");
let boardInput;
const snapshot = { collectedAt: "2026-09-20T00:00:00.000Z" };
let resetCalls = 0;
const workspace = { logisticsReceiptEpoch: "test-epoch", logisticsReceiptRoutes: {}, logisticsFollowUp: { exclusions: [{ lineKey: "marketing::excluded", skuId: "222", sourceFingerprint: "x", at: snapshot.collectedAt }] } };
const deps = {
  "next/server": { NextResponse: { json: (value, options) => new Response(JSON.stringify(value), { status: options?.status || 200, headers: options?.headers }) } },
  "@/lib/wms/logistics-aside-baseline.json": { closedShipmentNumbers: [], pendingTargets: [], completedMarketingSkuIds: [], excludedMarketingSkuIds: [], handledLines: [] },
  "@/lib/wms/picking-wave/server-store": { readPickingWaveStore: async () => ({}) },
  "@/lib/wms/open-vendor-orders": { openVendorOrdersBySku: () => ({}) },
  "@/lib/wms/product-catalog": { fetchProductCatalog: async () => ({ configured: true, items: [] }) },
  "@/lib/wms/marketing-permanent-exclusions": { MARKETING_PERMANENT_EXCLUDED_SKU_IDS: ["1"], expandMarketingExclusions: () => ({ skuIds: new Set(["1"]), models: [] }) },
  "@/lib/wms/logistics-receipt-reset": { resetLogisticsReceiptHistory: () => { resetCalls++; return false; } },
  "@/lib/wms/logistics-receipts": {
    LOGISTICS_RECEIPT_EPOCH: "test-epoch", LOGISTICS_RECEIPT_SINCE: "2026-09-13",
    logisticsTargetsFromSnapshot: () => [], needsProductDbStatusFill: () => false, fillSkuStatusesFromProductDb: () => 0, mergeHubClosedSnapshot: () => ({ ...snapshot, shipments: [] }),
    buildLogisticsReceiptBoard: input => { boardInput = input; return { lines: [], targets: [], warnings: [] }; },
  },
  "@/lib/wms/weekly-work-store": { mutateWeeklyWorkspace: async callback => callback(structuredClone(workspace)), readWeeklyWorkspace: async () => structuredClone(workspace) },
  "@/lib/wms/logistics-follow-up": { activeMarketingExclusionKeys: value => new Set(value.logisticsFollowUp.exclusions.map(item => item.lineKey)), logisticsFollowUpResponse: () => ({ queues: { discontinue: [] } }) },
  "@/lib/wms/weekly-discontinue-queue": { readWeeklyDiscontinueQueue: async () => ({}) },
  "@/lib/wms/logistics-discontinue-adapter": { previewFollowUpDiscontinue: () => [] },
};
const compiled = ts.transpileModule(fs.readFileSync(routeFile, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const loaded = { exports: {} };
vm.runInNewContext(compiled, { module: loaded, exports: loaded.exports, require: name => { if (!deps[name]) throw new Error(`unmocked ${name}`); return deps[name]; }, Response, JSON, Error, Set, URL, structuredClone });

(async () => {
  const request = new Request("http://test/api/wms/logistics/receipts", { method: "POST", body: JSON.stringify({ source: "supplier-hub-shipments" }) });
  const response = await loaded.exports.POST(request);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, count: 0, collectedAt: snapshot.collectedAt }, "save answers immediately without board work");
  const cors = await loaded.exports.POST(new Request("http://test/api/wms/logistics/receipts", { method: "POST", headers: { origin: "https://supplier.coupang.com" }, body: "{}" }));
  assert.equal(cors.headers.get("access-control-allow-origin"), "https://supplier.coupang.com");
  const light = await (await loaded.exports.GET(new Request("http://test/api/wms/logistics/receipts"))).json();
  assert.equal(light.since, "2026-09-13"); assert.deepEqual(light.targets, []);
  await loaded.exports.GET(new Request("http://test/api/wms/logistics/receipts?view=board"));
  assert.deepEqual([...boardInput.excludedMarketingLineKeys], ["marketing::excluded"]);
  assert(boardInput.baseline.excludedMarketingSkuIds.includes("1"), "permanent exclusions reach the board");
  assert.equal(resetCalls, 2, "every save runs the one-time history reset check (it no-ops after the first)");
  console.log("PASS receipt save answers fast with CORS for Supplier Hub; light collect GET; board keeps active marketing exclusions");
})().catch(error => { console.error(error); process.exitCode = 1; });
