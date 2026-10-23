import { NextResponse, type NextRequest } from "next/server";

/**
 * 2026-10-23: 크롬 확장 'WIMS 전체를 NOID-B로 전송'은 첫 화면(/?source=wims-extension#product-registration-status)을 연다.
 * 그런데 WIMS 상품등록상태 칸은 입고센터 '자주 하는 일'로 옮겼으므로, 첫 화면에는 받는 칸이 없다.
 * 확장은 고치지 않아도(재설치 없이) 되도록, 그 주소가 오면 WIMS 칸이 펼쳐진 입고센터로 보낸다.
 * 확장이 붙여 준 source·transferId는 그대로 넘겨야 받는 쪽(noidb-bridge)이 전송 내용을 이 화면에 건네준다.
 */
export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();
  if (url.searchParams.get("source") !== "wims-extension") return NextResponse.next();
  url.pathname = "/wms/work-center";
  url.searchParams.set("open", "wims");
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/"] };
