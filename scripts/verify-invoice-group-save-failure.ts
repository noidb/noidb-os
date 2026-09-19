import assert from "node:assert/strict";
import { SharedInvoiceGroupRepository } from "../lib/wms/invoice-group/shared-repository";
import { INVOICE_GROUP_LOCAL_STORAGE_KEY } from "../lib/wms/invoice-group/local-repository";
import type { InvoiceGroup } from "../lib/wms/invoice-group/types";

async function main() {
  // Isolated in-process storage and fetch; this test never contacts an API.
  const memory = new Map<string, string>();
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value); },
    } },
  });
  try {
    const before: InvoiceGroup = {
      id: "fixture-save", purchaseOrderNumbers: ["910000001"], expectedDate: "2026-09-23",
      fulfillmentCenter: "테스트 센터", mergedFromMultiplePo: false, stage: "shipment_completed",
      fulfillmentCenterPhone: "", fulfillmentCenterZip: "", fulfillmentCenterAddress: "",
      poConfirmations: [], skuCount: 1, totalQuantity: 1, shipmentInvoiceNumbers: [], shipmentNumbers: ["80000001"],
      createdAt: "2026-09-20T00:00:00.000Z", updatedAt: "2026-09-20T00:01:00.000Z",
    };
    memory.set(INVOICE_GROUP_LOCAL_STORAGE_KEY, JSON.stringify([before]));
    const repository = new SharedInvoiceGroupRepository();
    const dispatched: InvoiceGroup = { ...before, stage: "dispatched", updatedAt: "2026-09-20T00:02:00.000Z" };

    globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: "fixture rejected" }), { status: 409 });
    await assert.rejects(repository.save(dispatched), /fixture rejected/);
    assert.deepEqual(JSON.parse(memory.get(INVOICE_GROUP_LOCAL_STORAGE_KEY)!), [before]);
    globalThis.fetch = async () => { throw new Error("fixture offline"); };
    assert.deepEqual(await repository.list(), [before], "Failed dispatch must not appear in offline fallback");

    globalThis.fetch = async (_input, init) => {
      assert.equal(init?.method, "POST");
      assert.equal(JSON.parse(String(init?.body)).group.stage, "dispatched");
      return new Response(JSON.stringify({ ok: true, snapshot: { groups: [dispatched], excludedPurchaseOrderNumbers: {} } }));
    };
    await repository.save(dispatched);
    assert.deepEqual(JSON.parse(memory.get(INVOICE_GROUP_LOCAL_STORAGE_KEY)!), [dispatched]);
    console.log("PASS: rejected dispatch preserves cache; successful dispatch mirrors server result");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
