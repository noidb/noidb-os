import type { PickingWaveItem } from "./types";

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

const UNCATEGORIZED_LABEL = "미분류";

export function resolveGroup(
  item: PickingWaveItem,
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
  const modelKey = item.modelName || item.productCode;
  return {
    groupId: `model:${modelKey}`,
    groupKind: "model",
    groupLabel: item.modelName || item.productName,
    sectionId: item.category || UNCATEGORIZED_LABEL,
    sectionLabel: item.category || UNCATEGORIZED_LABEL,
    sortKey: item.modelSortKey,
  };
}

/** 완료 버튼 문구 — 그룹 종류에 따라 자동 전환 */
export function groupCompleteLabel(kind: PickingGroup["groupKind"]): string {
  return kind === "box" ? "BOX 완료" : "그룹(모델) 완료";
}
