import type { VendorOrderDraftLine } from "./types";

export function isCompletedStockReplenishment(line: VendorOrderDraftLine): boolean {
  return Boolean(line.isStockReplenishment && line.receivingCompletedAt && line.shortageQuantity > 0 && (line.receivedQuantity || 0) >= line.shortageQuantity);
}

export function isVendorLineResolved(line: VendorOrderDraftLine): boolean {
  return Boolean(line.orderExclusion || line.vendorTransfer || line.sentResolution || isCompletedStockReplenishment(line));
}

/** Classify from this order's saved result, never from checkbox selection or SKU-wide status. */
export function vendorLineClassification(line: VendorOrderDraftLine): "resolved" | "delayed" | "pending" {
  if (isVendorLineResolved(line)) return "resolved";
  return line.receivingDelayedAt && !line.receivingDelayReleasedAt ? "delayed" : "pending";
}
