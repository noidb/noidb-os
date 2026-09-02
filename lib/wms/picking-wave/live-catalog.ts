import type { ProductCatalogItem } from "../product-catalog";
import { normalizeModelSkuKey, normalizeSkuId } from "../sku-normalize";
import { cleanDisplayProductName, resolveDisplayNameAndOption } from "../display-name";
import type { PickingWaveItem } from "./types";

/**
 * SKU(상품코드) → 제품DB(구글시트) 최신 전체 항목. "제품DB 새로고침" 버튼을 누르면 다시 불러와서
 * 카테고리뿐 아니라 옵션명/대표이미지/거래처/창고번호/BOX번호/쿠팡바코드까지 화면에 최신값으로
 * 반영한다 (2026-08-19 2차 실사용 테스트 반영 — 이전에는 카테고리만 새로고침됐다). 계산 결과를
 * 어디에도 캐시/저장하지 않고, 웨이브 아이템(저장된 스냅샷) 자체는 건드리지 않는다.
 *
 * 2026-08-20 신규 — SKU ID 하나로만 매칭하면, 상품공급상태 업데이트 등으로 SKU ID가 나중에
 * 새로 채워진 상품을 다시 찾지 못했다(웨이브 생성 시점에는 그 상품이 존재조차 하지 않았거나
 * 다른 SKU ID였을 수 있음). 그래서 이 맵은 같은 카탈로그 항목을 두 가지 키로 함께 저장한다 —
 * ① 정규화된 SKU ID(기존 방식, 그대로 유지) ② "model:정규화된모델SKU" — 모델SKU는 옵션(색상 등)별로
 * 고유하므로("모델명/품번"과 다름, 여러 옵션이 공유하지 않음) 안전한 재매칭 키로 쓸 수 있다.
 * 타입은 여전히 Map<string, ProductCatalogItem> 그대로라 이 맵을 직접 .get(skuId)하는 기존
 * 호출부(예: vendor-orders 제품링크 조회)는 전혀 영향받지 않는다 — resolveLiveFields만 두 키를
 * 순서대로 시도한다.
 */
type LiveCatalogItem = ProductCatalogItem & { derivedOptionLabel?: string };
export type LiveCatalogLookup = Map<string, LiveCatalogItem>;

const MODEL_SKU_KEY_PREFIX = "model:";

function pairProductNameBase(a: string, b: string): string {
  let prefix = a;
  let index = 0;
  while (index < prefix.length && index < b.length && prefix[index] === b[index]) index += 1;
  prefix = prefix.slice(0, index);
  const boundary = Math.max(prefix.lastIndexOf(" "), prefix.lastIndexOf(","));
  return boundary >= 12 ? prefix.slice(0, boundary).trim() : "";
}

function commonProductNameBase(items: ProductCatalogItem[]): string {
  const names = items.map(item => cleanDisplayProductName(item.productName)).filter(Boolean);
  if (names.length < 2) return "";
  const candidates = new Set<string>();
  for (let left = 0; left < names.length - 1; left += 1) {
    for (let right = left + 1; right < names.length; right += 1) {
      const base = pairProductNameBase(names[left], names[right]);
      if (base) candidates.add(base);
    }
  }
  return Array.from(candidates)
    .map(base => ({ base, support: names.filter(name => name.startsWith(base)).length }))
    .filter(candidate => candidate.support >= 2)
    .sort((a, b) => b.support - a.support || b.base.length - a.base.length)[0]?.base || "";
}

interface ModelSignature {
  modelName: string;
  base: string;
  warehouseNumbers: Set<string>;
  boxNumbers: Set<string>;
}

function normalizedLocation(value: string | undefined): string {
  return (value || "").trim().toLocaleLowerCase("ko");
}

function matchesKnownModelLocation(item: ProductCatalogItem, signature: ModelSignature): boolean {
  const boxNumber = normalizedLocation(item.boxNumber);
  if (boxNumber && signature.boxNumbers.size > 0) return signature.boxNumbers.has(boxNumber);
  const warehouseNumber = normalizedLocation(item.warehouseNumber);
  if (warehouseNumber && signature.warehouseNumbers.size > 0) return signature.warehouseNumbers.has(warehouseNumber);
  return true;
}

/** 제품DB 옵션 열이 빈 구형 행은 같은 모델의 실제 상품명 공통부 뒤 문자열만 표시용 옵션 후보로 쓴다. */
export function buildLiveCatalogLookup(items: ProductCatalogItem[]): LiveCatalogLookup {
  const groups = new Map<string, ProductCatalogItem[]>();
  for (const item of items) {
    const key = item.modelName.trim().toLocaleLowerCase();
    if (!key) continue;
    groups.set(key, [...(groups.get(key) || []), item]);
  }

  const signatures: ModelSignature[] = [];
  const derivedOptions = new Map<string, string>();
  for (const group of groups.values()) {
    const base = commonProductNameBase(group);
    if (!base) continue;
    signatures.push({
      modelName: group[0].modelName,
      base,
      warehouseNumbers: new Set(group.map(row => normalizedLocation(row.warehouseNumber)).filter(Boolean)),
      boxNumbers: new Set(group.map(row => normalizedLocation(row.boxNumber)).filter(Boolean)),
    });
    for (const item of group) {
      const cleanedName = cleanDisplayProductName(item.productName);
      if (item.optionLabel.trim() || cleanedName.includes(",") || !cleanedName.startsWith(base)) continue;
      const suffix = cleanedName.slice(base.length).replace(/^[\s,\/\-–—]+/, "").trim();
      if (suffix && suffix.length <= 80) derivedOptions.set(normalizeSkuId(item.skuId), suffix);
    }
  }

  // 일부 구형 제품DB 행은 SKU·상품명·창고가 정상인데 모델명/모델SKU만 비어 있다. 이 행을 SKU로
  // 정렬하면 같은 모델 옵션 사이에 다른 모델이 끼므로, 같은 위치에서 상품명 공통부가 정확히 맞는
  // 기존 모델이 하나뿐일 때만 표시/정렬용 모델명을 복원한다. 충돌하거나 위치가 다르면 추론하지 않는다.
  const inferredModels = new Map<string, { modelName: string; derivedOptionLabel?: string }>();
  for (const item of items) {
    if (item.modelName.trim() || item.modelSku.trim()) continue;
    const normalizedSkuId = normalizeSkuId(item.skuId);
    const cleanedName = cleanDisplayProductName(item.productName);
    if (!normalizedSkuId || !cleanedName) continue;
    const candidates = signatures.filter(signature =>
      cleanedName.startsWith(signature.base) && matchesKnownModelLocation(item, signature)
    );
    const modelNames = Array.from(new Set(candidates.map(candidate => candidate.modelName)));
    if (modelNames.length !== 1) continue;
    const signature = candidates.find(candidate => candidate.modelName === modelNames[0])!;
    const suffix = cleanedName.slice(signature.base.length).replace(/^[\s,\/\-–—]+/, "").trim();
    inferredModels.set(normalizedSkuId, {
      modelName: signature.modelName,
      derivedOptionLabel: suffix && suffix.length <= 80 ? suffix : undefined,
    });
  }

  const map: LiveCatalogLookup = new Map();
  for (const item of items) {
    const normalizedSkuId = normalizeSkuId(item.skuId);
    const inferred = inferredModels.get(normalizedSkuId);
    const enriched: LiveCatalogItem = {
      ...item,
      modelName: item.modelName || inferred?.modelName || "",
      derivedOptionLabel: derivedOptions.get(normalizedSkuId) || inferred?.derivedOptionLabel,
    };
    if (normalizedSkuId) map.set(normalizedSkuId, enriched);
    if (item.modelSku) map.set(`${MODEL_SKU_KEY_PREFIX}${normalizeModelSkuKey(item.modelSku)}`, enriched);
  }
  return map;
}

export async function fetchLiveCatalogLookup(): Promise<LiveCatalogLookup> {
  const map: LiveCatalogLookup = new Map();
  try {
    const response = await fetch("/api/wms/product-catalog", { cache: "no-store" });
    const data = await response.json();
    if (response.ok && data.configured) {
      return buildLiveCatalogLookup((data.items || []) as ProductCatalogItem[]);
    }
  } catch {
    // 조회 실패 시 빈 맵을 돌려준다 — 호출한 화면은 저장된 웨이브 아이템 값을 그대로 보여준다.
  }
  return map;
}

export interface LiveResolvedFields {
  category?: string;
  gender?: string;
  /** 옵션이 상품명 끝에 중복 포함돼 있으면 제거된 상품명 (resolveDisplayNameAndOption 재사용,
   *  2026-08-20 신규 — 이전에는 화면마다 cleanDisplayProductName만 따로 불러 옵션 중복이 남았다) */
  name: string;
  /** "" 이면 화면에서 "옵션 없음"으로 표시 */
  optionLabel: string;
  imageUrl?: string;
  vendorName?: string;
  catalogWarehouseNumber?: string;
  catalogBoxNumber?: string;
  catalogBarcode?: string;
  /** 제품DB "모델명/품번"(예: "we0001") — 옵션별로 공유되는 값이라 모델SKU와 다르다
   *  (2026-08-20 신규 — 상품 정보 수정창의 "모델명" 입력칸용). */
  catalogModelName?: string;
  /** 제품DB "현재고" 자유 텍스트 컬럼 (2026-08-20 신규). */
  catalogCurrentStock?: string;
  /** 제품DB 원가(부가세포함). 입고단가 화면과 동일한 최신값 확인용. */
  catalogCostVatIncluded?: string;
  /** 제품DB 현재상태. 단종해제 시 임의값을 쓰지 않고 실제 상태를 표시한다. */
  catalogCurrentStatus?: string;
  /** 제품DB 제조국명. 상품정보 수정 화면에서 같은 live catalog 값을 재사용한다. */
  countryOfOrigin?: string;
  /** 제품DB "제품링크" — 웨이브 아이템에는 애초에 저장되지 않는 필드라 대체값 없이 최신
   *  제품DB 값만 그대로 쓴다(2026-08-20 신규, 임의 URL 생성 금지). */
  productLink?: string;
  /** 최신 제품DB에서 실제로 매칭된 항목의 모델SKU — 있으면 웨이브 아이템에 백필해 다음
   *  새로고침부터는 이 값으로 먼저 재매칭할 수 있게 한다(2026-08-20 신규). */
  liveModelSku?: string;
  /** 최신 제품DB의 실제 SKU ID. item.productCode(웨이브 아이템 고유 식별자)와 다르면 그
   *  사이에 제품DB SKU ID가 바뀐 것 — 화면에는 표시하되 item.productCode/id는 바꾸지 않는다
   *  (2026-08-20 신규). */
  liveSkuId?: string;
  /** 이번 새로고침에서 실제로 어떤 방식으로 매칭됐는지 — 결과 요약 집계용 (2026-08-20 신규). */
  matchedBy: "modelSku" | "skuId" | "none";
}

type LiveResolvableItem = Pick<
  PickingWaveItem,
  | "productCode"
  | "productName"
  | "category"
  | "gender"
  | "optionLabel"
  | "imageUrl"
  | "vendorName"
  | "catalogWarehouseNumber"
  | "catalogBoxNumber"
  | "catalogBarcode"
  | "catalogCurrentStock"
  | "modelName"
  | "modelSku"
>;

/**
 * 웨이브 생성 시점 스냅샷(item)과 최신 제품DB(liveCatalogByProductCode)를 합쳐 화면에 보여줄 값을
 * 계산한다. 매칭 우선순위(2026-08-20 신규 — SKU ID가 나중에 바뀐 상품 재매칭 지원):
 * 1) item.modelSku가 있으면 최신 제품DB에서 같은 모델SKU를 정확히 찾는다(옵션별 고유값이라
 *    색상/사이즈가 다른 옵션과 섞이지 않는다).
 * 2) 모델SKU가 없거나 못 찾으면(2026-08-20 이전에 생성된 웨이브 등) 기존 방식대로 SKU ID로
 *    찾는다 — 이때도 형식 차이(끝자리 ".0" 등)를 정규화해서 비교한다.
 * 3) 상품명만으로 매칭하지 않는다 — 못 찾으면 matchedBy:"none"으로 웨이브 저장값을 그대로 쓴다.
 */
export function resolveLiveFields(item: LiveResolvableItem, liveCatalogByProductCode?: LiveCatalogLookup): LiveResolvedFields {
  let live: LiveCatalogItem | undefined;
  let matchedBy: "modelSku" | "skuId" | "none" = "none";

  if (item.modelSku && liveCatalogByProductCode) {
    const byModel = liveCatalogByProductCode.get(`${MODEL_SKU_KEY_PREFIX}${normalizeModelSkuKey(item.modelSku)}`);
    if (byModel) {
      live = byModel;
      matchedBy = "modelSku";
    }
  }
  if (!live && liveCatalogByProductCode) {
    const bySku = liveCatalogByProductCode.get(normalizeSkuId(item.productCode));
    if (bySku) {
      live = bySku;
      matchedBy = "skuId";
    }
  }

  let { name, option } = resolveDisplayNameAndOption(item.productName, item.optionLabel, live?.optionLabel);
  if (!option && live?.derivedOptionLabel) {
    ({ name, option } = resolveDisplayNameAndOption(item.productName, live.derivedOptionLabel));
  }
  if (process.env.NODE_ENV !== "production" && !option) {
    console.debug("[WMS option mapping]", {
      sourceSkuId: item.productCode,
      normalizedSkuId: normalizeSkuId(item.productCode),
      matchedBy,
      catalogMatched: Boolean(live),
      storedOption: item.optionLabel || "",
      catalogOption: live?.optionLabel || "",
      derivedOption: live?.derivedOptionLabel || "",
      finalOption: option,
    });
  }
  return {
    category: live ? live.category : item.category,
    gender: live ? live.gender : item.gender,
    name,
    optionLabel: option,
    imageUrl: live?.imageUrl || item.imageUrl,
    vendorName: live?.vendorName || item.vendorName,
    catalogWarehouseNumber: live?.warehouseNumber || item.catalogWarehouseNumber,
    catalogBoxNumber: live?.boxNumber || item.catalogBoxNumber,
    catalogBarcode: live?.barcode || item.catalogBarcode,
    catalogModelName: live?.modelName || item.modelName,
    catalogCurrentStock: live?.currentStock || item.catalogCurrentStock,
    catalogCostVatIncluded: live?.costVatIncluded || undefined,
    catalogCurrentStatus: live?.currentStatus || undefined,
    countryOfOrigin: live?.countryOfOrigin || undefined,
    productLink: live?.productLink || undefined,
    liveModelSku: live?.modelSku || undefined,
    liveSkuId: live?.skuId || undefined,
    matchedBy,
  };
}
