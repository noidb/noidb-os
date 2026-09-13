import { NextRequest, NextResponse } from "next/server";
import { mutatePickingWaveStore, readPickingWaveStore } from "@/lib/wms/picking-wave/server-store";
import type { SupplierHubOrderStatus } from "@/lib/wms/picking-wave/shared-store-types";

const SOURCE = "supplier-hub-extension";

function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }

function parseStatuses(value: unknown, collectedAt: string): SupplierHubOrderStatus[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      orderNo: text(row.orderNo),
      purchaseType: text(row.purchaseType),
      settlementStatus: text(row.settlementStatus),
      progressStatus: text(row.progressStatus),
      collectedAt,
    };
  }).filter(row => row.orderNo);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    if (text(body.source) !== SOURCE) return NextResponse.json({ ok: false, error: "invalid source" }, { status: 400 });
    const collectedAt = text(body.collectedAt);
    if (!collectedAt || Number.isNaN(Date.parse(collectedAt))) return NextResponse.json({ ok: false, error: "invalid collectedAt" }, { status: 400 });
    const statuses = parseStatuses(body.orders, collectedAt);
    const before = await readPickingWaveStore();
    const existing = new Set(before.supplierHubOrderStatuses.map(row => row.orderNo));
    await mutatePickingWaveStore({ action: "upsertSupplierHubOrderStatuses", statuses });
    const upserted = statuses.filter(row => !existing.has(row.orderNo)).length;
    return NextResponse.json({ ok: true, received: statuses.length, upserted });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "invalid request" }, { status: 400 });
  }
}

export async function GET() {
  const snapshot = await readPickingWaveStore();
  return NextResponse.json({ ok: true, count: snapshot.supplierHubOrderStatuses.length, statuses: snapshot.supplierHubOrderStatuses });
}
