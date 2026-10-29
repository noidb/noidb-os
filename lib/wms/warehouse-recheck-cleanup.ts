import { createHash } from "node:crypto";
import { LOW_PERFORMANCE_SKU_IDS, LOW_PERFORMANCE_TAB, OTHER_REREGISTRATION_TAB, STOPPED_TAB } from "./retired-sku-tabs";

/**
 * 창고재확인 탭 정리(사용자 확정 2026-10-08)
 * - 창고 확인결과가 비어 있으면: 아직 확인 중 → 그대로 둔다
 * - 거래처단종: 보관 탭으로 옮긴다(현재상태 = 거래처단종)
 * - 제품DB로 이동(재고있음): 제품DB 탭으로 옮기고 현재상태는 비운다.
 *   제품DB에 같은 SKU가 이미 있으면 새 행을 만들지 않고 그 행의 현재상태만 비운다.
 *   발주가능상태가 정상이 아니면 단종해제 대상에 넣는다.
 * - 그 밖의 결과: 기준이 없어 그대로 두고 알려 준다
 * 옮긴 행은 창고재확인 탭에서 지운다. 열은 같은 이름끼리 맞춰 넣는다.
 *
 * 보관 탭 = '비관리SKU'(2026-10-22 사용자 요청으로 '_보관_비관리SKU_20261008'에서 이름 변경). 거래처단종은 이 탭으로 옮긴다.
 * 제품DB(사용자 확정 2026-10-19): 현재상태가 비관리(중복등록)·거래처단종·단종인 행은 보관 탭으로 옮기고 제품DB에서 지운다.
 *   판매중지·가품중단은 옮기지 않는다. 보관 탭에 같은 SKU가 이미 있으면 새로 붙이지 않고 제품DB에서만 지운다.
 * 재등록SKU 탭(사용자 확정 2026-10-22): 그 탭에 있는 옛 SKU는 현재상태와 상관없이 제품DB에서 지운다(새 SKU로 재등록할 대상).
 *   보관 탭이 아니라 재등록SKU 탭으로 옮긴다(사용자 정정 2026-10-22) — 이미 재등록SKU 탭에 있으면 제품DB에서만 지운다.
 *   보관 탭에서 '재고있음'으로 바꿔 둬도 재등록SKU 탭에 있으면 제품DB로 되돌리지 않는다.
 * 제품DB 현재상태에 '재등록'이 들어간 행(예: 재등록/소재수정후, 2026-10-22): 재등록SKU 탭에 한 줄 넣고(진행상태 대기) 제품DB에서 지운다.
 *
 * 2026-10-22 탭 나눔(사용자 확정): 재등록SKU → '실적저조SKU'(코드 안의 target "재등록SKU"는 이 탭), 실적저조가 아닌 재등록 → '그 외 재등록SKU',
 * 제품DB 현재상태 판매중지 → '판매중지SKU'. 세 탭에 있는 SKU와 실적저조 목록(LOW_PERFORMANCE_SKU_IDS)의 SKU는 제품DB로 가지 않는다.
 */
export const RECHECK_TAB = "창고재확인";
export const STORAGE_TAB = "비관리SKU";
/** 예전 이름 — 시트 탭 이름을 바꾸기 전에도 동작하게 함께 찾는다. */
export const LEGACY_STORAGE_TAB = "_보관_비관리SKU_20261008";
const STORAGE_LABEL = "보관" as const;

/** 시트 탭 이름 중 보관(비관리SKU) 탭을 고른다: '비관리SKU' → 예전 이름 → '비관리SKU'가 들어간 탭(백업 탭 제외) → 예전 '보관'. */
export function pickStorageTabTitle(titles: readonly string[]): string | null {
  const live = titles.filter(title => !title.startsWith("_백업_"));
  if (live.includes(STORAGE_TAB)) return STORAGE_TAB;
  if (live.includes(LEGACY_STORAGE_TAB)) return LEGACY_STORAGE_TAB;
  const loose = live.find(title => /비관리SKU/i.test(title.replace(/\s+/g, "")));
  if (loose) return loose;
  return live.includes("보관") ? "보관" : null;
}

/** 제품DB에서 보관 탭으로 옮길 현재상태 */
export function isProductDbToStorageStatus(status: unknown): boolean {
  const key = String(status ?? "").replace(/\s+/g, "");
  // 2026-10-21 사용자 요청: '단종'이 들어가면(예: 단종(중복등록) — 괄호 안은 사용자가 적어 둔 이유) 모두 보관으로. '단종해제'는 제외.
  return (key.includes("단종") && !key.includes("해제")) || key.startsWith("비관리");
}

const squash = (value: unknown) => String(value ?? "").replace(/\s+/g, "");
const find = (headers: string[], ...names: string[]) => headers.findIndex(header => names.some(name => squash(header) === squash(name)));

export type RetiredTabTarget = "재등록SKU" | "그 외 재등록SKU" | "판매중지SKU";
export interface CleanupMove { source: "창고재확인" | "보관" | "제품DB" | "재등록SKU"; rowNumber: number; skuId: string; productName: string; result: string; orderableStatus: string; target: "보관" | "제품DB" | RetiredTabTarget; mode: "append" | "clear-status" | "delete-only" | "fill"; productDbRow?: number; release: boolean; pair?: string }
export interface CleanupPlan {
  token: string;
  pending: number;
  moves: CleanupMove[];
  unknown: Array<{ rowNumber: number; skuId: string; productName: string; result: string }>;
  problems: string[];
}

function mapRow(sourceHeaders: string[], source: string[], targetHeaders: string[], overrides: Record<string, string>): string[] {
  return targetHeaders.map(header => {
    const key = squash(header);
    if (key in overrides) return overrides[key];
    const index = sourceHeaders.findIndex(value => squash(value) === key);
    return index >= 0 ? String(source[index] ?? "") : "";
  });
}

/**
 * ★절대 규칙(사용자 확정 2026-10-22): 판매중지(링크 죽음)·실적저조(판매량저조) 강제발주중단 SKU는
 * 발주가능상태·재고와 상관없이 재등록 없이는 절대 제품DB로 가지 않는다. 재고가 있으면 재등록SKU로.
 */
export const NEVER_PRODUCT_DB_PATTERN = /판매중지|실적저조|판매량저조|강제(발주)?중단/;
export function neverProductDbReason(texts: readonly unknown[], retired?: string): string {
  const hit = texts.map(text => squash(text)).find(text => NEVER_PRODUCT_DB_PATTERN.test(text));
  if (hit) return hit.match(NEVER_PRODUCT_DB_PATTERN)![0];
  return retired || "";
}

export const REREG_EXTRA_HEADERS = ["기존 현재상태", "기록일", "진행상태", "새 SKU ID", "완료일"];

/**
 * 재등록SKU 탭 정리(사용자 확정 2026-10-22)
 * - 탭에 제품DB 열이 다 없으면 먼저 '형식 맞추기'만 한다: 제품DB 열 + 재등록 열(기존 현재상태·기록일·진행상태·새 SKU ID·완료일).
 *   각 줄은 제품DB·비관리SKU에 있는 같은 SKU의 전체 정보로 채운다(없으면 있던 값 유지).
 * - 현재상태에 '단종'·'비관리'가 적힌 줄 → 단종이 재등록보다 우선, 비관리SKU로 옮긴다.
 * - 같은 제품(모델SKU가 같거나, 모델명·옵션·상품명이 같음)의 다른 SKU가 제품DB에 '정상'으로 있으면
 *   이미 재등록돼 입고 중 → 비관리SKU에 '비관리(중복등록)'으로 옮긴다. 호수·옵션이 다른 같은 모델은 상관없다.
 */
export function planReregistrationTab(reregRows: string[][], productDb: string[][], storage: string[][] | null) {
  const headers = (reregRows[0] || []).map(value => String(value ?? ""));
  const pdHeaders = (productDb[0] || []).map(value => String(value ?? ""));
  const has = (list: string[], name: string) => list.some(header => squash(header) === squash(name));
  const needsRebuild = headers.length > 0 && pdHeaders.length > 0 && pdHeaders.some(header => header && !has(headers, header));
  const skuCol = find(headers, "SKU ID", "SKUID");
  const pdSku = find(pdHeaders, "SKU ID", "SKUID");
  const stHeaders = (storage?.[0] || []).map(value => String(value ?? ""));
  const stSku = find(stHeaders, "SKU ID", "SKUID", "SKU");
  const fullBySku = new Map<string, { headers: string[]; row: string[] }>();
  if (storage && stSku >= 0) for (const row of storage.slice(1)) { const id = String(row[stSku] ?? "").trim(); if (id && !fullBySku.has(id)) fullBySku.set(id, { headers: stHeaders, row }); }
  if (pdSku >= 0) for (const row of productDb.slice(1)) { const id = String(row[pdSku] ?? "").trim(); if (id) fullBySku.set(id, { headers: pdHeaders, row }); }
  if (needsRebuild) {
    const extras = [...REREG_EXTRA_HEADERS, ...headers.filter(header => header && !has(pdHeaders, header) && !REREG_EXTRA_HEADERS.some(extra => squash(extra) === squash(header)))];
    const newHeaders = [...pdHeaders, ...extras];
    const rows: string[][] = [];
    let filled = 0;
    for (const row of reregRows.slice(1)) {
      const id = skuCol >= 0 ? String(row[skuCol] ?? "").trim() : "";
      if (!id && !row.some(cell => String(cell ?? "").trim())) continue;
      const full = id ? fullBySku.get(id) : undefined;
      if (full) filled++;
      rows.push(newHeaders.map(header => {
        const own = headers.findIndex(value => squash(value) === squash(header));
        const ownValue = own >= 0 ? String(row[own] ?? "") : "";
        if (REREG_EXTRA_HEADERS.some(extra => squash(extra) === squash(header))) return ownValue;
        const src = full ? full.headers.findIndex(value => squash(value) === squash(header)) : -1;
        const value = full && src >= 0 ? String(full.row[src] ?? "") : "";
        // 2026-10-23 사용자 지침: 재등록 목록(판매중지SKU·실적저조SKU·그 외 재등록SKU)은 사용자가 직접 고쳐 두는 새 등록용 DB라
        // 이미 적힌 값은 절대 덮어쓰지 않는다. 빈 칸만 제품DB·비관리SKU 값으로 채운다.
        return ownValue.trim() ? ownValue : value;
      }));
    }
    return { rebuild: { headers: newHeaders, rows, filled }, leaving: [] as Array<{ rowNumber: number; skuId: string; row: string[]; status: string; reason: string; pair?: string }>, returning: [] as Array<{ rowNumber: number; skuId: string; row: string[] }>, keepIds: new Set<string>(rows.map(row => String(row[find(newHeaders, "SKU ID", "SKUID")] ?? "").trim()).filter(Boolean)) };
  }
  // 같은 제품 짝 찾기: 제품DB에서 발주가능상태 '정상'인 SKU만 짝이 된다.
  const pd = { msku: find(pdHeaders, "모델SKU"), model: find(pdHeaders, "모델명/품번", "모델명"), color: find(pdHeaders, "색상"), name: find(pdHeaders, "상품명"), orderable: find(pdHeaders, "발주가능상태") };
  const key = (value: unknown) => String(value ?? "").replace(/[\s,+\-_()/]/g, "").toLowerCase();
  const active = productDb.slice(1).filter(row => pd.orderable >= 0 && String(row[pd.orderable] ?? "").trim() === "정상");
  const rr = { status: find(headers, "현재상태"), msku: find(headers, "모델SKU"), model: find(headers, "모델명/품번", "모델명"), color: find(headers, "색상"), name: find(headers, "상품명"), state: find(headers, "진행상태"), newSku: find(headers, "새 SKU ID") };
  const leaving: Array<{ rowNumber: number; skuId: string; row: string[]; status: string; reason: string; pair?: string }> = [];
  const keepIds = new Set<string>();
  // 2026-10-29: 쿠팡이 강제중단을 풀어 준 SKU — 현재상태에 '정상복귀'를 적으면 제품DB로 돌려보낸다(옛 정보 그대로).
  const returning: Array<{ rowNumber: number; skuId: string; row: string[] }> = [];
  reregRows.slice(1).forEach((row, index) => {
    const id = skuCol >= 0 ? String(row[skuCol] ?? "").trim() : "";
    if (!id) return;
    const status = rr.status >= 0 ? String(row[rr.status] ?? "").trim() : "";
    if (squash(status).includes("정상복귀")) { returning.push({ rowNumber: index + 2, skuId: id, row }); return; }
    if (isProductDbToStorageStatus(status)) { leaving.push({ rowNumber: index + 2, skuId: id, row, status, reason: status }); return; }
    const msku = rr.msku >= 0 ? key(row[rr.msku]) : "";
    const model = rr.model >= 0 ? key(row[rr.model]) : "";
    const color = rr.color >= 0 ? key(row[rr.color]) : "";
    const name = rr.name >= 0 ? key(row[rr.name]) : "";
    // 2026-10-22: 모델SKU가 같아도 옵션(1P/한쌍, 사이즈 등)이 다르면 다른 상품이다(예: 41093260 로즈골드 1P ↔ 39864522 로즈골드한쌍).
    const sameOption = (other: string[]) => !color || pd.color < 0 || !key(other[pd.color]) || key(other[pd.color]) === color;
    const pair = active.find(other => String(other[pdSku] ?? "").trim() !== id && (
      (msku && pd.msku >= 0 && key(other[pd.msku]) === msku && sameOption(other)) ||
      (model && color && name && pd.model >= 0 && pd.color >= 0 && pd.name >= 0 && key(other[pd.model]) === model && key(other[pd.color]) === color && key(other[pd.name]) === name)));
    if (pair) { const pairId = String(pair[pdSku] ?? "").trim(); leaving.push({ rowNumber: index + 2, skuId: id, row, status: "비관리(중복등록)", reason: `재등록완료(새 SKU ${pairId})`, pair: pairId }); return; }
    keepIds.add(id);
  });
  return { rebuild: undefined, leaving, returning, keepIds };
}

export function planWarehouseRecheckCleanup(recheck: string[][], productDb: string[][], storage: string[][] | null, reregisteredSkuIds: ReadonlySet<string> = new Set(), reregHeaders: readonly string[] = [], today = "", reregRows?: string[][], retiredSkuIds: ReadonlySet<string> = new Set(), extraTabs: { other?: string[][] | null; stopped?: string[][] | null } = {}): CleanupPlan & { reregRebuild?: { headers: string[]; rows: string[][]; filled: number }; deleteReregRows: number[]; appendRereg: string[][]; appendOtherRereg: string[][]; appendStopped: string[][]; appendStorage: string[][]; appendProductDb: string[][]; clearStatusRows: number[]; deleteRows: number[]; deleteStorageRows: number[]; deleteProductDbRows: number[] } {
  const token = createHash("sha256").update(JSON.stringify([recheck, storage, productDb, [...reregisteredSkuIds].sort(), reregHeaders, today, reregRows || null, [...retiredSkuIds].sort(), extraTabs.other || null, extraTabs.stopped || null])).digest("hex").slice(0, 32);
  const problems: string[] = [];
  const reregPlan = reregRows && reregRows.length ? planReregistrationTab(reregRows, productDb, storage) : null;
  const deleteReregRows: number[] = [];
  if (reregPlan?.rebuild) {
    // 1단계: 재등록SKU 탭 형식부터 맞춘다(다른 정리는 다음 실행에서). 줄 번호가 바뀌므로 한 번에 하나만.
    const rb = reregPlan.rebuild;
    const at = (name: string) => find(rb.headers, name);
    const moves: CleanupMove[] = rb.rows.map((row, index) => ({ source: "재등록SKU", rowNumber: index + 2, skuId: String(row[at("SKU ID")] ?? "").trim(), productName: String(row[at("상품명")] ?? "").trim(), result: "제품DB 열로 형식 맞추고 정보 채우기", orderableStatus: String(row[at("발주가능상태")] ?? "").trim(), target: "재등록SKU", mode: "fill", release: false }));
    return { token, pending: 0, moves, unknown: [], problems, reregRebuild: rb, deleteReregRows, appendRereg: [], appendOtherRereg: [], appendStopped: [], appendStorage: [], appendProductDb: [], clearStatusRows: [], deleteRows: [], deleteStorageRows: [], deleteProductDbRows: [] };
  }
  // 재등록SKU 탭에 남는 SKU(단종·중복으로 빠지는 줄 제외)
  reregisteredSkuIds = reregPlan ? reregPlan.keepIds : reregisteredSkuIds;
  const leavingRereg = new Map((reregPlan?.leaving || []).map(item => [item.skuId, item]));
  const headers = (recheck[0] || []).map(value => String(value ?? ""));
  const col = { result: find(headers, "창고 확인결과", "창고확인결과"), sku: find(headers, "SKU ID", "SKUID", "SKU"), name: find(headers, "상품명"), orderable: find(headers, "발주가능상태") };
  const hasRecheck = recheck.length > 1;
  if (hasRecheck && (col.result < 0 || col.sku < 0)) problems.push("창고재확인 탭에서 '창고 확인결과' 또는 'SKU ID' 열을 찾지 못했습니다.");
  const pdHeaders = (productDb[0] || []).map(value => String(value ?? ""));
  const pd = { sku: find(pdHeaders, "SKU ID", "SKUID"), status: find(pdHeaders, "현재상태"), orderable: find(pdHeaders, "발주가능상태") };
  if (pd.sku < 0 || pd.status < 0) problems.push("제품DB 탭에서 'SKU ID' 또는 '현재상태' 열을 찾지 못했습니다.");
  const stHeaders = (storage?.[0] || []).map(value => String(value ?? ""));
  const stSkuCol = find(stHeaders, "SKU ID", "SKUID", "SKU");
  const storageSkus = new Set<string>();
  if (storage && stSkuCol >= 0) storage.slice(1).forEach(row => { const sku = String(row[stSkuCol] ?? "").trim(); if (sku) storageSkus.add(sku); });
  const productDbRowBySku = new Map<string, number>();
  productDb.slice(1).forEach((row, index) => { const sku = String(row[pd.sku] ?? "").trim(); if (sku && !productDbRowBySku.has(sku)) productDbRowBySku.set(sku, index + 2); });
  const moves: CleanupMove[] = [], unknown: CleanupPlan["unknown"] = [];
  const appendStorage: string[][] = [], appendProductDb: string[][] = [], clearStatusRows: number[] = [], deleteRows: number[] = [];
  let pending = 0;
  const appendRereg: string[][] = [];
  const forcedRereg = new Set<string>(); // 판매중지·실적저조·옛 SKU라 재등록SKU로 보내는 SKU(제품DB에 있으면 제품DB에서도 지움)
  // 2026-10-22 탭 나눔: 그 외 재등록SKU·판매중지SKU 탭
  const tabIds = (rows: string[][] | null | undefined) => {
    const ids = new Set<string>();
    const col = find((rows?.[0] || []).map(value => String(value ?? "")), "SKU ID", "SKUID");
    if (rows && col >= 0) rows.slice(1).forEach(row => { const id = String(row[col] ?? "").trim(); if (id) ids.add(id); });
    return ids;
  };
  const otherHeaders = (extraTabs.other?.[0] || []).map(value => String(value ?? ""));
  const stoppedHeaders = (extraTabs.stopped?.[0] || []).map(value => String(value ?? ""));
  const otherIds = tabIds(extraTabs.other), stoppedIds = tabIds(extraTabs.stopped);
  const appendOtherRereg: string[][] = [], appendStopped: string[][] = [];
  /** 이 SKU가 이미 들어 있는 옛 SKU 탭(실적저조SKU·그 외 재등록SKU·판매중지SKU) */
  const inRetiredTab = (skuId: string): RetiredTabTarget | null => !skuId ? null
    : reregisteredSkuIds.has(skuId) ? "재등록SKU" : otherIds.has(skuId) ? "그 외 재등록SKU" : stoppedIds.has(skuId) ? "판매중지SKU" : null;
  /** 제품DB로 갈 수 없는 이유(없으면 ""). 탭에 이미 있음·실적저조 목록·판매중지/실적저조 글자·교체된 옛 SKU */
  const blockReason = (skuId: string, texts: readonly unknown[]) => {
    const tab = inRetiredTab(skuId);
    if (tab) return `${tab === "재등록SKU" ? LOW_PERFORMANCE_TAB : tab} 탭에 있음`;
    if (skuId && LOW_PERFORMANCE_SKU_IDS.has(skuId)) return "실적저조(쿠팡 영구 발주중지)";
    return neverProductDbReason(texts, skuId && retiredSkuIds.has(skuId) ? "SKU교체이력(옛 SKU)" : "");
  };
  /** 제품DB로 못 가는 SKU를 보낼 탭: 판매중지 → 판매중지SKU, 실적저조 → 실적저조SKU, 그 밖(재등록 표시·교체된 옛 SKU) → 그 외 재등록SKU */
  // 새 탭이 아직 없으면 예전처럼 실적저조SKU(재등록SKU) 탭으로 보낸다.
  const retiredTarget = (skuId: string, texts: readonly unknown[]): RetiredTabTarget => {
    const tab = inRetiredTab(skuId);
    if (tab) return tab;
    const joined = texts.map(text => squash(text)).join(" ");
    if (joined.includes("판매중지") && stoppedHeaders.length) return "판매중지SKU";
    if ((skuId && LOW_PERFORMANCE_SKU_IDS.has(skuId)) || /실적저조|판매량저조|강제(발주)?중단/.test(joined)) return "재등록SKU";
    return otherHeaders.length ? "그 외 재등록SKU" : "재등록SKU";
  };
  const retiredPlanned = { "재등록SKU": new Set<string>(), "그 외 재등록SKU": new Set<string>(), "판매중지SKU": new Set<string>() };
  /** 옛 SKU 탭에 한 줄 붙인다(이미 있으면 붙이지 않음). 붙였으면 true, 탭이 없으면 문제로 남긴다. */
  const addToRetiredTab = (target: RetiredTabTarget, skuId: string, sourceHeaders: string[], row: string[], overrides: Record<string, string>): "append" | "delete-only" | null => {
    if (inRetiredTab(skuId) === target || retiredPlanned[target].has(skuId) || (target === "재등록SKU" && forcedRereg.has(skuId))) return "delete-only";
    const headersFor = target === "재등록SKU" ? [...reregHeaders] : target === "그 외 재등록SKU" ? otherHeaders : stoppedHeaders;
    if (!headersFor.length) { problems.push(`'${target === "재등록SKU" ? LOW_PERFORMANCE_TAB : target === "그 외 재등록SKU" ? OTHER_REREGISTRATION_TAB : STOPPED_TAB}' 탭을 찾지 못했습니다.`); return null; }
    const out = mapRow(sourceHeaders, row, headersFor, overrides);
    (target === "재등록SKU" ? appendRereg : target === "그 외 재등록SKU" ? appendOtherRereg : appendStopped).push(out);
    if (skuId) { retiredPlanned[target].add(skuId); if (target === "재등록SKU") forcedRereg.add(skuId); }
    return "append";
  };
  if (!problems.length && hasRecheck) recheck.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    const result = String(row[col.result] ?? "").trim();
    const skuId = String(row[col.sku] ?? "").trim();
    const productName = col.name >= 0 ? String(row[col.name] ?? "").trim() : "";
    if (!skuId && !result) return;
    if (!result) { pending++; return; }
    const key = squash(result);
    const orderableHere = col.orderable >= 0 ? String(row[col.orderable] ?? "").trim() : "";
    if (key === "거래처단종") {
      if (!storage) { problems.push(`'${STORAGE_TAB}' 탭을 찾지 못했습니다.`); return; }
      // 보관 탭에 이미 같은 SKU가 있으면 다시 붙이지 않고 창고재확인에서만 지운다(중간에 실패한 뒤 다시 실행해도 중복되지 않게).
      const already = Boolean(skuId) && storageSkus.has(skuId);
      if (!already) { appendStorage.push(mapRow(headers, row, stHeaders, { "현재상태": "거래처단종", "원본위치": `${RECHECK_TAB}!${rowNumber}` })); if (skuId) storageSkus.add(skuId); }
      moves.push({ source: "창고재확인", rowNumber, skuId, productName, result, orderableStatus: orderableHere, target: "보관", mode: already ? "delete-only" : "append", release: false });
      deleteRows.push(rowNumber);
    } else if (key.includes("재고있음") && blockReason(skuId, [result, ...row])) {
      // 판매중지·실적저조·교체된 옛 SKU: 재고가 있어도 제품DB가 아니라 옛 SKU 탭으로.
      const why = blockReason(skuId, [result, ...row]);
      const target = retiredTarget(skuId, [result, ...row]);
      const mode = addToRetiredTab(target, skuId, headers, row, { "현재상태": result, "기존현재상태": result, "기록일": today, "진행상태": "대기" });
      if (!mode) return;
      moves.push({ source: "창고재확인", rowNumber, skuId, productName, result: `${result} · ${why} → 제품DB 못 감`, orderableStatus: orderableHere, target, mode, release: false });
      deleteRows.push(rowNumber);
    } else if (key.includes("재고있음")) {
      const existing = productDbRowBySku.get(skuId);
      const orderable = orderableHere || (existing && pd.orderable >= 0 ? String(productDb[existing - 1]?.[pd.orderable] ?? "").trim() : "");
      if (existing) clearStatusRows.push(existing);
      else appendProductDb.push(mapRow(headers, row, pdHeaders, { "현재상태": "" }));
      moves.push({ source: "창고재확인", rowNumber, skuId, productName, result, orderableStatus: orderable || "미확인", target: "제품DB", mode: existing ? "clear-status" : "append", productDbRow: existing, release: orderable !== "정상" });
      deleteRows.push(rowNumber);
    } else {
      unknown.push({ rowNumber, skuId, productName, result });
    }
  });
  // 보관 탭: 현재상태(또는 창고 확인결과)에 '재고있음'이 들어간 행(예: 재고있음, 제품DB로 이동(재고있음)) → 제품DB로(현재상태 비움), 보관 탭에서 삭제
  const deleteStorageRows: number[] = [];
  if (storage && !problems.length) {
    const st = { sku: find(stHeaders, "SKU ID", "SKUID", "SKU"), status: find(stHeaders, "현재상태"), result: find(stHeaders, "창고 확인결과", "창고확인결과"), name: find(stHeaders, "상품명"), orderable: find(stHeaders, "발주가능상태") };
    const planned = new Set(appendProductDb.map(row => String(row[pd.sku] ?? "").trim()));
    const seenStorage = new Set<string>();
    storage.slice(1).forEach((row, index) => {
      const rowNumber = index + 2;
      // 2026-10-22: 재등록SKU 탭에 이미 있는 SKU는 보관 탭에 중복으로 두지 않는다 → 보관에서 지운다.
      const storageSku = st.sku >= 0 ? String(row[st.sku] ?? "").trim() : "";
      if (storageSku && leavingRereg.has(storageSku)) {
        // 재등록SKU에서 비관리로 오는 SKU: 예전 줄은 지우고 재등록SKU의 전체 정보로 새로 붙인다(아래).
        deleteStorageRows.push(rowNumber);
        return;
      }
      const storageTab = inRetiredTab(storageSku);
      if (storageSku && storageTab) {
        moves.push({ source: "보관", rowNumber, skuId: storageSku, productName: st.name >= 0 ? String(row[st.name] ?? "").trim() : "", result: `${storageTab === "재등록SKU" ? LOW_PERFORMANCE_TAB : storageTab} 탭에 있음`, orderableStatus: st.orderable >= 0 ? String(row[st.orderable] ?? "").trim() : "", target: storageTab, mode: "delete-only", release: false });
        deleteStorageRows.push(rowNumber);
        return;
      }
      const storageName = st.name >= 0 ? String(row[st.name] ?? "").trim() : "";
      const storageOrderable = st.orderable >= 0 ? String(row[st.orderable] ?? "").trim() : "";
      // 2026-10-22 '한 SKU는 한 탭에만'(사용자 확정): 비관리SKU 안에서 같은 SKU가 또 나오면 아래 줄을 지운다.
      if (storageSku && seenStorage.has(storageSku)) {
        moves.push({ source: "보관", rowNumber, skuId: storageSku, productName: storageName, result: "같은 SKU가 위에 또 있음", orderableStatus: storageOrderable, target: "보관", mode: "delete-only", release: false });
        deleteStorageRows.push(rowNumber);
        return;
      }
      if (storageSku) seenStorage.add(storageSku);
      // 2026-10-22: 비관리SKU에서 현재상태에 '재등록'(재등록완료 제외)을 적은 줄 → 재등록SKU 탭으로(전체 정보 그대로, 진행상태 대기).
      const storageStatus = st.status >= 0 ? String(row[st.status] ?? "").trim() : "";
      if (storageSku && squash(storageStatus).includes("재등록") && !squash(storageStatus).includes("완료")) {
        // 실적저조 목록에 있으면 실적저조SKU, 아니면 그 외 재등록SKU
        const target = LOW_PERFORMANCE_SKU_IDS.has(storageSku) ? "재등록SKU" : retiredTarget(storageSku, [storageStatus]);
        const mode = addToRetiredTab(target, storageSku, stHeaders, row, { "현재상태": "", "기존현재상태": "", "기록일": today, "진행상태": "대기", "보관사유": "" });
        if (!mode) return;
        moves.push({ source: "보관", rowNumber, skuId: storageSku, productName: storageName, result: storageStatus, orderableStatus: storageOrderable, target, mode, release: false });
        deleteStorageRows.push(rowNumber);
        return;
      }
      // 2026-10-21 사용자 요청: 현재상태를 '재고있음'으로만 바꿔 둬도(글자만 들어 있으면) 제품DB로 옮긴다.
      const marked = [st.status, st.result].some(column => column >= 0 && squash(row[column]).includes("재고있음"));
      if (!marked) {
        // 2026-10-22: 제품DB에도 있는 SKU — 제품DB 현재상태가 단종·비관리·재등록이면 제품DB 쪽이 지워지고(아래), 아니면 제품DB에 두고 비관리SKU에서 지운다.
        const pdRow = storageSku ? productDbRowBySku.get(storageSku) : undefined;
        if (pdRow) {
          const pdStatus = String(productDb[pdRow - 1]?.[pd.status] ?? "").trim();
          if (!isProductDbToStorageStatus(pdStatus) && !squash(pdStatus).includes("재등록")) {
            moves.push({ source: "보관", rowNumber, skuId: storageSku, productName: storageName, result: `제품DB에 있음${pdStatus ? `(${pdStatus})` : ""}`, orderableStatus: storageOrderable, target: "제품DB", mode: "delete-only", release: false });
            deleteStorageRows.push(rowNumber);
          }
        }
        return;
      }
      const skuId = storageSku;
      const productName = st.name >= 0 ? String(row[st.name] ?? "").trim() : "";
      // ★판매중지·실적저조·교체된 옛 SKU: '재고있음'이어도 제품DB로 보내지 않고 재등록SKU로(현재상태 '재고있음'은 메모로 그대로).
      const never = blockReason(skuId, row);
      if (never) {
        const target = retiredTarget(skuId, row);
        const mode = addToRetiredTab(target, skuId, stHeaders, row, { "기존현재상태": storageStatus, "기록일": today, "진행상태": "대기" });
        if (!mode) return;
        moves.push({ source: "보관", rowNumber, skuId, productName, result: `${storageStatus || "재고있음"} · ${never} → 제품DB 못 감`, orderableStatus: storageOrderable, target, mode, release: false });
        deleteStorageRows.push(rowNumber);
        return;
      }
      const existing = productDbRowBySku.get(skuId);
      const orderableHere = st.orderable >= 0 ? String(row[st.orderable] ?? "").trim() : "";
      const orderable = orderableHere || (existing && pd.orderable >= 0 ? String(productDb[existing - 1]?.[pd.orderable] ?? "").trim() : "");
      if (existing) clearStatusRows.push(existing);
      else if (!planned.has(skuId)) { appendProductDb.push(mapRow(stHeaders, row, pdHeaders, { "현재상태": "", "창고확인결과": "" })); planned.add(skuId); }
      moves.push({ source: "보관", rowNumber, skuId, productName, result: [st.status, st.result].map(column => column >= 0 ? String(row[column] ?? "").trim() : "").find(text => squash(text).includes("재고있음")) || "재고있음", orderableStatus: orderable || "미확인", target: "제품DB", mode: existing ? "clear-status" : "append", productDbRow: existing, release: orderable !== "정상" });
      deleteStorageRows.push(rowNumber);
    });
  }
  // 재등록SKU → 비관리SKU: 단종이 적힌 줄, 같은 제품이 제품DB에 정상으로 입고 중인 줄(2026-10-22)
  if (reregPlan && !problems.length) {
    const rrHeaders = (reregRows![0] || []).map(value => String(value ?? ""));
    const stNameCol = find(stHeaders, "상품명");
    for (const item of reregPlan.leaving) {
      if (!storage) { problems.push(`'${STORAGE_TAB}' 탭을 찾지 못했습니다.`); break; }
      appendStorage.push(mapRow(rrHeaders, item.row, stHeaders, { "현재상태": item.status, "보관사유": item.reason, "원본위치": `${LOW_PERFORMANCE_TAB}!${item.rowNumber}` }));
      deleteReregRows.push(item.rowNumber);
      const name = find(rrHeaders, "상품명");
      moves.push({ source: "재등록SKU", rowNumber: item.rowNumber, skuId: item.skuId, productName: name >= 0 ? String(item.row[name] ?? "").trim() : "", result: item.pair ? `같은 제품 새 SKU ${item.pair} 정상 입고 중 → 비관리(중복등록)` : `현재상태 ${item.status} → 단종이 재등록보다 우선`, orderableStatus: "", target: "보관", mode: "append", release: false, pair: item.pair });
      void stNameCol;
    }
  }
  // 2026-10-29 실적저조SKU 탭 현재상태 '정상복귀' → 제품DB로(쿠팡이 강제중단을 풀어 줌). 옛 정보는 그대로 가져가고 현재상태만 '정상'.
  if (reregPlan?.returning.length && !problems.length) {
    const rrHeaders = (reregRows![0] || []).map(value => String(value ?? ""));
    const rrName = find(rrHeaders, "상품명"), rrOrderable = find(rrHeaders, "발주가능상태");
    const plannedProductDb = new Set(appendProductDb.map(row => String(row[pd.sku] ?? "").trim()));
    for (const item of reregPlan.returning) {
      const existing = productDbRowBySku.get(item.skuId);
      if (!existing && !plannedProductDb.has(item.skuId)) {
        appendProductDb.push(mapRow(rrHeaders, item.row, pdHeaders, { "현재상태": "정상", "창고확인결과": "" }));
        plannedProductDb.add(item.skuId);
      }
      deleteReregRows.push(item.rowNumber);
      const orderable = rrOrderable >= 0 ? String(item.row[rrOrderable] ?? "").trim() : "";
      moves.push({ source: "재등록SKU", rowNumber: item.rowNumber, skuId: item.skuId, productName: rrName >= 0 ? String(item.row[rrName] ?? "").trim() : "", result: "정상복귀 → 쿠팡이 강제중단을 풀어 제품DB로", orderableStatus: orderable || "미확인", target: "제품DB", mode: existing ? "delete-only" : "append", productDbRow: existing, release: Boolean(orderable) && orderable !== "정상" });
    }
  }
  // 2026-10-23 사용자 확정: 제품DB에는 정상 입고될 수 있는 SKU만 둔다. 한 옵션이라도 판매중지(링크 죽음)면
  // 같은 노출상품ID(제품링크 번호)를 쓰는 옵션은 전부 판매중지다 → 제품DB·실적저조SKU에 남은 같은 링크 옵션도 판매중지SKU로.
  const productIdOf = (headers: string[], row: string[]) => {
    const link = find(headers, "제품링크"), idCol = find(headers, "노출상품ID");
    return String(link >= 0 ? row[link] ?? "" : "").match(/\/products\/(\d+)/)?.[1] || (idCol >= 0 ? String(row[idCol] ?? "").replace(/\D/g, "") : "");
  };
  const deadIds = new Set<string>();
  if (stoppedHeaders.length) {
    const collect = (rows: string[][] | null | undefined, all: boolean) => {
      const headers = (rows?.[0] || []).map(value => String(value ?? ""));
      const statusCol = find(headers, "현재상태");
      for (const row of rows?.slice(1) || []) {
        if (!all && !(statusCol >= 0 && squash(row[statusCol]).includes("판매중지"))) continue;
        const id = productIdOf(headers, row);
        if (id) deadIds.add(id);
      }
    };
    collect(extraTabs.stopped, true);
    collect(productDb, false);
    collect(reregRows, false);
    collect(extraTabs.other, false);
  }
  const deadLinkStatus = (status: string) => squash(status).includes("판매중지") ? status : status ? `판매중지(${status})` : "판매중지";
  // 실적저조SKU 탭: 판매중지이거나 판매중지 링크와 같은 링크인 줄 → 판매중지SKU(링크가 죽어 판매중지가 우선)
  if (reregRows && reregPlan && !reregPlan.rebuild && stoppedHeaders.length && !problems.length) {
    const rrHeaders = (reregRows[0] || []).map(value => String(value ?? ""));
    const rr = { sku: find(rrHeaders, "SKU ID", "SKUID"), status: find(rrHeaders, "현재상태"), name: find(rrHeaders, "상품명"), orderable: find(rrHeaders, "발주가능상태") };
    const leavingRows = new Set(deleteReregRows);
    reregRows.slice(1).forEach((row, index) => {
      const rowNumber = index + 2;
      const skuId = rr.sku >= 0 ? String(row[rr.sku] ?? "").trim() : "";
      if (!skuId || leavingRows.has(rowNumber)) return;
      const status = rr.status >= 0 ? String(row[rr.status] ?? "").trim() : "";
      const id = productIdOf(rrHeaders, row);
      if (!squash(status).includes("판매중지") && !(id && deadIds.has(id))) return;
      if (!stoppedIds.has(skuId) && !retiredPlanned["판매중지SKU"].has(skuId)) {
        appendStopped.push(mapRow(rrHeaders, row, stoppedHeaders, { "현재상태": deadLinkStatus(status) }));
        retiredPlanned["판매중지SKU"].add(skuId);
      }
      deleteReregRows.push(rowNumber);
      reregisteredSkuIds = new Set([...reregisteredSkuIds].filter(other => other !== skuId));
      stoppedIds.add(skuId);
      moves.push({ source: "재등록SKU", rowNumber, skuId, productName: rr.name >= 0 ? String(row[rr.name] ?? "").trim() : "", result: squash(status).includes("판매중지") ? `${status} → 판매중지가 실적저조보다 우선` : `판매중지 옵션과 같은 링크(${id}) → 판매중지`, orderableStatus: rr.orderable >= 0 ? String(row[rr.orderable] ?? "").trim() : "", target: "판매중지SKU", mode: "append", release: false });
    });
  }
  // 제품DB: 현재상태 비관리(중복등록)·'단종'이 들어간 모든 상태(거래처단종·단종(중복등록) 등) → 보관 탭, 제품DB에서 지움
  const deleteProductDbRows: number[] = [];
  if (!problems.length && pd.status >= 0) {
    const stSku = find(stHeaders, "SKU ID", "SKUID", "SKU");
    const inStorage = new Set<string>();
    const leavingStorage = new Set(deleteStorageRows);
    if (storage && stSku >= 0) storage.slice(1).forEach((row, index) => { if (!leavingStorage.has(index + 2)) inStorage.add(String(row[stSku] ?? "").trim()); });
    appendStorage.forEach(row => { if (stSku >= 0) inStorage.add(String(row[stSku] ?? "").trim()); });
    const keep = new Set(clearStatusRows);
    const pdName = find(pdHeaders, "상품명");
    const reregPlanned = new Set<string>();
    productDb.slice(1).forEach((row, index) => {
      const rowNumber = index + 2;
      const status = String(row[pd.status] ?? "").trim();
      const skuId = String(row[pd.sku] ?? "").trim();
      // 2026-10-23: 재등록·신규 등록 진행 중인 줄(등록파일생성·승인대기·재등록시도)은 승인 전까지 옛 SKU 정보를 그대로 갖고 있다.
      // 옛 SKU가 실적저조·판매중지 목록에 있어도 다시 재등록 목록으로 보내지 않고 제품DB에 둔다.
      if (/등록파일생성|승인대기|재등록시도/.test(squash(status))) return;
      if (skuId && leavingRereg.has(skuId) && !keep.has(rowNumber)) {
        moves.push({ source: "제품DB", rowNumber, skuId, productName: pdName >= 0 ? String(row[pdName] ?? "").trim() : "", result: "재등록SKU에서 비관리SKU로 옮기는 SKU", orderableStatus: pd.orderable >= 0 ? String(row[pd.orderable] ?? "").trim() : "", target: STORAGE_LABEL, mode: "delete-only", release: false });
        deleteProductDbRows.push(rowNumber);
        return;
      }
      // '재등록파일생성'·'재등록완료'·승인대기는 재등록이 진행 중이거나 끝난 새 줄이라 제품DB에 둔다.
      const markedRereg = squash(status).includes("재등록") && !/재등록파일생성|재등록완료|승인대기/.test(squash(status));
      // 2026-10-22: 판매중지 → 판매중지SKU 탭. 실적저조 목록·옛 SKU 탭에 있는 SKU도 제품DB에 두지 않는다.
      // 판매중지SKU 탭이 아직 없으면 판매중지 줄은 예전처럼 제품DB에 둔다.
      const pdLinkId = productIdOf(pdHeaders, row);
      const deadLink = stoppedHeaders.length > 0 && Boolean(pdLinkId) && deadIds.has(pdLinkId) && !/재등록파일생성|승인대기/.test(squash(status));
      const markedStopped = (squash(status).includes("판매중지") && stoppedHeaders.length > 0) || deadLink;
      const retired = Boolean(skuId) && (Boolean(inRetiredTab(skuId)) || LOW_PERFORMANCE_SKU_IDS.has(skuId) || forcedRereg.has(skuId) || retiredPlanned["그 외 재등록SKU"].has(skuId) || retiredPlanned["판매중지SKU"].has(skuId));
      if ((retired || markedRereg || markedStopped) && !keep.has(rowNumber)) {
        const target = markedStopped && !inRetiredTab(skuId) ? "판매중지SKU" : retiredTarget(skuId, [status]);
        const mode = addToRetiredTab(target, skuId, pdHeaders, row, target === "판매중지SKU" ? (deadLink ? { "현재상태": deadLinkStatus(status) } : {}) : { "기존현재상태": status, "기록일": today, "진행상태": "대기" });
        if (!mode) return;
        reregPlanned.add(skuId);
        moves.push({ source: "제품DB", rowNumber, skuId, productName: pdName >= 0 ? String(row[pdName] ?? "").trim() : "", result: deadLink && !squash(status).includes("판매중지") ? `판매중지 옵션과 같은 링크(${pdLinkId})${status ? ` · ${status}` : ""} → 판매중지` : status || `${target === "재등록SKU" ? LOW_PERFORMANCE_TAB : target} 탭에 있음`, orderableStatus: pd.orderable >= 0 ? String(row[pd.orderable] ?? "").trim() : "", target, mode, release: false });
        deleteProductDbRows.push(rowNumber);
        return;
      }
      if (!isProductDbToStorageStatus(status) || keep.has(rowNumber)) return;
      if (!storage) { problems.push(`'${STORAGE_TAB}' 탭을 찾지 못했습니다.`); return; }
      const reason = status;
      const already = Boolean(skuId) && inStorage.has(skuId);
      // 현재상태(이유 포함)는 그대로 옮기고, 보관사유 칸이 있으면 그 글을 함께 남긴다.
      if (!already) { appendStorage.push(mapRow(pdHeaders, row, stHeaders, { "보관사유": reason, "원본위치": `제품DB!${rowNumber}` })); if (skuId) inStorage.add(skuId); }
      moves.push({ source: "제품DB", rowNumber, skuId, productName: pdName >= 0 ? String(row[pdName] ?? "").trim() : "", result: reason, orderableStatus: pd.orderable >= 0 ? String(row[pd.orderable] ?? "").trim() : "", target: STORAGE_LABEL, mode: already ? "delete-only" : "append", release: false });
      deleteProductDbRows.push(rowNumber);
    });
  }
  return { token, pending, moves, unknown, problems: [...new Set(problems)], deleteReregRows, appendRereg, appendOtherRereg, appendStopped, appendStorage, appendProductDb, clearStatusRows: [...new Set(clearStatusRows)], deleteRows, deleteStorageRows, deleteProductDbRows };
}
