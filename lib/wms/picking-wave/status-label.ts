import type { PickingWaveStatus } from "./types";

export const PICKING_WAVE_STATUS_LABEL: Record<PickingWaveStatus, string> = {
  in_progress: "진행중",
  completed: "피킹완료",
  result_confirmed: "결과확인됨",
  order_confirmed: "발주확정됨",
};
