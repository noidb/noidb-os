import type { PickingWaveItem } from "./types";
import { cleanDisplayProductName } from "../display-name";
import { resolveWarehouseCategoryBucket, warehouseCategorySortIndex } from "../category-order";
import type { LiveCatalogLookup } from "./live-catalog";

/**
 * 통합 피킹 화면의 그룹/정렬 기준을 화면 코드와 분리하는 모듈.
 *
 * 지금은 창고 위치(BOX)가 하나도 등록되지 않았으므로 "model" 모드(카테고리→모델명→SKU→발주수량)로
 * 고정한다. 창고 위치가 나중에 구축되면 PICKING_GROUPING_MODE 상수만 "location"으로 바꾸면
 * 화면 컴포넌트 수정 없이 정렬/완료 단위가 구역→선반→BOX→모델→SKU로 전환된다.
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
  const modelKey = item.modelName || item.productCode;
  const liveEntry = liveCatalogByProductCode?.get(item.productCode);
  const effectiveCategory = liveEntry ? liveEntry.category : item.category;
  const bucket = resolveWarehouseCategoryBucket(effectiveCategory);
  const bucketPriority = String(warehouseCategorySortIndex(bucket)).padStart(2, "0");
  // 창고번호/BOX번호는 대부분 비어있어(2026-08-19 확인) 실제 위치 순서로 쓰지 못한다 —
  // 기존 순서(창고번호 → 모델명 → SKU → 수량)를 그대로 유지하고 버킷 우선순위만 맨 앞에 둔다.
  const sortKey = `${bucketPriority}::${item.catalogWarehouseNumber || ""}::${item.catalogBoxNumber || ""}::${modelKey}::${item.productCode}::${String(Math.max(0, Math.round(item.totalQuantity))).padStart(6, "0")}`;

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
