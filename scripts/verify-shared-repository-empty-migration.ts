import assert from "node:assert/strict";
import { SharedPickingWaveRepository } from "../lib/wms/picking-wave/shared-repository";
import { SharedVendorOrderRepository } from "../lib/wms/vendor-order/shared-repository";
import { PICKING_WAVE_LOCAL_STORAGE_KEYS } from "../lib/wms/picking-wave/local-repository";
import { VENDOR_ORDER_LOCAL_STORAGE_KEYS } from "../lib/wms/vendor-order/local-repository";

class Storage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) || null; }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
  removeItem(key: string) { this.values.delete(key); }
}
const snapshot = { schemaVersion: 1, revision: 1, updatedAt: "2026-09-20T00:00:00.000Z", waves: [], items: [], baskets: [], poConfirmationRecords: [], vendorOrderDrafts: [], vendorOrderLines: [] };
const storage = new Storage();
(globalThis as any).window = { localStorage: storage };
const methods: string[] = [];
(globalThis as any).fetch = async (_url: string, options?: RequestInit) => {
  methods.push(options?.method || "GET");
  return { ok: true, status: 200, json: async () => ({ ok: true, snapshot }), headers: { get: () => null } };
};

(async () => {
  await new SharedPickingWaveRepository().listWaves();
  assert.deepEqual(methods, ["GET", "GET"], "empty picking cache must only read the server");
  methods.length = 0; storage.removeItem("noidb_picking_wave_shared_migration_v1");
  storage.setItem(PICKING_WAVE_LOCAL_STORAGE_KEYS.waves, JSON.stringify([{ id: "local-wave" }]));
  await new SharedPickingWaveRepository().listWaves();
  assert.deepEqual(methods, ["POST", "GET"], "nonempty picking cache must migrate before reading");

  methods.length = 0; storage.removeItem("noidb_vendor_order_shared_migration_v1");
  storage.removeItem(VENDOR_ORDER_LOCAL_STORAGE_KEYS.drafts); storage.removeItem(VENDOR_ORDER_LOCAL_STORAGE_KEYS.lines);
  await new SharedVendorOrderRepository().listAllDrafts();
  assert.deepEqual(methods, ["GET", "GET"], "empty vendor cache must only read the server");
  methods.length = 0; storage.removeItem("noidb_vendor_order_shared_migration_v1");
  storage.setItem(VENDOR_ORDER_LOCAL_STORAGE_KEYS.lines, JSON.stringify([{ id: "local-line" }]));
  await new SharedVendorOrderRepository().listAllDrafts();
  assert.deepEqual(methods, ["POST", "GET"], "nonempty vendor cache must migrate before reading");
  console.log("PASS empty shared repositories use GET only; nonempty caches still migrate");
})().catch(error => { console.error(error); process.exitCode = 1; });
