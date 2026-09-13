import { NextRequest, NextResponse } from "next/server";
import { mutatePickingWaveStore, readPickingWaveStore } from "@/lib/wms/picking-wave/server-store";
import type { SupplierHubInboundEvent } from "@/lib/wms/picking-wave/shared-store-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" };
const requiredFields = ["orderNo", "skuId", "inboundDate", "quantity", "division", "warehouse", "skuName"] as const;
type InputEvent = Record<(typeof requiredFields)[number], unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoDate(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function isInboundDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value);
}

function isInputEvent(value: unknown): value is InputEvent {
  return isRecord(value) && requiredFields.every(field => field === "inboundDate" ? isInboundDate(value[field]) : isNonEmptyString(value[field]));
}

function eventKey(event: InputEvent): string {
  return JSON.stringify(requiredFields.map(field => event[field]));
}

export async function GET() {
  try {
    const snapshot = await readPickingWaveStore();
    const events = snapshot.supplierHubInboundEvents;
    return NextResponse.json({ ok: true, count: events.length, status: "ready", events }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "입고상세 이벤트를 불러오지 못했습니다." }, { status: 500, headers: noStoreHeaders });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    const rawEvents = isRecord(body) ? body.events : undefined;
    if (!isRecord(body) || body.source !== "supplier-hub-extension" || !isIsoDate(body.collectedAt)
      || !Array.isArray(rawEvents) || rawEvents.length > 10_000 || !rawEvents.every(isInputEvent)) {
      return NextResponse.json({ ok: false, error: "입고상세 이벤트 요청 형식이 올바르지 않습니다." }, { status: 400, headers: noStoreHeaders });
    }
    const collectedAt = body.collectedAt;
    const events: SupplierHubInboundEvent[] = rawEvents.map(event => ({
      id: eventKey(event),
      eventKey: eventKey(event),
      source: "supplier-hub-extension",
      collectedAt,
      orderNo: event.orderNo as string,
      skuId: event.skuId as string,
      inboundDate: event.inboundDate as string,
      quantity: event.quantity as string,
      division: event.division as string,
      warehouse: event.warehouse as string,
      skuName: event.skuName as string,
    }));
    const snapshot = await mutatePickingWaveStore({ action: "appendSupplierHubInboundEvents", events });
    return NextResponse.json({ ok: true, count: snapshot.supplierHubInboundEvents.length, receivedCount: events.length, events: snapshot.supplierHubInboundEvents }, { headers: noStoreHeaders });
  } catch (error) {
    console.error("[supplier-hub-inbound-events]", error);
    return NextResponse.json({ ok: false, error: "입고상세 이벤트를 저장하지 못했습니다." }, { status: 500, headers: noStoreHeaders });
  }
}
