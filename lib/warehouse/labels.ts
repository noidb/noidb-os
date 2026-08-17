import type { WarehouseBoxKind, WarehouseBoxStatus, WarehouseMigrationStatus } from "@/lib/wms/types";

export const BOX_KIND_LABEL: Record<WarehouseBoxKind, string> = {
  small_tool_box: "소형 공구박스",
  large_living_box: "큰 리빙박스",
  other: "기타",
};

export const BOX_STATUS_LABEL: Record<WarehouseBoxStatus, string> = {
  active: "사용중",
  empty: "비어있음",
  full: "가득참",
  retired: "폐기",
};

export const MIGRATION_STATUS_LABEL: Record<WarehouseMigrationStatus, string> = {
  unverified: "미확인",
  checking: "확인중",
  confirmed: "확정",
  skipped: "건너뜀",
};
