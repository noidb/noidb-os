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
import { markDiscontinuedInProductDb } from "@/lib/wms/discontinue-mark-product-db";
import { lookupCodesAnyTab } from "@/lib/wms/product-row-lookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/**
 * 단종 신청 목록 하나로 단종신청 엑셀 + 공문 PDF를 만든다(기존 단종 처리와 같은 양식).
 * skuIds: 화면의 단종 대상 SKU(서버가 제품DB로 다시 확인), codes: 직접 붙여넣은 바코드·SKU ID(제품DB, 없으면 다른 탭에서 찾음).
 * 2026-10-20 사용자 요청: 두 칸에서 따로 서류를 만들던 것을 한 번에 만들고, 같은 SKU는 한 번만 넣는다.
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({ ok: false, error: "입고결과 화면에서 다시 진행해 주세요." }, { status: 403, headers });
  try {
    const body = await request.json() as { skuIds?: unknown; codes?: unknown };
    const wanted = new Set(Array.isArray(body.skuIds) ? body.skuIds.filter((value): value is string => typeof value === "string") : []);
    const codes = [...new Set((Array.isArray(body.codes) ? body.codes : []).filter((value): value is string => typeof value === "string").map(value => value.trim()).filter(Boolean))];
    if (!wanted.size && !codes.length) throw new Error("단종 신청할 SKU가 없습니다.");
    if (codes.length > 500) throw new Error("직접 입력은 한 번에 500개까지 만들 수 있습니다.");
    const merged = new Map<string, { skuId: string; productName: string }>();
    if (wanted.size) {
      const [catalog, workspace, rereg] = await Promise.all([fetchProductCatalog(), readWeeklyWorkspace(), loadReregistrationLookup()]);
      if (!catalog.configured) throw new Error("제품DB를 읽지 못했습니다. 잠시 후 다시 만들어 주세요.");
      const lists = buildStatusLists((await loadStatusSourceItems(catalog.items)).items, {
        cleared: workspace.statusListCleared,
        releaseFromScreen: Object.fromEntries(Object.entries(workspace.supplyStatusChecks || {}).filter(([, check]) => check.decision === "release" && !check.releasedListClearedAt)),
        reregisteredSkuIds: rereg.reregisteredSkuIds,
      });
      for (const item of lists.discontinue) if (wanted.has(item.skuId)) merged.set(item.skuId, { skuId: item.skuId, productName: item.productName });
    }
    let notFound: string[] = [];
    if (codes.length) {
      const results = await lookupCodesAnyTab(codes);
      notFound = results.filter(result => !result.matches.length).map(result => result.code);
      for (const match of results.flatMap(result => result.matches)) if (!merged.has(match.skuId)) merged.set(match.skuId, { skuId: match.skuId, productName: match.productName });
    }
    const items = [...merged.values()];
    if (!items.length) throw new Error(codes.length ? "입력한 코드를 제품DB에서 찾지 못했고, 단종 대상 목록도 바뀌었습니다. 새로고침 후 다시 확인해 주세요." : "단종 대상 목록이 바뀌었습니다. 새로고침 후 다시 만들어 주세요.");
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
    // 단종서류를 만든 SKU는 제품DB 현재상태를 거래처단종으로 적는다(2026-10-19).
    const productDb = await markDiscontinuedInProductDb(items.map(item => item.skuId), "단종서류 만들기");
    return NextResponse.json({ ok: true, fileName, base64, count: items.length, notFound, productDb }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "단종신청 파일을 만들지 못했습니다." }, { status: 400, headers });
  }
}
