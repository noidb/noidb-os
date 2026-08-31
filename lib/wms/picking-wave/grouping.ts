import type { PickingWaveItem } from "./types";
import { cleanDisplayProductName } from "../display-name";
import { resolveWarehouseCategoryBucket } from "../category-order";
import { resolveLiveFields, type LiveCatalogLookup } from "./live-catalog";
import { normalizeSkuId } from "../sku-normalize";

/**
 * 통합 피킹 화면의 그룹/정렬 기준을 화면 코드와 분리하는 모듈.
 *
 * 지금은 완료 단위를 모델로 유지한다. 정렬은 모드와 무관하게 위치/창고번호→모델명→옵션→SKU를
 * 공통 적용하며, 창고 위치가 구축된 뒤 "location" 모드로 바꾸면 완료 단위만 BOX로 전환된다.
 */
export type PickingGroupingMode = "model" | "location";

export const PICKING_GROUPING_MODE: PickingGroupingMode = "model";

export interface PickingGroup {
  /** "model:GN-1002" | "box:E-A-001" */
  groupId: string;
  groupKind: "model" | "box";
  /** 화면에 보여줄 그룹 이름 */
  groupLabel: string;
  /** model 모드: 카테고리, location 모드: 선반id */
  sectionId: string;
  sectionLabel: string;
  /** item.modelSortKey 또는 item.locationSortKey를 그대로 재사용 */
  sortKey: string;
}

/**
 * SKU(상품코드) → 제품DB 최신 카테고리 값. 웨이브 생성 시점에 저장된 item.category 대신
 * liveCatalogByProductCode(LiveCatalogLookup)의 최신 값으로 창고 버킷을 계산한다 — 구글시트에서
 * 카테고리를 나중에 고쳐도, "제품DB 새로고침"으로 이 맵을 다시 불러와 넘기기만 하면 바로
 * 반영된다(2026-08-19 사용자 확정, 계산 결과를 어디에도 캐시하지 않음).
 */
export type { LiveCatalogLookup } from "./live-catalog";

export interface PickingItemSortIdentity {
  location: readonly string[];
  model: string;
  option: string;
  skuId: string;
}

function natural(value: string | undefined): string {
  return (value || "￿").trim().toLocaleLowerCase("ko");
}

function compareNatural(a: string | undefined, b: string | undefined): number {
  return natural(a).localeCompare(natural(b), "ko", { numeric: true });
}

/**
 * 웨이브 생성·피킹·완료 화면이 함께 쓰는 단일 정렬 기준.
 * 물류센터/발주서는 sources에만 남겨 최종 수량 분배에 사용하고, 피킹 순서에는 넣지 않는다.
 */
export function resolvePickingItemSortIdentity(
  item: PickingWaveItem,
  liveCatalogByProductCode?: LiveCatalogLookup
): PickingItemSortIdentity {
  const live = resolveLiveFields(item, liveCatalogByProductCode);
  const catalogLocation = live.catalogBoxNumber || live.catalogWarehouseNumber
    || item.catalogBoxNumber || item.catalogWarehouseNumber;
  const location = item.locationStatus === "located"
    ? [item.zoneId || "￿", item.shelfId || "￿", item.boxId || catalogLocation || "￿"]
    : ["￿", "￿", catalogLocation || "￿"];

  return {
    location,
    // 모델명/품번은 여러 옵션이 공유하는 기준이다. 모델SKU는 옵션별 고유값이므로 모델명이
    // 없는 구형 웨이브에서만 안전한 차선 키로 사용한다.
    model: live.catalogModelName || item.modelName || item.modelSku || item.productCode,
    option: live.optionLabel || item.optionLabel || "",
    skuId: normalizeSkuId(live.liveSkuId || item.productCode),
  };
}

export function comparePickingWaveItems(
  a: PickingWaveItem,
  b: PickingWaveItem,
  liveCatalogByProductCode?: LiveCatalogLookup
): number {
  const ak = resolvePickingItemSortIdentity(a, liveCatalogByProductCode);
  const bk = resolvePickingItemSortIdentity(b, liveCatalogByProductCode);
  for (let index = 0; index < Math.max(ak.location.length, bk.location.length); index += 1) {
    const diff = compareNatural(ak.location[index], bk.location[index]);
    if (diff) return diff;
  }
  return compareNatural(ak.model, bk.model)
    || compareNatural(ak.option, bk.option)
    || compareNatural(ak.skuId, bk.skuId);
}

export function sortPickingWaveItems(
  items: readonly PickingWaveItem[],
  liveCatalogByProductCode?: LiveCatalogLookup
): PickingWaveItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => comparePickingWaveItems(a.item, b.item, liveCatalogByProductCode) || a.index - b.index)
    .map(entry => entry.item);
}

export function resolveGroup(
  item: PickingWaveItem,
  liveCatalogByProductCode?: LiveCatalogLookup,
  mode: PickingGroupingMode = PICKING_GROUPING_MODE
): PickingGroup {
  if (mode === "location" && item.locationStatus === "located" && item.boxId && item.shelfId) {
    return {
      groupId: `box:${item.boxId}`,
      groupKind: "box",
      groupLabel: `BOX ${item.boxId}`,
      sectionId: item.shelfId,
      sectionLabel: `선반 ${item.shelfId}`,
      sortKey: item.locationSortKey,
    };
  }

  // model 모드이거나, location 모드인데 그 아이템만 위치 미등록인 경우 → 모델 그룹으로 처리한다.
  // 그룹 묶음 자체는 내부적으로 모델명 기준을 유지하지만(같은 모델의 옵션들을 하나로 묶어야 하므로),
  // 화면에 보여주는 라벨은 모델코드 대신 상품명(표시용 정리 적용)을 쓴다 (2026-08-19 사용자 확정
  // — "모델명처럼 보이는 값" 대신 실제 상품명이 보여야 함).
  const live = resolveLiveFields(item, liveCatalogByProductCode);
  const modelKey = live.catalogModelName || item.modelName || item.modelSku || item.productCode;
  const effectiveCategory = live.category;
  const effectiveGender = live.gender;
  const bucket = resolveWarehouseCategoryBucket(effectiveCategory, effectiveGender, item.productName);
  // 섹션 라벨은 기존 창고 카테고리를 유지한다. 실제 아이템 순서는 공통 comparator가
  // 위치/창고번호 → 모델명 → 옵션 → SKU 순으로 결정한다.
  const identity = resolvePickingItemSortIdentity(item, liveCatalogByProductCode);
  // 기존 PickingGroup 계약은 유지하되 실제 정렬 소비자는 comparePickingWaveItems를 사용한다.
  const sortKey = `${identity.location.join("::")}::${identity.model}::${identity.option}::${identity.skuId}`;

  return {
    groupId: `model:${modelKey}`,
    groupKind: "model",
    groupLabel: cleanDisplayProductName(item.productName),
    sectionId: bucket,
    sectionLabel: bucket,
    sortKey,
  };
}

/** 완료 버튼 문구 — 그룹 종류에 따라 자동 전환 */
export function groupCompleteLabel(kind: PickingGroup["groupKind"]): string {
  return kind === "box" ? "BOX 완료" : "그룹(모델) 완료";
}
