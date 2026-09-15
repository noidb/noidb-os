import { NextRequest, NextResponse } from "next/server";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { moveWorkListItem } from "@/lib/wms/work-list-routing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({ success: false, error: "작업 화면에서 이동해 주세요." }, { status: 403 });
  try {
    const body = await request.json();
    if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 100 || body.ids.some((id: unknown)=>typeof id!=="string")) throw new Error("이동할 상품을 선택해 주세요.");
    const moved: string[] = [], failed: Array<{id:string;error:string}> = [];
    for (const id of [...new Set<string>(body.ids)]) {
      try { await moveWorkListItem(body.source, id, body.target, body.expectedUpdatedAtById?.[id], undefined, body.preserveSentOrder === true); moved.push(id); }
      catch (error) { failed.push({id,error:error instanceof Error ? error.message : "이동하지 못했습니다."}); }
    }
    return NextResponse.json({ success: failed.length === 0, moved, failed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "이동하지 못했습니다." }, {status:409}); }
}
