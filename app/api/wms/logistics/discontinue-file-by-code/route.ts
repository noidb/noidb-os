import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { isSameOriginActionRequest } from "@/lib/wms/noidb-action-auth";
import { lookupCodesAnyTab } from "@/lib/wms/product-row-lookup";
import { buildDiscontinueWorkbook, koreaDateParts, loadDiscontinueLetterTemplate, loadDiscontinueTemplate } from "@/lib/wms/discontinue-files";
import { buildDiscontinueLetterFromTemplate } from "@/lib/wms/discontinue-letter";
import { markDiscontinuedInProductDb } from "@/lib/wms/discontinue-mark-product-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/**
 * 바코드·SKU ID를 붙여넣어 단종신청 엑셀 + 공문 PDF를 만든다(2026-10-15 사용자 요청).
 * 단종 대상 목록과 상관없이, 입력한 코드를 제품DB(없으면 다른 탭)에서 찾아 같은 양식으로 만든다.
 * check=true면 파일을 만들지 않고 찾은 결과만 돌려준다(미리보기). markOnly=true면 파일 없이 제품DB 현재상태만 거래처단종으로 적는다.
 * 파일을 만들면 제품DB에 있는 SKU의 현재상태를 거래처단종으로 적는다(2026-10-19).
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginActionRequest(request)) return NextResponse.json({ ok: false, error: "입고결과 화면에서 다시 진행해 주세요." }, { status: 403, headers });
  try {
    const body = await request.json() as { codes?: unknown; check?: unknown; markOnly?: unknown; path?: unknown };
    const codes = [...new Set((Array.isArray(body.codes) ? body.codes : []).filter((value): value is string => typeof value === "string").map(value => value.trim()).filter(Boolean))];
    if (!codes.length) throw new Error("바코드나 SKU ID를 입력해 주세요.");
    if (codes.length > 500) throw new Error("한 번에 500개까지 만들 수 있습니다.");
    const results = await lookupCodesAnyTab(codes);
    const notFound = results.filter(result => !result.matches.length).map(result => result.code);
    const items = [...new Map(results.flatMap(result => result.matches).map(match => [match.skuId, { skuId: match.skuId, productName: match.productName }])).values()];
    const lookup = results.map(result => ({ code: result.code, matches: result.matches }));
    // 예전에 이미 단종서류를 만든 코드: 파일 없이 제품DB 현재상태만 거래처단종으로 적는다.
    if (body.markOnly === true && items.length) return NextResponse.json({ ok: true, lookup, notFound, count: items.length, productDb: await markDiscontinuedInProductDb(items.map(item => item.skuId), typeof body.path === "string" ? body.path.slice(0, 40) : "제품DB에만 적기") }, { headers });
    if (body.check === true || !items.length) return NextResponse.json({ ok: true, lookup, notFound, count: items.length }, { headers });
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
    const productDb = await markDiscontinuedInProductDb(items.map(item => item.skuId), "단종서류 만들기(직접 입력)");
    return NextResponse.json({ ok: true, lookup, notFound, count: items.length, fileName, base64, productDb }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "단종신청 파일을 만들지 못했습니다." }, { status: 400, headers });
  }
}
