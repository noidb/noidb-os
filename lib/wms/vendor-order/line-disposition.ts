import type { VendorOrderDraftLine } from "./types";

export type VendorOrderLineDisposition = "discontinued" | "reorder" | "delayed" | "active";

export function classifyVendorOrderLine(line: VendorOrderDraftLine, catalogCurrentStatus?: string): VendorOrderLineDisposition {
  if (catalogCurrentStatus === "단종") return "discontinued";
  if ((line.reorderPendingQuantity || 0) > 0) return "reorder";
  if (line.receivingDelayedAt && !line.receivingDelayReleasedAt) return "delayed";
  return "active";
}

export function isActiveVendorOrderLine(line: VendorOrderDraftLine, catalogCurrentStatus?: string): boolean {
  const disposition = classifyVendorOrderLine(line, catalogCurrentStatus);
  return disposition === "active" || disposition === "delayed";
}
