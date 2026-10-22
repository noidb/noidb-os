import { createHash } from "node:crypto";

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

export interface CleanupMove { source: "창고재확인" | "보관" | "제품DB" | "재등록SKU"; rowNumber: number; skuId: string; productName: string; result: string; orderableStatus: string; target: "보관" | "제품DB" | "재등록SKU"; mode: "append" | "clear-status" | "delete-only" | "fill"; productDbRow?: number; release: boolean; pair?: string }
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
        return value || ownValue;
      }));
    }
    return { rebuild: { headers: newHeaders, rows, filled }, leaving: [] as Array<{ rowNumber: number; skuId: string; row: string[]; status: string; reason: string; pair?: string }>, keepIds: new Set<string>(rows.map(row => String(row[find(newHeaders, "SKU ID", "SKUID")] ?? "").trim()).filter(Boolean)) };
  }
  // 같은 제품 짝 찾기: 제품DB에서 발주가능상태 '정상'인 SKU만 짝이 된다.
  const pd = { msku: find(pdHeaders, "모델SKU"), model: find(pdHeaders, "모델명/품번", "모델명"), color: find(pdHeaders, "색상"), name: find(pdHeaders, "상품명"), orderable: find(pdHeaders, "발주가능상태") };
  const key = (value: unknown) => String(value ?? "").replace(/[\s,+\-_()/]/g, "").toLowerCase();
  const active = productDb.slice(1).filter(row => pd.orderable >= 0 && String(row[pd.orderable] ?? "").trim() === "정상");
  const rr = { status: find(headers, "현재상태"), msku: find(headers, "모델SKU"), model: find(headers, "모델명/품번", "모델명"), color: find(headers, "색상"), name: find(headers, "상품명"), state: find(headers, "진행상태"), newSku: find(headers, "새 SKU ID") };
  const leaving: Array<{ rowNumber: number; skuId: string; row: string[]; status: string; reason: string; pair?: string }> = [];
  const keepIds = new Set<string>();
  reregRows.slice(1).forEach((row, index) => {
    const id = skuCol >= 0 ? String(row[skuCol] ?? "").trim() : "";
    if (!id) return;
    const status = rr.status >= 0 ? String(row[rr.status] ?? "").trim() : "";
    if (isProductDbToStorageStatus(status)) { leaving.push({ rowNumber: index + 2, skuId: id, row, status, reason: status }); return; }
    const msku = rr.msku >= 0 ? key(row[rr.msku]) : "";
    const model = rr.model >= 0 ? key(row[rr.model]) : "";
    const color = rr.color >= 0 ? key(row[rr.color]) : "";
    const name = rr.name >= 0 ? key(row[rr.name]) : "";
    const pair = active.find(other => String(other[pdSku] ?? "").trim() !== id && (
      (msku && pd.msku >= 0 && key(other[pd.msku]) === msku) ||
      (model && color && name && pd.model >= 0 && pd.color >= 0 && pd.name >= 0 && key(other[pd.model]) === model && key(other[pd.color]) === color && key(other[pd.name]) === name)));
    if (pair) { const pairId = String(pair[pdSku] ?? "").trim(); leaving.push({ rowNumber: index + 2, skuId: id, row, status: "비관리(중복등록)", reason: `재등록완료(새 SKU ${pairId})`, pair: pairId }); return; }
    keepIds.add(id);
  });
  return { rebuild: undefined, leaving, keepIds };
}

export function planWarehouseRecheckCleanup(recheck: string[][], productDb: string[][], storage: string[][] | null, reregisteredSkuIds: ReadonlySet<string> = new Set(), reregHeaders: readonly string[] = [], today = "", reregRows?: string[][]): CleanupPlan & { reregRebuild?: { headers: string[]; rows: string[][]; filled: number }; deleteReregRows: number[]; appendRereg: string[][]; appendStorage: string[][]; appendProductDb: string[][]; clearStatusRows: number[]; deleteRows: number[]; deleteStorageRows: number[]; deleteProductDbRows: number[] } {
  const token = createHash("sha256").update(JSON.stringify([recheck, storage, productDb, [...reregisteredSkuIds].sort(), reregHeaders, today, reregRows || null])).digest("hex").slice(0, 32);
  const problems: string[] = [];
  const reregPlan = reregRows && reregRows.length ? planReregistrationTab(reregRows, productDb, storage) : null;
  const deleteReregRows: number[] = [];
  if (reregPlan?.rebuild) {
    // 1단계: 재등록SKU 탭 형식부터 맞춘다(다른 정리는 다음 실행에서). 줄 번호가 바뀌므로 한 번에 하나만.
    const rb = reregPlan.rebuild;
    const at = (name: string) => find(rb.headers, name);
    const moves: CleanupMove[] = rb.rows.map((row, index) => ({ source: "재등록SKU", rowNumber: index + 2, skuId: String(row[at("SKU ID")] ?? "").trim(), productName: String(row[at("상품명")] ?? "").trim(), result: "제품DB 열로 형식 맞추고 정보 채우기", orderableStatus: String(row[at("발주가능상태")] ?? "").trim(), target: "재등록SKU", mode: "fill", release: false }));
    return { token, pending: 0, moves, unknown: [], problems, reregRebuild: rb, deleteReregRows, appendRereg: [], appendStorage: [], appendProductDb: [], clearStatusRows: [], deleteRows: [], deleteStorageRows: [], deleteProductDbRows: [] };
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
      if (!already) { appendStorage.push(mapRow(headers, row, stHeaders, { "현재상태": "거래처단종" })); if (skuId) storageSkus.add(skuId); }
      moves.push({ source: "창고재확인", rowNumber, skuId, productName, result, orderableStatus: orderableHere, target: "보관", mode: already ? "delete-only" : "append", release: false });
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
      if (storageSku && reregisteredSkuIds.has(storageSku)) {
        moves.push({ source: "보관", rowNumber, skuId: storageSku, productName: st.name >= 0 ? String(row[st.name] ?? "").trim() : "", result: "재등록SKU 탭에 있음", orderableStatus: st.orderable >= 0 ? String(row[st.orderable] ?? "").trim() : "", target: "재등록SKU", mode: "delete-only", release: false });
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
      appendStorage.push(mapRow(rrHeaders, item.row, stHeaders, { "현재상태": item.status, "보관사유": item.reason }));
      deleteReregRows.push(item.rowNumber);
      const name = find(rrHeaders, "상품명");
      moves.push({ source: "재등록SKU", rowNumber: item.rowNumber, skuId: item.skuId, productName: name >= 0 ? String(item.row[name] ?? "").trim() : "", result: item.pair ? `같은 제품 새 SKU ${item.pair} 정상 입고 중 → 비관리(중복등록)` : `현재상태 ${item.status} → 단종이 재등록보다 우선`, orderableStatus: "", target: "보관", mode: "append", release: false, pair: item.pair });
      void stNameCol;
    }
  }
  // 제품DB: 현재상태 비관리(중복등록)·'단종'이 들어간 모든 상태(거래처단종·단종(중복등록) 등) → 보관 탭, 제품DB에서 지움
  const deleteProductDbRows: number[] = [];
  const appendRereg: string[][] = [];
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
      if (skuId && leavingRereg.has(skuId) && !keep.has(rowNumber)) {
        moves.push({ source: "제품DB", rowNumber, skuId, productName: pdName >= 0 ? String(row[pdName] ?? "").trim() : "", result: "재등록SKU에서 비관리SKU로 옮기는 SKU", orderableStatus: pd.orderable >= 0 ? String(row[pd.orderable] ?? "").trim() : "", target: STORAGE_LABEL, mode: "delete-only", release: false });
        deleteProductDbRows.push(rowNumber);
        return;
      }
      const markedRereg = squash(status).includes("재등록");
      const reregistered = Boolean(skuId) && (reregisteredSkuIds.has(skuId) || markedRereg);
      if (reregistered && !keep.has(rowNumber)) {
        // 재등록 대상 → 재등록SKU 탭(보관 탭이 아님). 이미 탭에 있으면 제품DB에서만 지운다.
        const already = reregisteredSkuIds.has(skuId) || reregPlanned.has(skuId);
        if (!already) {
          if (!reregHeaders.length) { problems.push("'재등록SKU' 탭을 찾지 못했습니다."); return; }
          appendRereg.push(mapRow(pdHeaders, row, [...reregHeaders], { "기존현재상태": status, "기록일": today, "진행상태": "대기" }));
          reregPlanned.add(skuId);
        }
        moves.push({ source: "제품DB", rowNumber, skuId, productName: pdName >= 0 ? String(row[pdName] ?? "").trim() : "", result: status || "재등록SKU 탭에 있음", orderableStatus: pd.orderable >= 0 ? String(row[pd.orderable] ?? "").trim() : "", target: "재등록SKU", mode: already ? "delete-only" : "append", release: false });
        deleteProductDbRows.push(rowNumber);
        return;
      }
      if (!isProductDbToStorageStatus(status) || keep.has(rowNumber)) return;
      if (!storage) { problems.push(`'${STORAGE_TAB}' 탭을 찾지 못했습니다.`); return; }
      const reason = status;
      const already = Boolean(skuId) && inStorage.has(skuId);
      // 현재상태(이유 포함)는 그대로 옮기고, 보관사유 칸이 있으면 그 글을 함께 남긴다.
      if (!already) { appendStorage.push(mapRow(pdHeaders, row, stHeaders, { "보관사유": reason })); if (skuId) inStorage.add(skuId); }
      moves.push({ source: "제품DB", rowNumber, skuId, productName: pdName >= 0 ? String(row[pdName] ?? "").trim() : "", result: reason, orderableStatus: pd.orderable >= 0 ? String(row[pd.orderable] ?? "").trim() : "", target: STORAGE_LABEL, mode: already ? "delete-only" : "append", release: false });
      deleteProductDbRows.push(rowNumber);
    });
  }
  return { token, pending, moves, unknown, problems: [...new Set(problems)], deleteReregRows, appendRereg, appendStorage, appendProductDb, clearStatusRows: [...new Set(clearStatusRows)], deleteRows, deleteStorageRows, deleteProductDbRows };
}
