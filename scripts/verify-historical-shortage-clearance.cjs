const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const source = fs.readFileSync("lib/wms/historical-shortage-clearance.ts", "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} };
new Function("require", "module", "exports", output)(require, loaded, loaded.exports);
const { historicalShortageEvidence, historicalShortagePairKey } = loaded.exports;

const workspace = { schemaVersion: 1, revision: 0, runs: [], productOverrides: {} };
workspace.runs.push({ id: "old", snapshot: { id: "old", sourceToken: "x", createdAt: "2026-09-01T00:00:00.000Z", period: { startDate: "2026-08-01", endDate: "2026-08-31" }, source: { files: [], latestActualDate: "", firstActualDate: "", eventCount: 0, duplicateCount: 0, selectedEventCount: 0, mode: "drive" }, couponItems: [], vendorItems: [], warnings: [], blockers: [] }, reviews: {}, revision: 0, updatedAt: "2026-09-01T00:00:00.000Z", sentVendors: {}, reorderRequestedAt: "2026-09-02T00:00:00.000Z", reorderRequestedLines: [{ purchaseOrderNumber: "PO-1", skuId: "SKU-A", shortageQuantity: 2 }] });
const store = { vendorOrderDrafts: [{ id: "D", waveId: "W", vendorName: "V", status: "sent", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }], vendorOrderLines: [{ id: "L", draftId: "D", waveId: "W", vendorName: "V", skuId: "SKU-A", modelName: "", category: "", optionLabel: "", productName: "", imageUrl: "", barcode: "", shortageQuantity: 3, currentStock: "999", relatedPurchaseOrderNumbers: ["PO-2"], memo: "", isManuallyAdded: false, receivingDelayedAt: "2026-09-03T00:00:00.000Z", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-03T00:00:00.000Z" }] };
const result = historicalShortageEvidence(workspace, store);
assert.equal(result.find(row => historicalShortagePairKey(row.purchaseOrderNumber, row.skuId) === historicalShortagePairKey("PO-1", "SKU-A"))?.status, "already_resolved");
assert.equal(result.find(row => historicalShortagePairKey(row.purchaseOrderNumber, row.skuId) === historicalShortagePairKey("PO-2", "SKU-A"))?.status, "delayed");
assert.equal(result.length, 2, "같은 SKU라도 발주번호가 다르면 별도 근거로 유지해야 합니다.");
console.log("historical shortage clearance verification passed");
