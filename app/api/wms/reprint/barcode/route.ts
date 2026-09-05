import { NextRequest, NextResponse } from "next/server";
import { fetchProductCatalog } from "@/lib/wms/product-catalog";
import { buildPurchaseOrderIndex, getCachedPurchaseOrderIndex } from "@/lib/wms/purchase-order-source/index";
import type { PurchaseOrderSourceRecord } from "@/lib/wms/purchase-order-source/types";
import { buildSingleBarcodeWorkbook } from "@/lib/wms/shipment-output-files";
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
    const index = await getCachedPurchaseOrderIndex();
    const matches = new Map<string, PurchaseOrderSourceRecord>();
    for (const document of index.byPurchaseOrderNumber.values()) {
      for (const record of document.records) {
        const searchable = [record.skuId, record.barcode, record.purchaseOrderNumber, record.productName, record.optionName, record.fulfillmentCenterName, record.expectedArrivalDate]
          .join(" ").toLocaleLowerCase("ko");
        if (searchable.includes(query)) {
          const key = resultKey(record);
          const previous = matches.get(key);
          if (!previous || record.expectedArrivalDate.localeCompare(previous.expectedArrivalDate) > 0) matches.set(key, record);
        }
        if (matches.size >= 50) break;
      }
      if (matches.size >= 50) break;
    }
    return NextResponse.json({
      results: [...matches.values()].map(record => ({
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
    const body = await request.json() as { purchaseOrderNumber?: unknown; skuId?: unknown; quantity?: unknown };
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
