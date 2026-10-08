import type { ProductCatalogItem } from "./product-catalog";

/**
 * 단종 대상·단종해제 대상 목록(사용자 확정 2026-10-08). 제품DB에서 매번 새로 계산한다.
 * - 단종 대상: 현재상태가 아래 단종 계열인데 쿠팡 발주가능상태가 아직 '정상'인 SKU
 * - 단종해제 대상: 현재상태가 아래 판매 계열인데 발주가능상태가 '정상'이 아닌 SKU
 *   + 사용자가 메모로 준 SKU + 입고결과 화면에서 '단종해제'를 누른 SKU
 */
export const DISCONTINUE_CURRENT_STATUSES = ["판매중지", "단종", "거래처단종", "가품중단"];
export const RELEASE_CURRENT_STATUSES = ["과재고", "발주가능상태 정상전환대상", "제품DB로 이동(재고있음)"];
/** 사용자가 메모장에 모아 둔 단종해제 SKU(2026-10-08). */
export const MEMO_RELEASE_SKU_IDS: readonly string[] = [
  "58963350", "58963352", "59263874", "38921463", "37667186", "38921545", "38813805",
  "39399014", "38813802", "39399011", "40284016", "39135983", "38921513",
];
/** 사용자가 단종 대상이라고 알려 준 SKU(2026-10-08) — 판매중지(제품링크 중단)·재등록완료된 옛 SKU라 발주가능상태가 불가여야 한다. */
export const MEMO_DISCONTINUE_SKU_IDS: readonly string[] = ["39127489", "38248703", "36789607"];

export interface StatusListItem { skuId: string; productName: string; currentStatus: string; orderableStatus: string; reason: string; key: string }
export interface StatusLists { discontinue: StatusListItem[]; release: StatusListItem[]; /** 재등록으로 바뀐 옛 SKU라서 뺀 SKU */ reregisteredExcluded: string[] }
/** '목록 비우기'로 처리완료한 항목. 키는 SKU·현재상태·발주가능상태 묶음이라 상태가 바뀌면 다시 나타난다. */
export type StatusListCleared = { discontinue?: Record<string, string>; release?: Record<string, string> };

const squash = (value: string) => value.replace(/\s+/g, "");
const matches = (value: string, list: readonly string[]) => list.some(item => squash(item) === squash(value));
const itemKey = (item: Pick<ProductCatalogItem, "skuId" | "currentStatus" | "orderableStatus">, extra = "") =>
  JSON.stringify([item.skuId, squash(item.currentStatus), squash(item.orderableStatus), extra]);
const displayName = (item: Pick<ProductCatalogItem, "productName" | "optionLabel">) => [item.productName, item.optionLabel].filter(Boolean).join(", ");

export function buildStatusLists(items: readonly Pick<ProductCatalogItem, "skuId" | "currentStatus" | "orderableStatus" | "productName" | "optionLabel" | "reregistrationTier">[], options: {
  releaseFromScreen?: Record<string, { productName: string }>;
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
    if (matches(item.currentStatus, DISCONTINUE_CURRENT_STATUSES) && orderable === "정상") {
      discontinue.set(item.skuId, { skuId: item.skuId, productName: displayName(item), currentStatus: item.currentStatus.trim(), orderableStatus: orderable, reason: "제품DB", key: itemKey(item) });
    } else if (matches(item.currentStatus, RELEASE_CURRENT_STATUSES) && orderable !== "정상") {
      release.set(item.skuId, { skuId: item.skuId, productName: displayName(item), currentStatus: item.currentStatus.trim(), orderableStatus: orderable || "미확인", reason: "제품DB", key: itemKey(item) });
    }
  }
  const addRelease = (skuId: string, fallbackName: string, reason: string) => {
    if (release.has(skuId)) return;
    const item = bySku.get(skuId);
    // 이미 쿠팡 발주가능상태가 정상이면 해제할 필요가 없다(메모·화면 선택이라도 뺀다).
    if (item && item.orderableStatus.trim() === "정상") { discontinue.delete(skuId); return; }
    release.set(skuId, { skuId, productName: item ? displayName(item) : fallbackName || options.nameFallback?.[skuId] || "제품DB에 없음", currentStatus: item?.currentStatus.trim() || "",
      orderableStatus: item?.orderableStatus.trim() || "미확인", reason, key: item ? itemKey(item, reason) : JSON.stringify([skuId, reason]) });
    discontinue.delete(skuId);
  };
  for (const skuId of options.memoReleaseSkuIds ?? MEMO_RELEASE_SKU_IDS) addRelease(skuId, "", "메모");
  for (const [skuId, check] of Object.entries(options.releaseFromScreen || {})) addRelease(skuId, check.productName, "입고결과");
  const visible = (list: Map<string, StatusListItem>, cleared: Record<string, string> = {}) =>
    [...list.values()].filter(item => !cleared[item.key]).sort((a, b) => a.skuId.localeCompare(b.skuId));
  // 재등록SKU 탭·교체이력의 옛 SKU, 제품DB 재등록구분이 판매량저조영구정지·영구제외·재등록완료인 SKU는
  // 단종해제 대상이 아니다(신규 재등록 대상, 사용자 확인 2026-10-08) → 단종해제에서 뺀다.
  // 그중 재등록이 끝난 옛 SKU는 발주가능상태가 '불가'여야 정상이므로, 아직 '정상'이면 단종 대상에 넣는다.
  const reregistered = new Set<string>(options.reregisteredSkuIds || []);
  for (const item of items) if (/판매량저조|영구|재등록완료/.test(item.reregistrationTier || "")) reregistered.add(item.skuId);
  const excluded = [...release.keys()].filter(skuId => reregistered.has(skuId)).sort();
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
