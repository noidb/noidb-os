import { NextRequest, NextResponse } from "next/server";
import { fetchProductCatalog } from "@/lib/wms/product-catalog";
import { buildPurchaseOrderIndex, getCachedPurchaseOrderIndex } from "@/lib/wms/purchase-order-source/index";
import type { PurchaseOrderSourceRecord } from "@/lib/wms/purchase-order-source/types";
import { buildBatchBarcodeWorkbook, buildSingleBarcodeWorkbook } from "@/lib/wms/shipment-output-files";
import { normalizeSkuId } from "@/lib/wms/sku-normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resultKey(record: PurchaseOrderSourceRecord) {
  return `${normalizeSkuId(record.skuId)}\u0000${record.barcode.trim()}`;
}

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get("q")?.trim().toLocaleLowerCase("ko") || "";
    if (query.length < 2) return NextResponse.json({ error: "SKU, 바코드, 발주번호 또는 상품명을 2글자 이상 입력해주세요." }, { status: 400 });
    const terms = [...new Set(query.split(/[\n,;\t]+/).map(term => term.trim()).filter(term => term.length >= 2))];
    if (!terms.length || terms.length > 200) return NextResponse.json({ error: "검색어는 2글자 이상, 한 번에 200개 이하로 입력해 주세요." }, { status: 400 });
    const exact = request.nextUrl.searchParams.get("exact") === "1";
    const matchedTerms = new Set<string>();
    const index = await getCachedPurchaseOrderIndex();
    const matches = new Map<string, { record: PurchaseOrderSourceRecord; order: number }>();
    for (const document of index.byPurchaseOrderNumber.values()) {
      for (const record of document.records) {
        const searchable = [record.skuId, record.barcode, record.purchaseOrderNumber, record.productName, record.optionName, record.fulfillmentCenterName, record.expectedArrivalDate]
          .join(" ").toLocaleLowerCase("ko");
        const orders = terms.flatMap((term, position) => {
          const matches = exact ? record.barcode.toLowerCase() === term : /^\d+$/.test(term)
            ? record.barcode.endsWith(term) || record.skuId === term || record.purchaseOrderNumber === term
            : searchable.includes(term);
          if (matches) matchedTerms.add(term);
          return matches ? [position] : [];
        });
        const order = orders[0] ?? -1;
        if (order >= 0) {
          const key = resultKey(record);
          const previous = matches.get(key);
          if (!previous || record.expectedArrivalDate.localeCompare(previous.record.expectedArrivalDate) > 0) matches.set(key, { record, order });
        }
        if (matches.size > 200) return NextResponse.json({ error: "검색 결과가 200종을 넘습니다. 바코드 번호를 더 길게 입력해 주세요. 일부만 담지 않았습니다." }, { status: 400 });
      }
    }
    return NextResponse.json({
      unmatchedTerms: terms.filter(term => !matchedTerms.has(term)),
      results: [...matches.values()].sort((a, b) => a.order - b.order).map(({ record }) => ({
        purchaseOrderNumber: record.purchaseOrderNumber,
        skuId: record.skuId,
        barcode: record.barcode,
        productName: record.productName,
        optionName: record.optionName,
        fulfillmentCenter: record.fulfillmentCenterName,
        expectedDate: record.expectedArrivalDate,
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "바코드 이력을 검색하지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { purchaseOrderNumber?: unknown; skuId?: unknown; quantity?: unknown; items?: unknown };
    if (Array.isArray(body.items)) {
      if (body.items.length < 1 || body.items.length > 200) return NextResponse.json({ error: "한 번에 1~200개 SKU를 선택해 주세요." }, { status: 400 });
      const seen = new Set<string>();
      for (const raw of body.items) {
        if (!raw || typeof raw !== "object" || !Number.isInteger(raw.quantity) || raw.quantity < 1 || raw.quantity > 1000) return NextResponse.json({ error: "각 상품의 장수는 1~1000 사이 정수여야 합니다." }, { status: 400 });
        const sku = normalizeSkuId(String(raw.skuId ?? ""));
        if (!sku || seen.has(sku)) return NextResponse.json({ error: "같은 SKU가 여러 번 포함됐습니다. 한 행의 장수를 수정해 주세요." }, { status: 400 });
        seen.add(sku);
      }
      const index = await buildPurchaseOrderIndex();
      const catalogResult = await fetchProductCatalog();
      if (!catalogResult.configured) return NextResponse.json({ error: "제품DB 연결을 확인해 주세요." }, { status: 503 });
      const catalogBySku = new Map<string, typeof catalogResult.items>();
      for (const item of catalogResult.items) {
        const sku = normalizeSkuId(item.skuId);
        catalogBySku.set(sku, [...(catalogBySku.get(sku) || []), item]);
      }
      const resolved = [];
      for (const raw of body.items as { purchaseOrderNumber?: unknown; skuId?: unknown; quantity?: unknown }[]) {
        const purchaseOrderNumber = normalizeSkuId(String(raw.purchaseOrderNumber ?? ""));
        const skuId = normalizeSkuId(String(raw.skuId ?? ""));
        const quantity = Number(raw.quantity);
        if (!purchaseOrderNumber || !skuId) return NextResponse.json({ error: "선택 항목에 발주번호 또는 SKU ID가 없습니다." }, { status: 400 });
        const records = index.byPurchaseOrderNumber.get(purchaseOrderNumber)?.records.filter(record => normalizeSkuId(record.skuId) === skuId) || [];
        if (!records.length) return NextResponse.json({ error: `발주서 ${purchaseOrderNumber}에서 SKU ${skuId}를 찾지 못했습니다.` }, { status: 404 });
        const signatures = new Set(records.map(record => [record.barcode, record.productName, record.optionName].join("\u0000")));
        if (signatures.size !== 1) return NextResponse.json({ error: `발주서 ${purchaseOrderNumber}의 SKU ${skuId} 정보가 서로 다릅니다.` }, { status: 409 });
        const catalogMatches = catalogBySku.get(skuId) || [];
        if (catalogMatches.length !== 1) return NextResponse.json({ error: `제품DB의 SKU ${skuId} 매칭이 ${catalogMatches.length}건이라 재출력을 차단했습니다.` }, { status: 409 });
        resolved.push({ record: records[0], catalog: catalogMatches[0], quantity });
      }
      const buffer = await buildBatchBarcodeWorkbook(resolved);
      const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date()).replaceAll("-", "");
      const totalQuantity = resolved.reduce((sum, item) => sum + item.quantity, 0);
      const fileName = encodeURIComponent(`바코드선택재출력_${resolved.length}종_${totalQuantity}장_${date}.xlsx`);
      return new NextResponse(buffer, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="barcode-batch-reprint.xlsx"; filename*=UTF-8''${fileName}`, "Cache-Control": "no-store" } });
    }
    const purchaseOrderNumber = normalizeSkuId(String(body.purchaseOrderNumber ?? ""));
    const skuId = normalizeSkuId(String(body.skuId ?? ""));
    const quantity = Number(body.quantity);
    if (!purchaseOrderNumber || !skuId) return NextResponse.json({ error: "발주번호와 SKU ID가 필요합니다." }, { status: 400 });
    const index = await buildPurchaseOrderIndex();
    const document = index.byPurchaseOrderNumber.get(purchaseOrderNumber);
    if (!document) return NextResponse.json({ error: "발주서 원본에서 해당 발주번호를 찾지 못했습니다." }, { status: 404 });
    const records = document.records.filter(record => normalizeSkuId(record.skuId) === skuId);
    if (!records.length) return NextResponse.json({ error: "해당 발주서에서 SKU를 찾지 못했습니다." }, { status: 404 });
    const signatures = new Set(records.map(record => [record.barcode, record.productName, record.optionName].join("\u0000")));
    if (signatures.size !== 1) return NextResponse.json({ error: "같은 발주서의 SKU 정보가 서로 달라 재출력을 차단했습니다." }, { status: 409 });
    const catalogResult = await fetchProductCatalog();
    if (!catalogResult.configured) return NextResponse.json({ error: "제품DB 연결을 확인해 주세요." }, { status: 503 });
    const catalogMatches = catalogResult.items.filter(item => normalizeSkuId(item.skuId) === skuId);
    if (catalogMatches.length !== 1) return NextResponse.json({ error: `제품DB의 SKU 매칭이 ${catalogMatches.length}건이라 재출력을 차단했습니다.` }, { status: 409 });
    const buffer = await buildSingleBarcodeWorkbook(records[0], catalogMatches[0], quantity);
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date()).replaceAll("-", "");
    const fileName = encodeURIComponent(`바코드재출력_${skuId}_${quantity}장_${date}.xlsx`);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="barcode-reprint_${skuId}.xlsx"; filename*=UTF-8''${fileName}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "바코드 재출력 파일을 만들지 못했습니다." }, { status: 500 });
  }
}
