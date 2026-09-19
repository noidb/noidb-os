import { NextResponse } from "next/server";
import { summarizeClosedShipmentHistory, summarizeClosedShipmentHistoryDates, type ClosedShipmentMetadata } from "@/lib/wms/closed-shipment-history";
import { readInvoiceGroupStore } from "@/lib/wms/invoice-group/server-store";
import { readWeeklyWorkspace } from "@/lib/wms/weekly-work-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0" };

function metadataByShipment(groups: Awaited<ReturnType<typeof readInvoiceGroupStore>>["groups"], saved: Record<string, ClosedShipmentMetadata> | undefined) {
  const metadata = new Map<string, ClosedShipmentMetadata | undefined>();
  const savedShipmentNumbers = new Set(Object.keys(saved || {}));
  for (const [shipmentNumber, value] of Object.entries(saved || {})) metadata.set(shipmentNumber, value);
  for (const group of groups) for (const shipmentNumber of group.shipmentNumbers) {
    if (savedShipmentNumbers.has(shipmentNumber)) continue;
    const next = { expectedDate: group.expectedDate, centerName: group.fulfillmentCenter };
    const existing = metadata.get(shipmentNumber);
    if (existing && (existing.expectedDate !== next.expectedDate || existing.centerName !== next.centerName)) {
      metadata.set(shipmentNumber, undefined);
    } else if (!metadata.has(shipmentNumber)) metadata.set(shipmentNumber, next);
  }
  return metadata;
}

/** Read-only history of the last saved closed-shipment receipt snapshot. */
export async function GET() {
  try {
    const [workspace, invoiceGroups] = await Promise.all([readWeeklyWorkspace(), readInvoiceGroupStore()]);
    const rows = summarizeClosedShipmentHistory(workspace.logisticsReceipts, metadataByShipment(invoiceGroups.groups, workspace.logisticsReceipts?.shipmentMetadata));
    return NextResponse.json({
      ok: true,
      collectedAt: workspace.logisticsReceipts?.collectedAt || null,
      rows,
      dates: summarizeClosedShipmentHistoryDates(rows),
    }, { headers });
  } catch {
    return NextResponse.json({ ok: false, error: "저장된 마감 쉽먼트 이력을 불러오지 못했습니다." }, { status: 500, headers });
  }
}
