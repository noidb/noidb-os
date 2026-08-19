/**
 * "입고예정일/물류센터 변경 추천" 카드에서 사용자가 고른 선택(변경완료/이번에는 변경 안 함/나중에 확인)을
 * 브라우저에만 저장하는 아주 단순한 localStorage 헬퍼. 서버/구글시트에는 저장하지 않으며,
 * 이 선택은 화면 표시(어떤 배지를 보여줄지)에만 쓰이고 그 자체로 어떤 자동 변경도 일으키지 않는다.
 */

export type ScheduleRecommendationDecision = "changed" | "not_changed" | "later";

const STORAGE_KEY = "noidb_schedule_recommendation_decisions";

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readAll(): Record<string, ScheduleRecommendationDecision> {
  if (!isBrowser()) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function getScheduleRecommendationDecisions(): Record<string, ScheduleRecommendationDecision> {
  return readAll();
}

export function setScheduleRecommendationDecision(
  recommendationId: string,
  decision: ScheduleRecommendationDecision
): Record<string, ScheduleRecommendationDecision> {
  const all = readAll();
  all[recommendationId] = decision;
  if (isBrowser()) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  return all;
}
