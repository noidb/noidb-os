import { NextRequest, NextResponse } from "next/server";
import { parseTrackingRowsFromBuffer, buildTrackingMapFromRows, trackingKey } from "@/lib/wms/hanjin-upload";

/**
 * 사용자가 한진택배에서 받은 "송장번호 입력 완료" 파일을 업로드하면, 현재 웨이브의
 * (발주번호,물류센터) 목록과 매칭해 미리보기를 만든다 — 아무 파일도 만들지 않고 저장하지도
 * 않는다(조회 전용). 매칭 실패 행은 임의로 연결하지 않고 그대로 "실패"로 보여준다
 * (2026-08-19 5차 실사용 테스트 신규).
 *
 * 2026-08-24 7차: 화면의 "1단계 완료했는지" state가 아니라, 이 API가 실제 업로드된 파일
 * 내용만으로 판단한 검증 결과가 다음 단계(3단계) 활성화 기준이 되도록 바꿨다 — 그래서 이
 * API가 실패 사유를 세 가지로 명확히 구분해서 돌려준다: (1) 한진 결과파일이 아님(상품목록
 * 시트가 없거나 비어 있음), (2) 송장번호가 없음(시트는 있는데 어느 행에도 송장번호가 안
 * 채워짐), (3) 현재 웨이브와 일치하지 않음(송장번호는 있는데 이 웨이브의 발주번호/물류센터가
 * 하나도 안 나옴). 새로고침·재접속·다른 기기에서도 이 API가 실제 파일을 다시 검증하므로
 * 항상 동일하게 동작한다.
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

    const rows = await parseTrackingRowsFromBuffer(decodeBase64(fileBase64));
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "한진 결과파일이 아닙니다. ('상품목록' 시트를 찾을 수 없거나 비어 있습니다.)", errorCode: "NOT_HANJIN_RESULT_FILE" },
        { status: 400 }
      );
    }

    const hasAnyTrackingNumber = rows.some(row => row.trackingNumber);
    if (!hasAnyTrackingNumber) {
      return NextResponse.json(
        { error: "송장번호가 없습니다. (이 파일에는 아직 입력된 송장번호가 없습니다.)", errorCode: "NO_TRACKING_NUMBERS" },
        { status: 400 }
      );
    }

    const trackingByKey = buildTrackingMapFromRows(rows);
    const results = targets.map(target => {
      const key = trackingKey(target.purchaseOrderNumber, target.fulfillmentCenter);
      const trackingNumber = trackingByKey.get(key) || null;
      return { ...target, trackingNumber, matched: Boolean(trackingNumber) };
    });
    const matchedCount = results.filter(r => r.matched).length;

    if (matchedCount === 0) {
      return NextResponse.json(
        { error: "현재 웨이브와 일치하지 않습니다. (이 파일에서 현재 웨이브의 발주번호/물류센터를 찾지 못했습니다.)", errorCode: "NO_WAVE_MATCH", results, matchedCount: 0, totalCount: results.length },
        { status: 400 }
      );
    }

    return NextResponse.json({ results, matchedCount, totalCount: results.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "송장번호 파일을 확인하는 중 오류가 발생했습니다. 실제 한진택배 결과 파일이 맞는지 확인해주세요." },
      { status: 400 }
    );
  }
}
