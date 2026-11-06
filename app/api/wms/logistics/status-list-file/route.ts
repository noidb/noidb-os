import { NextRequest, NextResponse } from "next/server";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { fetchProductCatalog } from "@/lib/wms/product-catalog";
import { readWeeklyWorkspace } from "@/lib/wms/weekly-work-store";
import { buildStatusLists } from "@/lib/wms/discontinue-lists";
import { loadReregistrationLookup } from "@/lib/wms/reregistration-lookup";
import { loadStatusSourceItems } from "@/lib/wms/status-list-sources";
import { buildReleaseWorkbook, koreaDateParts, loadReleaseTemplate } from "@/lib/wms/discontinue-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/** 단종해제 대상 SKU를 쿠팡 이슈 신고 양식(SKU ID·요청사유 "정상 공급 전환")으로 만든다. 누를 때만 만든다. 목록은 서버가 제품DB로 다시 계산한다. */
export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({ ok: false, error: "입고결과 화면에서 다시 진행해 주세요." }, { status: 403, headers });
  try {
    const body = await request.json().catch(() => ({})) as { scope?: unknown };
    // 2026-10-23: fresh = 아직 신청 안 한 SKU만, all = 신청완료 포함 전체(신청 상태 칸 추가)
    const scope = body.scope === "fresh" ? "fresh" : "all";
    const [catalog, workspace, rereg] = await Promise.all([fetchProductCatalog(), readWeeklyWorkspace(), loadReregistrationLookup()]);
    if (!catalog.configured) throw new Error("제품DB를 읽지 못했습니다. 잠시 후 다시 만들어 주세요.");
    const allRows = buildStatusLists((await loadStatusSourceItems(catalog.items)).items, {
      cleared: workspace.statusListCleared,
      releaseFromScreen: Object.fromEntries(Object.entries(workspace.supplyStatusChecks || {}).filter(([, check]) => check.decision === "release" && !check.releasedListClearedAt)),
      nameFallback: { ...rereg.names, ...Object.fromEntries((workspace.logisticsReceipts?.shipments || []).flatMap(shipment => shipment.lines.map(line => [line.skuId, line.productName]))) },
      reregisteredSkuIds: rereg.reregisteredSkuIds,
    }).release;
    const requested = workspace.statusListRequested?.release || {};
    const rows = scope === "fresh" ? allRows.filter(row => !requested[row.skuId]) : allRows;
    if (!rows.length) throw new Error(scope === "fresh" ? "아직 신청하지 않은 단종해제 대상 SKU가 없습니다." : "단종해제 대상 SKU가 없습니다.");
    // 2026-11-06: 쿠팡에 바로 올리는 양식이라 상품명·신청 상태 칸은 넣지 않는다(양식 칸이 바뀌면 쿠팡에서 안 받음).
    const result = await buildReleaseWorkbook(await loadReleaseTemplate(), rows.map(row => ({ skuId: row.skuId, productName: row.productName })));
    const date = koreaDateParts(new Date());
    const fileName = `단종해제_${scope === "fresh" ? "신청전" : "전체"}_${date.compact}_${rows.length}건.xlsx`;
    const base64 = result.buffer.toString("base64");
    return NextResponse.json({ ok: true, fileName, base64, count: rows.length }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "엑셀 파일을 만들지 못했습니다." }, { status: 400, headers });
  }
}
