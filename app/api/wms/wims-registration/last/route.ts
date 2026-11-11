import { NextRequest, NextResponse } from "next/server";
import { wimsStatusMap, type WimsRegistrationRow } from "@/lib/wms/wims-registration";
import { normalizeWimsLastSnapshot, readWimsLastSnapshot, writeWimsLastSnapshot } from "@/lib/wms/wims-last-snapshot-store";

/** WIMS 마지막 가져온 결과. GET: 저장본 읽기만. POST: 방금 가져온 결과 저장(2026-10-15). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET() {
  try {
    return NextResponse.json({ ok: true, saved: await readWimsLastSnapshot() }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "저장된 WIMS 결과를 읽지 못했습니다." }, { status: 500, headers: noStoreHeaders });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    // 2026-11-11: '바뀐 것' 확인 표시. 지금 비교 기준(직전 수집본)의 변경을 확인했다고 저장한다(회사·집 PC 공통).
    if (body && typeof body === "object" && (body as { ack?: unknown }).ack === true) {
      const current = await readWimsLastSnapshot();
      if (!current) return NextResponse.json({ ok: false, error: "저장된 WIMS 결과가 없습니다." }, { status: 404, headers: noStoreHeaders });
      const ackedBaseline = current.previous?.capturedAt ?? null;
      await writeWimsLastSnapshot({ ...current, ackedBaseline });
      return NextResponse.json({ ok: true, ackedBaseline }, { headers: noStoreHeaders });
    }
    const value = normalizeWimsLastSnapshot(body);
    if (!value) return NextResponse.json({ ok: false, error: "저장 요청 형식이 올바르지 않습니다." }, { status: 400, headers: noStoreHeaders });
    // 2026-11-04: 직전 저장본과 상태가 달라졌을 때만 직전 상태를 '비교 기준'으로 남긴다(같은 내용 재전송 땐 기준 유지).
    const existing = await readWimsLastSnapshot().catch(() => null);
    const nextStatuses = wimsStatusMap(value.snapshot.rows as WimsRegistrationRow[]);
    let previous = existing?.previous ?? null;
    if (existing) {
      const oldStatuses = wimsStatusMap(existing.snapshot.rows as WimsRegistrationRow[]);
      const same = Object.keys(nextStatuses).length === Object.keys(oldStatuses).length && Object.entries(nextStatuses).every(([key, status]) => oldStatuses[key] === status);
      if (!same) previous = { capturedAt: existing.capturedAt, statuses: oldStatuses };
    }
    // 확인 표시는 서버 값만 따른다(화면이 보낸 낡은 값으로 되돌리지 않음).
    const ackedBaseline = existing?.ackedBaseline ?? null;
    await writeWimsLastSnapshot({ ...value, previous, ackedBaseline });
    return NextResponse.json({ ok: true, previous, ackedBaseline }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "WIMS 결과를 저장하지 못했습니다." }, { status: 500, headers: noStoreHeaders });
  }
}
