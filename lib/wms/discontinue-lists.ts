import type { ProductCatalogItem } from "./product-catalog";
import { LOW_PERFORMANCE_SKU_IDS } from "./retired-sku-tabs";

/**
 * 단종 대상·단종해제 대상 목록(사용자 확정 2026-10-08). 제품DB에서 매번 새로 계산한다.
 * - 단종 대상: 현재상태가 아래 단종 계열인데 쿠팡 발주가능상태가 아직 '정상'인 SKU
 * - 단종해제 대상: 현재상태가 아래 판매 계열인데 발주가능상태가 '정상'이 아닌 SKU
 *   + 사용자가 메모로 준 SKU + 입고결과 화면에서 '단종해제'를 누른 SKU
 */
export const DISCONTINUE_CURRENT_STATUSES = ["판매중지", "단종", "거래처단종", "가품중단"];
/** 2026-10-22: 보관 탭에서 '재고있음'으로 바꿔 제품DB로 옮겨진 줄도 단종해제 대상에 자동으로 넣는다. */
export const RELEASE_CURRENT_STATUSES = ["과재고", "발주가능상태 정상전환대상", "제품DB로 이동(재고있음)", "재고있음"];
/** 사용자가 메모장에 모아 둔 단종해제 SKU(2026-10-08). */
export const MEMO_RELEASE_SKU_IDS: readonly string[] = [
  "58963350", "58963352", "59263874", "38921463", "37667186", "38921545", "38813805",
  "39399014", "38813802", "39399011", "40284016", "39135983", "38921513",
];
/** 사용자가 단종 대상이라고 알려 준 SKU(2026-10-08) — 판매중지(제품링크 중단)·재등록완료된 옛 SKU라 발주가능상태가 불가여야 한다. */
export const MEMO_DISCONTINUE_SKU_IDS: readonly string[] = ["39127489", "38248703", "36789607"];

export interface StatusListItem { skuId: string; productName: string; currentStatus: string; orderableStatus: string; reason: string; key: string; /** 옮겨 오기 전 탭(비관리SKU '원본 위치') */ origin?: string; /** 옮긴 이유(비관리SKU 보관사유 등) */ moveReason?: string; /** 지금 이 SKU가 있는 탭(2026-10-23: 시트에서 바로 찾게) */ currentTab?: string }
export interface StatusLists { discontinue: StatusListItem[]; release: StatusListItem[]; /** 재등록으로 바뀐 옛 SKU라서 뺀 SKU */ reregisteredExcluded: string[] }
/** '목록 비우기'로 처리완료한 항목. 키는 SKU·현재상태·발주가능상태 묶음이라 상태가 바뀌면 다시 나타난다. */
export type StatusListCleared = { discontinue?: Record<string, string>; release?: Record<string, string> };

const squash = (value: string) => value.replace(/\s+/g, "");
const matches = (value: string, list: readonly string[]) => list.some(item => squash(item) === squash(value));
/** 2026-10-22: 현재상태에 다른 글이 붙어도(예: 누적입고100이상/재고있음, 단종(중복등록)) 잡는다. '단종해제'는 단종이 아니다. */
const isDiscontinueStatus = (value: string) => matches(value, DISCONTINUE_CURRENT_STATUSES) || (squash(value).includes("단종") && !squash(value).includes("해제"));
const isReleaseStatus = (value: string) => matches(value, RELEASE_CURRENT_STATUSES) || /재고있음|과재고/.test(squash(value));
const itemKey = (item: Pick<ProductCatalogItem, "skuId" | "currentStatus" | "orderableStatus">, extra = "") =>
  JSON.stringify([item.skuId, squash(item.currentStatus), squash(item.orderableStatus), extra]);
const displayName = (item: Pick<ProductCatalogItem, "productName" | "optionLabel">) => [item.productName, item.optionLabel].filter(Boolean).join(", ");

/** 처리완료 기록 키(JSON 배열)의 SKU ID */
export function clearedSkuId(key: string): string {
  try {
    const parsed = JSON.parse(key) as unknown;
    return Array.isArray(parsed) ? String(parsed[0] ?? "").trim() : "";
  } catch { return ""; }
}

/** 가장 최근에 '목록 비우기'로 한꺼번에 비운 묶음(같은 시각에 기록된 키들) — 되살리기용(2026-10-20) */
export function lastClearedBatch(cleared: Record<string, string> = {}): { at: string; keys: string[] } | null {
  let at = "";
  for (const value of Object.values(cleared)) if (String(value || "") > at) at = String(value || "");
  if (!at) return null;
  return { at, keys: Object.entries(cleared).filter(([, value]) => value === at).map(([key]) => key) };
}

export function buildStatusLists(items: readonly (Pick<ProductCatalogItem, "skuId" | "currentStatus" | "orderableStatus" | "productName" | "optionLabel" | "reregistrationTier"> & { storageTab?: boolean; sourceTab?: string; origin?: string; productLink?: string; moveReason?: string })[], options: {
  releaseFromScreen?: Record<string, { productName: string; at?: string; manual?: boolean }>;
  cleared?: StatusListCleared;
  memoReleaseSkuIds?: readonly string[];
  memoDiscontinueSkuIds?: readonly string[];
  /** 제품DB에 없는 SKU의 상품명 대신 쓸 이름(쿠팡 입고결과 등) */
  nameFallback?: Record<string, string>;
  /** 재등록SKU·교체이력에 있는 옛 SKU — 두 목록 모두에서 뺀다 */
  reregisteredSkuIds?: ReadonlySet<string>;
} = {}): StatusLists {
  const bySku = new Map(items.map(item => [item.skuId, item]));
  const discontinue = new Map<string, StatusListItem>();
  const release = new Map<string, StatusListItem>();
  for (const item of items) {
    if (!item.skuId) continue;
    const orderable = item.orderableStatus.trim();
    // 2026-10-22 사용자 확정: 비관리SKU 탭 줄은 '재고있음'(→ 제품DB로 옮길 것)이 아니면 모두 단종할 상품이다.
    // 쿠팡 발주가능상태가 아직 '정상'이면 현재상태가 무엇이든(비관리(중복등록)·재등록완료·빈칸 등) 단종 대상이고,
    // 예전에 목록을 비웠어도 쿠팡이 아직 정상이면 다시 보인다(서류가 안 들어간 것이므로).
    if (item.storageTab && orderable === "정상" && !squash(item.currentStatus).includes("재고있음")) {
      discontinue.set(item.skuId, { skuId: item.skuId, productName: displayName(item), currentStatus: item.currentStatus.trim(), orderableStatus: orderable, reason: "비관리SKU", key: itemKey(item, "비관리SKU"), origin: item.origin, moveReason: item.moveReason });
    } else if (item.sourceTab && orderable === "정상") {
      // 2026-10-23: 판매중지SKU·실적저조SKU·그 외 재등록SKU(제품DB로 갈 수 없는 옛 SKU)는 현재상태와 상관없이 쿠팡이 '정상'이면 단종 대상.
      discontinue.set(item.skuId, { skuId: item.skuId, productName: displayName(item), currentStatus: item.currentStatus.trim(), orderableStatus: orderable, reason: item.sourceTab, key: itemKey(item, item.sourceTab), origin: item.sourceTab === "판매중지SKU" ? "제품DB" : undefined });
    } else if (isDiscontinueStatus(item.currentStatus) && orderable === "정상") {
      discontinue.set(item.skuId, { skuId: item.skuId, productName: displayName(item), currentStatus: item.currentStatus.trim(), orderableStatus: orderable, reason: item.sourceTab || "제품DB", key: itemKey(item), origin: item.sourceTab ? "제품DB" : undefined });
    } else if (!isDiscontinueStatus(item.currentStatus) && isReleaseStatus(item.currentStatus) && orderable !== "정상") {
      release.set(item.skuId, { skuId: item.skuId, productName: displayName(item), currentStatus: item.currentStatus.trim(), orderableStatus: orderable || "미확인", reason: "제품DB", key: itemKey(item) });
    }
  }
  const addRelease = (skuId: string, fallbackName: string, reason: string) => {
    if (release.has(skuId)) return;
    const item = bySku.get(skuId);
    // 2026-10-23: 옛 SKU 탭(판매중지SKU·실적저조SKU·그 외 재등록SKU)에 있는 SKU는 해제 대상이 아니다.
    // 예전 메모(10-08) 해제 목록에 있어도 단종 목록에서 빼지 않는다(빠졌다가 '재등록완료 옛 SKU'로 잘못 다시 들어갔음: 37667186·40284016 등).
    if (item?.sourceTab) return;
    // 이미 쿠팡 발주가능상태가 정상이면 해제할 필요가 없다(메모·화면 선택이라도 뺀다).
    if (item && item.orderableStatus.trim() === "정상") { discontinue.delete(skuId); return; }
    release.set(skuId, { skuId, productName: item ? displayName(item) : fallbackName || options.nameFallback?.[skuId] || "제품DB에 없음", currentStatus: item?.currentStatus.trim() || "",
      orderableStatus: item?.orderableStatus.trim() || "미확인", reason, key: item ? itemKey(item, reason) : JSON.stringify([skuId, reason]) });
    discontinue.delete(skuId);
  };
  for (const skuId of options.memoReleaseSkuIds ?? MEMO_RELEASE_SKU_IDS) addRelease(skuId, "", "메모");
  for (const [skuId, check] of Object.entries(options.releaseFromScreen || {})) addRelease(skuId, check.productName, check.manual ? "직접 추가" : "입고결과");
  // 한 번 '목록 비우기'로 처리한 SKU는 현재상태·발주가능상태·탭(제품DB↔보관)이 바뀌어도 다시 띄우지 않는다
  // (사용자 요청 2026-10-19 — 처리한 79건이 다시 떠서 하나하나 다시 확인해야 했음). 기록 키의 첫 칸이 SKU ID다.
  // 단, 비운 뒤에 입고결과 화면에서 새로 '단종해제'를 누른 SKU는 사용자가 직접 다시 고른 것이므로 보인다.
  const visible = (list: Map<string, StatusListItem>, cleared: Record<string, string> = {}) => {
    const doneAt = new Map<string, string>();
    for (const [key, at] of Object.entries(cleared)) {
      const skuId = clearedSkuId(key);
      if (skuId && String(at || "") > (doneAt.get(skuId) || "")) doneAt.set(skuId, String(at || ""));
      else if (skuId && !doneAt.has(skuId)) doneAt.set(skuId, "");
    }
    // 2026-10-22: 직접 추가한 SKU, 제품DB로 이미 목록에 있던 SKU를 다시 고른 경우도 비운 뒤 새로 고른 것으로 본다.
    const pickedAgain = (item: StatusListItem) => {
      // 옛 SKU 탭(비관리SKU·판매중지SKU·실적저조SKU·그 외 재등록SKU)에 있는데 아직 정상이면 서류가 안 들어간 것 → 다시 보인다.
      if (list === discontinue && ["비관리SKU", "판매중지SKU", "실적저조SKU", "그 외 재등록SKU"].includes(item.reason)) return true;
      const at = list === release ? options.releaseFromScreen?.[item.skuId]?.at : undefined;
      return Boolean(at && at > (doneAt.get(item.skuId) || ""));
    };
    return [...list.values()].filter(item => pickedAgain(item) || (!cleared[item.key] && !doneAt.has(item.skuId))).sort((a, b) => a.skuId.localeCompare(b.skuId));
  };
  // 재등록SKU 탭·교체이력의 옛 SKU, 제품DB 재등록구분이 판매량저조영구정지·영구제외·재등록완료인 SKU는
  // 단종해제 대상이 아니다(신규 재등록 대상, 사용자 확인 2026-10-08) → 단종해제에서 뺀다.
  // 그중 재등록이 끝난 옛 SKU는 발주가능상태가 '불가'여야 정상이므로, 아직 '정상'이면 단종 대상에 넣는다.
  const reregistered = new Set<string>(options.reregisteredSkuIds || []);
  for (const item of items) if (/판매량저조|영구|재등록완료/.test(item.reregistrationTier || "")) reregistered.add(item.skuId);
  // 2026-10-23 사용자 확인: 단종해제 대상은 판매중지·실적저조 둘 다 아닌 SKU만.
  // 실적저조 목록(쿠팡 해제 거절), 현재상태 판매중지·판매중지SKU 탭, 판매중지 옵션과 같은 링크(노출상품ID)인 SKU는 화면에서 고른 것이라도 뺀다.
  const linkId = (item: { productLink?: string }) => String(item.productLink || "").match(/\/products\/(\d+)/)?.[1] || "";
  const isStopped = (item: (typeof items)[number]) => item.sourceTab === "판매중지SKU" || /판매중지/.test(item.currentStatus || "");
  const deadLinks = new Set(items.filter(isStopped).map(linkId).filter(Boolean));
  const notRelease = new Set<string>([...reregistered, ...LOW_PERFORMANCE_SKU_IDS]);
  for (const item of items) if (isStopped(item) || (linkId(item) && deadLinks.has(linkId(item)))) notRelease.add(item.skuId);
  const excluded = [...release.keys()].filter(skuId => notRelease.has(skuId)).sort();
  for (const skuId of excluded) release.delete(skuId);
  const addDiscontinue = (skuId: string, reason: string) => {
    if (discontinue.has(skuId)) return;
    const item = bySku.get(skuId);
    if (item && item.orderableStatus.trim() !== "정상") return; // 이미 불가·일시중단이면 할 일 없음
    release.delete(skuId);
    discontinue.set(skuId, { skuId, productName: item ? displayName(item) : options.nameFallback?.[skuId] || "제품DB에 없음",
      currentStatus: item?.currentStatus.trim() || "", orderableStatus: item?.orderableStatus.trim() || "미확인", reason,
      key: item ? itemKey(item, reason) : JSON.stringify([skuId, reason]) });
  };
  for (const skuId of reregistered) if (bySku.get(skuId)?.orderableStatus.trim() === "정상") addDiscontinue(skuId, "재등록완료 옛 SKU");
  for (const skuId of options.memoDiscontinueSkuIds ?? MEMO_DISCONTINUE_SKU_IDS) addDiscontinue(skuId, "메모");
  return { discontinue: visible(discontinue, options.cleared?.discontinue), release: visible(release, options.cleared?.release), reregisteredExcluded: excluded };
}
