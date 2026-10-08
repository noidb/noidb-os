import assert from "node:assert/strict";
import { reconcileIncompleteVendorRoutes } from "../lib/wms/logistics-receipt-routing";
const old = "2026-10-08T03:00:00.000Z", now = Date.parse("2026-10-08T03:10:00.000Z");
const ws = () => ({ schemaVersion: 1, revision: 0, productOverrides: {},
  runs: [{ id: "R1", revision: 0, logisticsReceiptLine: { skuId: "36786774" }, itemRoutes: { "36786774": { decision: "order", at: old, completed: false } } },
         { id: "R2", revision: 0, logisticsReceiptLine: { skuId: "2" }, itemRoutes: {} }],
  logisticsReceiptRoutes: { L1: { decision: "vendor", runId: "R1", at: old, completed: false, quantity: 2, sourceFingerprint: "f" },
                            L2: { decision: "vendor", runId: "R2", at: old, completed: false, quantity: 1, sourceFingerprint: "g" },
                            L3: { decision: "reorder", runId: "R3", at: old, completed: true, quantity: 1, sourceFingerprint: "h" } } }) as never as any;
const store = { vendorOrderLines: [{ id: "v1", shipmentReceiptDetails: [{ lineKey: "L1" }] }], deletedVendorLineIds: {}, vendorQueueReceipts: { R1: { queueId: "Q", at: old, added: 1, duplicates: 0, sourceLines: [] } } } as never;
const w = ws();
assert.equal(reconcileIncompleteVendorRoutes(w, store, now), 2);
assert.equal(w.logisticsReceiptRoutes.L1.completed, true, "실제 발주서에 있으면 완료");
assert.equal(w.logisticsReceiptRoutes.L2, undefined, "발주서에 없고 2분 지난 예약은 삭제");
assert.equal(w.runs.some((r: any) => r.id === "R2"), false);
assert.equal(w.logisticsReceiptRoutes.L3.completed, true, "다른 분류는 그대로");
const fresh = ws(); fresh.logisticsReceiptRoutes.L2.at = "2026-10-08T03:09:30.000Z";
reconcileIncompleteVendorRoutes(fresh, store, now);
assert.ok(fresh.logisticsReceiptRoutes.L2, "진행 중일 수 있는 2분 이내 예약은 남김");
console.log("PASS incomplete vendor routes: complete if placed, drop stale reservation, keep in-flight");
