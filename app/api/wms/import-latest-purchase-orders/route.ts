import { NextResponse } from "next/server";
import { importLatestPurchaseOrders } from "@/lib/wms/import-latest-purchase-orders";

/**
 * "최신 발주서 불러오기" API. 구글드라이브 동기화 폴더(G:\내 드라이브\쿠팡데이터\발주서리스트다운)에서
 * 가장 최근 ZIP/xlsx를 찾아, incoming-purchase-orders 폴더에 없는 신규 발주서번호만 복사해 넣는다.
 * 원본 파일은 절대 수정·이동·삭제하지 않는다 (읽기 전용). POST만 존재 — 이 라우트가 유일하게 로컬
 * 파일시스템에 새 파일을 "추가"하는 WMS API지만, 쓰는 대상은 이미 .gitignore로 제외된
 * incoming-purchase-orders 폴더뿐이다.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await importLatestPurchaseOrders();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "최신 발주서를 불러오는 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
