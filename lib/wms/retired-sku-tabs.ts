/**
 * 옛 SKU 탭(사용자 확정 2026-10-22) — 한 SKU는 한 탭에만 둔다.
 * - 실적저조SKU: 쿠팡이 판매량저조로 강제 발주중단한 SKU(예전 이름 '재등록SKU'). 새 SKU로 재등록해야 하고 제품DB로 되돌리지 않는다.
 * - 그 외 재등록SKU: 실적저조가 아닌데 재등록할 SKU(예: 소재수정후 재등록).
 * - 판매중지SKU: 제품DB 현재상태가 판매중지(제품링크가 죽음)인 SKU. 재등록 없이는 제품DB로 가지 않는다.
 */
export const LOW_PERFORMANCE_TAB = "실적저조SKU";
export const OTHER_REREGISTRATION_TAB = "그 외 재등록SKU";
export const STOPPED_TAB = "판매중지SKU";
/** 예전 이름 — 탭 이름을 바꾸기 전에도 동작하게 함께 찾는다. */
export const LEGACY_REREGISTRATION_TAB = "재등록SKU";

/** 실적저조SKU 탭 이름: 새 이름이 있으면 그것, 없으면 예전 '재등록SKU'. */
export function pickLowPerformanceTab(titles: readonly string[]): string | null {
  if (titles.includes(LOW_PERFORMANCE_TAB)) return LOW_PERFORMANCE_TAB;
  return titles.includes(LEGACY_REREGISTRATION_TAB) ? LEGACY_REREGISTRATION_TAB : null;
}

/** 재등록할 옛 SKU가 있는 탭(실적저조SKU·그 외 재등록SKU). 진행상태·새 SKU ID 열을 쓴다. */
export const REREGISTRATION_TABS = [LOW_PERFORMANCE_TAB, OTHER_REREGISTRATION_TAB, LEGACY_REREGISTRATION_TAB] as const;
/** 제품DB로 가면 안 되는 옛 SKU가 있는 탭 전부. */
export const RETIRED_SKU_TABS = [...REREGISTRATION_TABS, STOPPED_TAB] as const;

/**
 * 쿠팡 단종해제 결과 파일('실적저조 영구발주중지sku.xlsx', 구글 드라이브)에서
 * Comments가 '담당 BM분과 협의하여 변경 필요'(해제 거절 = 판매량저조 영구 발주중지)인 SKU 63개.
 * 이 SKU는 어느 탭에 있든, 현재상태를 뭐라고 적든 제품DB로 보내지 않는다. 새로 생기면 여기에 더한다.
 */
export const LOW_PERFORMANCE_SKU_IDS: ReadonlySet<string> = new Set([
  "13722499", "13722500", "20438316", "24193132", "35718335", "35718347", "36759025", "36759030",
  "36775756", "36786782", "36792346", "36792348", "36792399", "36925650", "37882551", "38256578",
  "38813806", "38921479", "38921618", "38921635", "39010054", "39136022", "39374888", "39375274",
  "39396418", "39396420", "39404613", "39626043", "39626049", "39626057", "39626072", "39626082",
  "39659664", "39659680", "39761023", "39761025", "39761027", "39783305", "39787149", "39861802",
  "39914383", "40149857", "40283988", "40283990", "40284046", "40284050", "41093260", "41933037",
  "42077433", "42116734", "43087241", "43089692", "43089694", "43095733", "44947076", "45475723",
  "45475727", "46177718", "47425268", "49867947", "49996752", "50589893", "50589895",
]);
