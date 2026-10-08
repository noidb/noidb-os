import assert from "node:assert/strict";
import { openVendorOrdersBySku } from "../lib/wms/open-vendor-orders";
const line = (id: string, draftId: string, skuId: string, extra: Record<string, unknown> = {}) => ({ id, draftId, waveId: draftId.split("::")[0], vendorName: draftId.split("::")[1], skuId, shortageQuantity: 12, receivedQuantity: 0, updatedAt: "2026-09-30T01:00:00Z", createdAt: "2026-09-30T01:00:00Z", ...extra });
const store = {
  vendorOrderDrafts: [
    { id: "W1::거래처A", waveId: "W1", vendorName: "거래처A", status: "sent", sentAt: "2026-09-30T02:00:00Z" },
    { id: "W2::거래처B", waveId: "W2", vendorName: "거래처B", status: "draft" },
  ],
  vendorOrderLines: [
    line("a", "W1::거래처A", "100"),
    line("b", "W1::거래처A", "200", { receivingDelayedAt: "2026-10-05T00:00:00Z", receivedQuantity: 4 }),
    line("c", "W1::거래처A", "300", { receivedQuantity: 12, receivingCompletedAt: "x" }),
    line("d", "W2::거래처B", "400"),
  ],
  deletedVendorLineIds: {}, deletedVendorDraftIds: {},
} as never;
const result = openVendorOrdersBySku(store);
assert.deepEqual(result["100"], { quantity: 12, vendors: ["거래처A"], sentOn: "2026-09-30", delayed: false });
assert.deepEqual(result["200"], { quantity: 8, vendors: ["거래처A"], sentOn: "2026-09-30", delayed: true });
assert.equal(result["300"], undefined, "fully received is not open");
assert.equal(result["400"], undefined, "unsent draft is merged elsewhere, not shown");
console.log("PASS open vendor orders: sent & not received, delayed flag, remaining quantity");
