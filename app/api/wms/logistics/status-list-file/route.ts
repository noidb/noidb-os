import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { fetchProductCatalog } from "@/lib/wms/product-catalog";
import { readWeeklyWorkspace } from "@/lib/wms/weekly-work-store";
import { buildStatusLists } from "@/lib/wms/discontinue-lists";
import { loadReregistrationLookup } from "@/lib/wms/reregistration-lookup";
import { loadStatusSourceItems } from "@/lib/wms/status-list-sources";
import { koreaDateParts } from "@/lib/wms/discontinue-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/** 단종해제 대상 SKU를 엑셀(SKU ID·상품명)로 만든다. 누를 때만 만든다. 목록은 서버가 제품DB로 다시 계산한다. */
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
    const requestedLabel = (skuId: string) => {
      const at = requested[skuId];
      if (!at) return "신청 전";
      const d = koreaDateParts(new Date(at));
      return `신청완료 ${d.compact}`;
    };
    const book = new ExcelJS.Workbook();
    book.creator = "NOID-B";
    const sheet = book.addWorksheet("단종해제 대상");
    sheet.columns = [{ header: "SKU ID", key: "skuId", width: 16 }, { header: "상품명", key: "productName", width: 70 },
      ...(scope === "all" ? [{ header: "신청 상태", key: "requested", width: 20 }] : [])];
    sheet.getRow(1).font = { bold: true };
    for (const row of rows) {
      const added = sheet.addRow({ skuId: row.skuId, productName: row.productName, ...(scope === "all" ? { requested: requestedLabel(row.skuId) } : {}) });
      added.getCell(1).numFmt = "@";
    }
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    const date = koreaDateParts(new Date());
    const fileName = `단종해제_${scope === "fresh" ? "신청전" : "전체"}_${date.compact}_${rows.length}건.xlsx`;
    const base64 = Buffer.from(await book.xlsx.writeBuffer()).toString("base64");
    return NextResponse.json({ ok: true, fileName, base64, count: rows.length }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "엑셀 파일을 만들지 못했습니다." }, { status: 400, headers });
  }
}
