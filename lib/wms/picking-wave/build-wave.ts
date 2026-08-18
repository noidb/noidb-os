import type { SupplierHubPurchaseOrder } from "../supplier-hub-orders";
import type { ProductCatalogItem } from "../product-catalog";
import type { ModelLocation, Shelf, SkuLocation, WarehouseBox, WarehouseZone } from "../types";
import type { BasketAssignment, PickingWave, PickingWaveItem, PickingWaveSourceRef } from "./types";

/**
 * 실제 발주(들)로부터 통합 피킹 웨이브를 만드는 순수 함수.
 * - 여러 발주서의 같은 상품코드(SKU)를 하나로 합산한다.
 * - 발주서 = 바구니 1:1 임시 배정(발주서번호 오름차순 → 바구니 1,2,3...).
 * - 위치는 SKU 예외 → 모델 위치 순으로 해석하고, 못 찾으면 locationStatus:"unlocated".
 * - 정렬 기준은 모델 모드(카테고리→모델명→SKU→발주수량)/위치 모드 둘 다 계산해둔다
 *   (lib/wms/picking-wave/grouping.ts가 현재 모드에 맞는 쪽을 골라 쓴다).
 * 이 함수는 저장소에 쓰지 않는다 — 호출한 쪽(화면)이 결과를 PickingWaveRepository로 저장한다.
 */

export interface WarehouseSnapshot {
  zones: WarehouseZone[];
  shelves: Shelf[];
  boxes: WarehouseBox[];
  modelLocations: ModelLocation[];
  skuExceptions: SkuLocation[];
}

export interface BuildWaveInput {
  waveId: string;
  orders: SupplierHubPurchaseOrder[];
  catalog: { configured: boolean; items: ProductCatalogItem[] };
  warehouse: WarehouseSnapshot;
  now: string;
}

export interface BuildWaveResult {
  wave: PickingWave;
  items: PickingWaveItem[];
  baskets: BasketAssignment[];
}

const UNLOCATED_SORT_KEY = "ZZZZZZZZZZ";

function padQuantity(quantity: number): string {
  return String(Math.max(0, Math.round(quantity))).padStart(6, "0");
}

export function generateWaveId(existingWaveIds: string[], now: string): string {
  const datePart = now.slice(0, 10).replace(/-/g, "");
  const todayIds = existingWaveIds.filter(id => id.startsWith(`WAVE-${datePart}-`));
  const nextIndex = todayIds.length + 1;
  return `WAVE-${datePart}-${nextIndex}`;
}

export function buildPickingWave(input: BuildWaveInput): BuildWaveResult {
  const { waveId, orders, catalog, warehouse, now } = input;

  const sortedOrders = [...orders].sort((a, b) => a.purchaseOrderNumber.localeCompare(b.purchaseOrderNumber));
  const basketNumberByPo = new Map<string, string>();
  sortedOrders.forEach((order, index) => basketNumberByPo.set(order.purchaseOrderNumber, String(index + 1)));

  const catalogBySkuId = new Map<string, ProductCatalogItem>();
  for (const item of catalog.items) catalogBySkuId.set(item.skuId, item);

  const skuExceptionByProductCode = new Map<string, string>();
  for (const exception of warehouse.skuExceptions) skuExceptionByProductCode.set(exception.skuId, exception.boxId);

  const modelLocationByModelName = new Map<string, string>();
  for (const location of warehouse.modelLocations) {
    if (location.primaryBoxId) modelLocationByModelName.set(location.modelName, location.primaryBoxId);
  }

  const boxById = new Map(warehouse.boxes.map(box => [box.id, box]));
  const shelfById = new Map(warehouse.shelves.map(shelf => [shelf.id, shelf]));
  const zoneById = new Map(warehouse.zones.map(zone => [zone.id, zone]));

  // 1) productCode 기준으로 라인 합산
  interface Accum {
    productCode: string;
    productName: string;
    barcode: string;
    totalQuantity: number;
    sources: PickingWaveSourceRef[];
  }
  const accumByProductCode = new Map<string, Accum>();

  for (const order of sortedOrders) {
    const basketNumber = basketNumberByPo.get(order.purchaseOrderNumber)!;
    for (const line of order.items) {
      const existing = accumByProductCode.get(line.productCode);
      const source: PickingWaveSourceRef = {
        purchaseOrderNumber: order.purchaseOrderNumber,
        basketNumber,
        requestedQuantity: line.orderedQuantity,
      };
      if (existing) {
        existing.totalQuantity += line.orderedQuantity;
        existing.sources.push(source);
      } else {
        accumByProductCode.set(line.productCode, {
          productCode: line.productCode,
          productName: line.productName,
          barcode: line.barcode,
          totalQuantity: line.orderedQuantity,
          sources: [source],
        });
      }
    }
  }

  // 2) 위치/카테고리/모델명 해석 + 정렬 키 계산
  const items: PickingWaveItem[] = [...accumByProductCode.values()].map(accum => {
    const catalogEntry = catalogBySkuId.get(accum.productCode);
    const category = catalogEntry?.category || undefined;
    const modelName = catalogEntry?.modelName || undefined;
    const imageUrl = catalogEntry?.imageUrl || undefined;

    const exceptionBoxId = skuExceptionByProductCode.get(accum.productCode);
    const modelBoxId = modelName ? modelLocationByModelName.get(modelName) : undefined;
    const resolvedBoxId = exceptionBoxId || modelBoxId;

    let locationStatus: "located" | "unlocated" = "unlocated";
    let zoneId: string | undefined;
    let shelfId: string | undefined;
    let boxId: string | undefined;
    let locationSortKey = UNLOCATED_SORT_KEY;

    if (resolvedBoxId) {
      const box = boxById.get(resolvedBoxId);
      const shelf = box ? shelfById.get(box.shelfId) : undefined;
      const zone = shelf ? zoneById.get(shelf.zoneId) : undefined;
      if (box && shelf && zone) {
        locationStatus = "located";
        zoneId = zone.id;
        shelfId = shelf.id;
        boxId = box.id;
        locationSortKey = `${String(zone.sortOrder).padStart(4, "0")}-${String(shelf.sortOrder).padStart(4, "0")}-${box.id}`;
      }
    }

    const modelSortKey = `${category || "￿"}::${modelName || accum.productCode}::${accum.productCode}::${padQuantity(accum.totalQuantity)}`;

    const item: PickingWaveItem = {
      id: `${waveId}-${accum.productCode}`,
      waveId,
      productCode: accum.productCode,
      productName: accum.productName,
      barcode: accum.barcode,
      category,
      modelName,
      imageUrl,
      totalQuantity: accum.totalQuantity,
      sources: accum.sources,
      locationStatus,
      zoneId,
      shelfId,
      boxId,
      modelSortKey,
      locationSortKey,
      status: "pending",
      pickedQuantity: 0,
      shortageQuantity: 0,
      allocations: [],
      createdAt: now,
      updatedAt: now,
    };
    return item;
  });

  const wave: PickingWave = {
    id: waveId,
    status: "in_progress",
    sourcePurchaseOrderNumbers: sortedOrders.map(order => order.purchaseOrderNumber),
    completedGroupIds: [],
    productDbConfigured: catalog.configured,
    createdAt: now,
    updatedAt: now,
  };

  const baskets: BasketAssignment[] = sortedOrders.map(order => ({
    basketNumber: basketNumberByPo.get(order.purchaseOrderNumber)!,
    purchaseOrderNumber: order.purchaseOrderNumber,
    waveId,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  }));

  return { wave, items, baskets };
}
