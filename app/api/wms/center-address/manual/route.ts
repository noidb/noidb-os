import { NextRequest, NextResponse } from "next/server";
import { addressLedgerKey, normalizeAddress } from "@/lib/wms/center-address/address-normalize";
import { saveCenterAddressLedgerEntries } from "@/lib/wms/center-address/ledger-store";
import type { CenterAddressLedgerEntry } from "@/lib/wms/center-address/types";

/**
 * 자동 주소검색이 우편번호를 확정하지 못한 센터에 사용자가 직접 확인한 우편번호를 저장한다 (2026-10-12).
 * 센터명+발주서 원본 주소 키로 센터주소 원장에 저장하므로, 같은 센터·같은 주소면 다음부터 자동으로 이 값을 쓴다.
 */
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const fulfillmentCenterName = typeof body.fulfillmentCenterName === "string" ? body.fulfillmentCenterName.trim() : "";
    const sourceAddress = typeof body.sourceAddress === "string" ? body.sourceAddress.trim() : "";
    const postalCode = typeof body.postalCode === "string" ? body.postalCode.trim() : "";
    if (!fulfillmentCenterName || !sourceAddress) return NextResponse.json({ error: "센터명과 주소가 필요합니다." }, { status: 400 });
    if (!/^\d{5}$/.test(postalCode)) return NextResponse.json({ error: "우편번호는 숫자 5자리로 입력해 주세요." }, { status: 400 });

    const now = new Date().toISOString();
    const entry: CenterAddressLedgerEntry = {
      key: addressLedgerKey(fulfillmentCenterName, sourceAddress),
      fulfillmentCenterName,
      sourceAddress,
      normalizedSourceAddress: normalizeAddress(sourceAddress),
      postalCode,
      matchedAddress: sourceAddress,
      verificationSource: "manual",
      verifiedAt: now,
      updatedAt: now,
    };
    await saveCenterAddressLedgerEntries([entry]);
    return NextResponse.json({ ok: true, entry });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "우편번호를 저장하지 못했습니다." }, { status: 500 });
  }
}
