import type { SupplierHubPurchaseOrder } from "../supplier-hub-orders";
import { isUpcomingInboundDate, todayInKorea } from "../supplier-hub-orders";
import type { ProductCatalogItem } from "../product-catalog";
import { normalizeSkuId } from "../sku-normalize";
import { resolveDisplayOption } from "../display-name";
import { UNASSIGNED_VENDOR_NAME } from "./types";

/**
 * "실제 미납" = 노이드비가 쿠팡에 확정해서 보낸 수량(vendorConfirmedQuantity) 대비 쿠팡
 * 서플라이허브 발주서리스트에 기록된 실제 입고수량(receivedQuantity)의 부족분이다
 * (2026-09-11 신규 — picking shortage와는 완전히 별개 출처).
 *
 * picking shortage(기존 aggregate.ts)와 절대 섞이지 않도록 별도 파일/타입으로 둔다.
 * 12개 단위 올림(toVendorOrderQuantity)은 여기서 절대 쓰지 않는다.
 */
export interface ActualInboundShortageLine {
  purchaseOrderNumber: string;
  productCode: string;
  /** Supplier Hub 발주 원본의 입고예정일. 표시·정렬에만 사용한다. */
  expectedDate?: string;
  productName: string;
  confirmedQuantity: number;
  receivedQuantity: number;
  /** max(confirmedQuantity - receivedQuantity, 0). 0이면 이 목록에 아예 포함하지 않는다. */
  shortageQuantity: number;
  vendorName: string;
  modelName: string;
  category: string;
  optionLabel: string;
  imageUrl: string;
  barcode: string;
  sourceType: "actual-inbound-shortage";
}

/**
 * Supplier Hub 발주서리스트(SupplierHubPurchaseOrder[])에서 실제 미납 라인만 계산한다.
 * - 같은 발주서번호+SKU가 여러 줄로 쪼개져 있으면 확정/입고수량을 합산해 중복 없이 정규화한다.
 * - 입고예정일이 아직 오지 않은(오늘 포함) 발주는 "아직 입고 전"일 뿐 미납이 아니므로 제외한다
 *   (2026-09-11 — 이 가드가 없으면 방금 발주해 아직 도착 전인 모든 건이 전부 "미납"으로 잘못 표시됨).
 * - 순수 함수, 저장하지 않는다.
 */
export function computeActualInboundShortageLines(
  orders: SupplierHubPurchaseOrder[],
  catalogItems: ProductCatalogItem[],
  today = todayInKorea()
): ActualInboundShortageLine[] {
  const catalogBySkuId = new Map<string, ProductCatalogItem>();
  for (const item of catalogItems) catalogBySkuId.set(normalizeSkuId(item.skuId), item);

  const accum = new Map<string, {
    purchaseOrderNumber: string;
    productCode: string;
    productName: string;
    confirmedQuantity: number;
    receivedQuantity: number;
  }>();

  for (const order of orders) {
    if (!order.purchaseOrderNumber) continue;
    if (isUpcomingInboundDate(order.expectedDate, today)) continue; // 아직 입고 전 — 미납 판단 대상 아님
    for (const line of order.items) {
      if (!line.productCode) continue;
      const key = `${order.purchaseOrderNumber}::${line.productCode}`;
      const existing = accum.get(key);
      if (existing) {
        existing.confirmedQuantity += line.vendorConfirmedQuantity;
        existing.receivedQuantity += line.receivedQuantity;
      } else {
        accum.set(key, {
          purchaseOrderNumber: order.purchaseOrderNumber,
          productCode: line.productCode,
          productName: line.productName,
          confirmedQuantity: line.vendorConfirmedQuantity,
          receivedQuantity: line.receivedQuantity,
        });
      }
    }
  }

  const results: ActualInboundShortageLine[] = [];
  for (const item of accum.values()) {
    const shortageQuantity = Math.max(0, item.confirmedQuantity - item.receivedQuantity);
    if (shortageQuantity <= 0) continue;
    const catalogEntry = catalogBySkuId.get(normalizeSkuId(item.productCode));
    // 이미 단종 처리된 SKU는 거래처 발주 대상에서 제외한다(2026-09-11 — 기존 단종/발주중단
    // 기능(status-requests 화면, vendor-order-actions.ts)으로 처리한 SKU가 다음 정기적인 실제
    // 미납 확인 때 다시 나타나지 않게 하기 위함). 원본 Supplier Hub 발주서 파일은 건드리지 않으므로
    // 원 발주서번호/SKU/실제미납수량 자체는 그대로 남아있고, 이 목록에만 안 보이는 것뿐이다.
    if (catalogEntry?.currentStatus === "단종") continue;
    const productName = catalogEntry?.productName || item.productName;
    results.push({
      purchaseOrderNumber: item.purchaseOrderNumber,
      productCode: item.productCode,
      productName,
      confirmedQuantity: item.confirmedQuantity,
      receivedQuantity: item.receivedQuantity,
      shortageQuantity,
      vendorName: catalogEntry?.vendorName || UNASSIGNED_VENDOR_NAME,
      modelName: catalogEntry?.modelName || productName,
      category: catalogEntry?.category || "",
      optionLabel: resolveDisplayOption(productName, catalogEntry?.optionLabel),
      imageUrl: catalogEntry?.imageUrl || "",
      barcode: catalogEntry?.barcode || "",
      sourceType: "actual-inbound-shortage",
    });
  }
  return results;
}
