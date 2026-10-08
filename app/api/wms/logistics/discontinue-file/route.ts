import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { fetchProductCatalog } from "@/lib/wms/product-catalog";
import { readWeeklyWorkspace } from "@/lib/wms/weekly-work-store";
import { buildStatusLists } from "@/lib/wms/discontinue-lists";
import { loadReregistrationLookup } from "@/lib/wms/reregistration-lookup";
import { loadStatusSourceItems } from "@/lib/wms/status-list-sources";
import { buildDiscontinueWorkbook, koreaDateParts, loadDiscontinueLetterTemplate, loadDiscontinueTemplate } from "@/lib/wms/discontinue-files";
import { buildDiscontinueLetterFromTemplate } from "@/lib/wms/discontinue-letter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/** 단종 대상 SKU 목록으로 단종신청 엑셀 + 공문 PDF를 만든다(기존 단종 처리와 같은 양식). 목록은 서버가 제품DB로 다시 확인한다. */
export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({ ok: false, error: "입고결과 화면에서 다시 진행해 주세요." }, { status: 403, headers });
  try {
    const body = await request.json() as { skuIds?: unknown };
    const wanted = new Set(Array.isArray(body.skuIds) ? body.skuIds.filter((value): value is string => typeof value === "string") : []);
    if (!wanted.size) throw new Error("단종 신청할 SKU가 없습니다.");
    const [catalog, workspace, rereg] = await Promise.all([fetchProductCatalog(), readWeeklyWorkspace(), loadReregistrationLookup()]);
    if (!catalog.configured) throw new Error("제품DB를 읽지 못했습니다. 잠시 후 다시 만들어 주세요.");
    const lists = buildStatusLists((await loadStatusSourceItems(catalog.items)).items, {
      cleared: workspace.statusListCleared,
      releaseFromScreen: Object.fromEntries(Object.entries(workspace.supplyStatusChecks || {}).filter(([, check]) => check.decision === "release" && !check.releasedListClearedAt)),
      reregisteredSkuIds: rereg.reregisteredSkuIds,
    });
    const items = lists.discontinue.filter(item => wanted.has(item.skuId)).map(item => ({ skuId: item.skuId, productName: item.productName }));
    if (!items.length) throw new Error("단종 대상 목록이 바뀌었습니다. 새로고침 후 다시 만들어 주세요.");
    const date = koreaDateParts(new Date());
    const [xlsx, pdf] = await Promise.all([
      loadDiscontinueTemplate().then(template => buildDiscontinueWorkbook(template, items, date.iso)),
      loadDiscontinueLetterTemplate().then(template => buildDiscontinueLetterFromTemplate(template, items, date.iso)),
    ]);
    const zip = new JSZip();
    zip.file(`단종_SKU_${date.compact}.xlsx`, xlsx.buffer);
    zip.file(`단종요청_공문_${date.compact}.pdf`, pdf);
    const fileName = `단종신청_${date.compact}_${items.length}건.zip`;
    const base64 = (await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })).toString("base64");
    return NextResponse.json({ ok: true, fileName, base64, count: items.length }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "단종신청 파일을 만들지 못했습니다." }, { status: 400, headers });
  }
}
