import { fetchSheetRows, rowsToObjects } from "./google-sheets";

/**
 * '발주서 출력' 시트를 '제품DB' 시트로 보강(SKU ID 기준 조인)한 읽기 전용 조회 모델.
 * lib/wms/types.ts의 정식 도메인 타입(PurchaseOrder 등)과는 별개로,
 * 시트 원본 구조를 그대로 반영한 Sprint 1 임시 조회용 타입이다.
 */
export interface PurchaseOrderSheetRow {
  purchaseOrderNumber: string;
  fulfillmentCenter: string;
  orderedAt: string;
  expectedDate: string;
  warehouseNumber: string;
  skuId: string;
  productName: string;
  barcode: string;
  orderedQuantity: number;
  vendorConfirmedQuantity: number;
  vendorName: string;
  imageUrl: string;
  productLink: string;
  modelName: string;
  category: string;
}

const PICKING_SHEET_NAME = "발주서 출력";
const PRODUCT_DB_SHEET_NAME = "제품DB";

function toNumber(value: string | undefined): number {
  const n = Number(String(value ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** 숫자/문자/쉼표 형식이 달라도 같은 SKU ID로 비교할 수 있게 정규화한다 (기존 .gs의 normalizeSkuId_와 동일 규칙). */
function normalizeSkuId(value: string | undefined): string {
  return String(value ?? "").trim().replace(/^'/, "").replace(/[\s,]/g, "").replace(/\.0+$/, "");
}

/** 제품DB '이미지' 열의 =IMAGE("url",...) 수식에서 실제 이미지 URL만 추출한다. */
function extractImageUrl(rawCell: string | undefined): string {
  const text = String(rawCell ?? "");
  const formulaMatch = text.match(/=IMAGE\("([^"]+)"/i);
  if (formulaMatch) return formulaMatch[1];
  if (/^https?:\/\//i.test(text.trim())) return text.trim();
  return "";
}

/**
 * '발주서 출력' + '제품DB'를 읽기 전용으로 조회해 조인한 결과를 반환한다.
 * 이 함수는 오직 읽기만 수행하며 시트에 값을 쓰지 않는다.
 */
export async function fetchPurchaseOrderView(): Promise<PurchaseOrderSheetRow[]> {
  const [pickingRows, productDbRows] = await Promise.all([
    fetchSheetRows(PICKING_SHEET_NAME, { valueRenderOption: "FORMATTED_VALUE" }),
    fetchSheetRows(PRODUCT_DB_SHEET_NAME, { valueRenderOption: "FORMULA" }),
  ]);

  const pickingItems = rowsToObjects(pickingRows);
  const productDbItems = rowsToObjects(productDbRows);

  const productDbBySku = new Map<string, Record<string, string>>();
  for (const row of productDbItems) {
    const sku = normalizeSkuId(row["SKU ID"]);
    if (sku) productDbBySku.set(sku, row);
  }

  return pickingItems.map((row): PurchaseOrderSheetRow => {
    const skuId = normalizeSkuId(row["상품코드(SKU ID)"]);
    const enrichment = productDbBySku.get(skuId);
    return {
      purchaseOrderNumber: row["발주서 번호"] || "",
      fulfillmentCenter: row["물류센터"] || "",
      orderedAt: row["발주일시"] || "",
      expectedDate: row["입고예정일"] || "",
      warehouseNumber: row["창고번호"] || enrichment?.["창고번호"] || "",
      skuId,
      productName: row["상품명"] || enrichment?.["상품명"] || "",
      barcode: row["바코드"] || "",
      orderedQuantity: toNumber(row["발주수량"]),
      vendorConfirmedQuantity: toNumber(row["업체납품가능수량"]),
      vendorName: row["거래처"] || enrichment?.["거래처"] || "",
      imageUrl: enrichment ? extractImageUrl(enrichment["이미지"]) : "",
      productLink: enrichment?.["제품링크"] || "",
      modelName: enrichment?.["모델명/품번"] || "",
      category: enrichment?.["카테고리"] || "",
    };
  });
}
