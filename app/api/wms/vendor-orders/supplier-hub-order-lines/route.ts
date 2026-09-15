import { NextRequest, NextResponse } from "next/server";
import { mutatePickingWaveStore, readPickingWaveStore } from "@/lib/wms/picking-wave/server-store";
import type { SupplierHubOriginalOrderLine } from "@/lib/wms/picking-wave/shared-store-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCE = "supplier-hub-extension";
const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseConfirmedQuantity(value: unknown): { value: number | null; issue?: string } {
  const raw = (typeof value === "number" ? String(value) : text(value)).replace(/,/g, "");
  if (!/^\d+$/.test(raw)) return { value: null, issue: "확정 발주수량 확인 필요" };
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return { value: null, issue: "확정 발주수량 확인 필요" };
  return { value: parsed };
}

function parseLines(value: unknown, collectedAt: string): SupplierHubOriginalOrderLine[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const quantity = parseConfirmedQuantity(row.confirmedOrderQuantity);
    return {
      orderNo: text(row.orderNo),
      skuId: text(row.skuId),
      confirmedOrderQuantity: quantity.value,
      skuName: text(row.skuName),
      expectedDate: text(row.expectedDate),
      warehouse: text(row.warehouse),
      purchaseType: text(row.purchaseType),
      collectedAt,
      ...(quantity.issue ? { sourceIssue: quantity.issue } : {}),
    };
  }).filter(line => line.orderNo && line.skuId);
}

export async function GET() {
  try {
    const snapshot = await readPickingWaveStore();
    return NextResponse.json({ ok: true, count: snapshot.supplierHubOriginalOrderLines.length, lines: snapshot.supplierHubOriginalOrderLines }, { headers: noStoreHeaders });
  } catch {
    return NextResponse.json({ ok: false, error: "발주 원본을 불러오지 못했습니다." }, { status: 500, headers: noStoreHeaders });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const collectedAt = text(body.collectedAt);
    if (text(body.source) !== SOURCE || !collectedAt || Number.isNaN(Date.parse(collectedAt))
      || !Array.isArray(body.lines) || body.lines.length > 10_000) {
      return NextResponse.json({ ok: false, error: "발주 원본 요청 형식이 올바르지 않습니다." }, { status: 400, headers: noStoreHeaders });
    }
    const lines = parseLines(body.lines, collectedAt);
    if (lines.length !== body.lines.length) {
      return NextResponse.json({ ok: false, error: "발주번호 또는 SKU ID가 없는 행이 있습니다." }, { status: 400, headers: noStoreHeaders });
    }
    const before = await readPickingWaveStore();
    const existing = new Map(before.supplierHubOriginalOrderLines.map(line => [JSON.stringify([line.orderNo, line.skuId]), line]));
    const newCount = lines.filter(line => !existing.has(JSON.stringify([line.orderNo, line.skuId]))).length;
    const changedCount = lines.filter(line => {
      const previous = existing.get(JSON.stringify([line.orderNo, line.skuId]));
      return previous && JSON.stringify(previous) !== JSON.stringify(line);
    }).length;
    const snapshot = await mutatePickingWaveStore({ action: "upsertSupplierHubOriginalOrderLines", lines });
    return NextResponse.json({ ok: true, received: lines.length, newCount, changedCount, count: snapshot.supplierHubOriginalOrderLines.length }, { headers: noStoreHeaders });
  } catch {
    return NextResponse.json({ ok: false, error: "발주 원본을 저장하지 못했습니다." }, { status: 500, headers: noStoreHeaders });
  }
}
