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
    const [catalog, workspace, rereg] = await Promise.all([fetchProductCatalog(), readWeeklyWorkspace(), loadReregistrationLookup()]);
    if (!catalog.configured) throw new Error("제품DB를 읽지 못했습니다. 잠시 후 다시 만들어 주세요.");
    const rows = buildStatusLists((await loadStatusSourceItems(catalog.items)).items, {
      cleared: workspace.statusListCleared,
      releaseFromScreen: Object.fromEntries(Object.entries(workspace.supplyStatusChecks || {}).filter(([, check]) => check.decision === "release" && !check.releasedListClearedAt)),
      nameFallback: { ...rereg.names, ...Object.fromEntries((workspace.logisticsReceipts?.shipments || []).flatMap(shipment => shipment.lines.map(line => [line.skuId, line.productName]))) },
      reregisteredSkuIds: rereg.reregisteredSkuIds,
    }).release;
    if (!rows.length) throw new Error("단종해제 대상 SKU가 없습니다.");
    const book = new ExcelJS.Workbook();
    book.creator = "NOID-B";
    const sheet = book.addWorksheet("단종해제 대상");
    sheet.columns = [{ header: "SKU ID", key: "skuId", width: 16 }, { header: "상품명", key: "productName", width: 70 }];
    sheet.getRow(1).font = { bold: true };
    for (const row of rows) {
      const added = sheet.addRow({ skuId: row.skuId, productName: row.productName });
      added.getCell(1).numFmt = "@";
    }
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    const date = koreaDateParts(new Date());
    const fileName = `단종해제_대상_${date.compact}_${rows.length}건.xlsx`;
    const base64 = Buffer.from(await book.xlsx.writeBuffer()).toString("base64");
    return NextResponse.json({ ok: true, fileName, base64, count: rows.length }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "엑셀 파일을 만들지 못했습니다." }, { status: 400, headers });
  }
}
