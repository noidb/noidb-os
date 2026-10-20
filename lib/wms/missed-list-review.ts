import type { WeeklyWorkspace } from "./weekly-work-types";

/**
 * 재발주요청 화면 '전체 미납 목록'의 '검토 완료로 정리'(2026-10-20 사용자 요청).
 * 검토가 끝난 미납 줄을 목록에서만 숨긴다. 재발주요청·거래처발주·기존 발주 처리 기록은 건드리지 않는다.
 */
export function hideReviewedMissedLines(workspace: WeeklyWorkspace, lineKeys: string[], at = new Date().toISOString()) {
  const keys = [...new Set(lineKeys.filter(key => typeof key === "string" && key.trim()))];
  if (!keys.length) throw new Error("정리할 줄이 없습니다.");
  const current = workspace.missedListReviewed?.keys || {};
  const added = keys.filter(key => !current[key]);
  workspace.missedListReviewed = { keys: { ...current, ...Object.fromEntries(added.map(key => [key, at])) }, lastBatch: { at, keys: added } };
  return { hidden: added.length };
}

/** 방금 정리한 묶음을 목록에 되돌린다. */
export function undoLastMissedReview(workspace: WeeklyWorkspace) {
  const state = workspace.missedListReviewed;
  if (!state?.lastBatch?.keys.length) throw new Error("되돌릴 정리 기록이 없습니다.");
  const keys = { ...state.keys };
  for (const key of state.lastBatch.keys) delete keys[key];
  const restored = state.lastBatch.keys.length;
  workspace.missedListReviewed = { keys };
  return { restored };
}

/** 화면에 보낼 값: 숨긴 줄 키와, 3일 안에 정리한 마지막 묶음(되돌리기 버튼용). */
export function missedListReviewedView(workspace: WeeklyWorkspace, now = Date.now()) {
  const state = workspace.missedListReviewed;
  const batch = state?.lastBatch;
  const recent = batch && batch.keys.length > 0 && now - Date.parse(batch.at) < 3 * 24 * 60 * 60 * 1000;
  return { keys: Object.keys(state?.keys || {}), lastBatch: recent ? { at: batch.at, count: batch.keys.length } : null };
}
