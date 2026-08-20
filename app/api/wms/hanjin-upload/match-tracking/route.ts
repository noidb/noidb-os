import { NextRequest, NextResponse } from "next/server";
import { parseTrackingRowsFromBuffer, buildTrackingMapFromRows, trackingKey } from "@/lib/wms/hanjin-upload";

/**
 * 사용자가 한진택배에서 받은 "송장번호 입력 완료" 파일을 업로드하면, 현재 웨이브의
 * (발주번호,물류센터) 목록과 매칭해 미리보기를 만든다 — 아무 파일도 만들지 않고 저장하지도
 * 않는다(조회 전용). 매칭 실패 행은 임의로 연결하지 않고 그대로 "실패"로 보여준다
 * (2026-08-19 5차 실사용 테스트 신규).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function decodeBase64(input: string): Buffer {
  const commaIndex = input.indexOf(",");
  const raw = input.startsWith("data:") && commaIndex >= 0 ? input.slice(commaIndex + 1) : input;
  return Buffer.from(raw, "base64");
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const fileBase64 = String(body.fileBase64 || "");
    const targets: { purchaseOrderNumber: string; fulfillmentCenter: string }[] = Array.isArray(body.targets) ? body.targets : [];
    if (!fileBase64) {
      return NextResponse.json({ error: "업로드한 파일이 없습니다." }, { status: 400 });
    }

    const trackingByKey = buildTrackingMapFromRows(await parseTrackingRowsFromBuffer(decodeBase64(fileBase64)));

    const results = targets.map(target => {
      const key = trackingKey(target.purchaseOrderNumber, target.fulfillmentCenter);
      const trackingNumber = trackingByKey.get(key) || null;
      return { ...target, trackingNumber, matched: Boolean(trackingNumber) };
    });

    return NextResponse.json({
      results,
      matchedCount: results.filter(r => r.matched).length,
      totalCount: results.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "송장번호 파일을 확인하는 중 오류가 발생했습니다. 실제 한진택배 결과 파일이 맞는지 확인해주세요." },
      { status: 400 }
    );
  }
}
