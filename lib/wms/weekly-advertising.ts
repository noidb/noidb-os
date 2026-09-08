import { createHash } from "node:crypto";
import type { WeeklyRun } from "./weekly-work-types";
import { weeklySelectedCoupons } from "./weekly-work-state";

export interface VerifiedWeeklyAdvertisingOption { skuId: string; optionId: string; productUrl: string; verifiedAt: string }
export interface WeeklyAdvertisingSelection {
  resolved: Array<{ skuId: string; optionId: string }>;
  missingSkuIds: string[];
  conflictingSkuIds: string[];
  optionIds: string[];
  token: string;
}
const clean = (value: unknown) => String(value ?? "").trim();
const identifier = (value: unknown) => /^[1-9]\d{0,19}$/.test(clean(value)) ? clean(value) : "";
const header = (value: unknown) => clean(value).replace(/\s/g, "").toLowerCase();
function linkOptions(value: unknown): string[] {
  const text = clean(value).replace(/&amp;/g, "&");
  const address = text.match(/https?:\/\/[^"'\s,)]+/i)?.[0];
  if (!address) return [];
  try {
    const url = new URL(address);
    if (!["coupang.com", "www.coupang.com", "m.coupang.com"].includes(url.hostname.toLowerCase())) return [];
    return url.searchParams.getAll("vendorItemId").map(clean);
  } catch { return []; }
}
function mappingToken(resolved: WeeklyAdvertisingSelection["resolved"], missingSkuIds: string[], conflictingSkuIds: string[]): string {
  return createHash("sha256").update(JSON.stringify(["weekly-advertising-v1", resolved, missingSkuIds, conflictingSkuIds])).digest("hex");
}
/** Match only the supplier SKU, never the displayed product ID or a similar name. */
export function resolveWeeklyAdvertising(skuIds: string[], rawRows: string[][], verified: VerifiedWeeklyAdvertisingOption[] = []): WeeklyAdvertisingSelection {
  if (skuIds.some(skuId => !identifier(skuId)) || new Set(skuIds).size !== skuIds.length) throw new Error("쿠폰 SKU 목록을 확인한 뒤 다시 준비해 주세요.");
  const headings = (rawRows[0] || []).map(header);
  const skuColumns = headings.flatMap((name,index) => name === "skuid" ? [index] : []);
  if (skuIds.length && skuColumns.length !== 1) throw new Error("제품DB의 SKU ID 열을 확인할 수 없습니다. 제품DB 연결을 확인해 주세요.");
  const optionColumns = headings.flatMap((name,index) => ["옵션id", "vendoritemid"].includes(name) ? [index] : []);
  const linkColumns = headings.flatMap((name,index) => ["제품링크", "상품링크", "쿠팡url", "url", "링크"].includes(name) ? [index] : []);
  const wanted = new Set(skuIds);
  const candidates = new Map<string, Set<string>>();
  const invalid = new Set<string>();
  for (const row of rawRows.slice(1)) {
    const skuId = identifier(row[skuColumns[0]]);
    if (!wanted.has(skuId)) continue;
    const ids = candidates.get(skuId) || new Set<string>();
    for (const value of [...optionColumns.map(index => clean(row[index])).filter(Boolean), ...linkColumns.flatMap(index => linkOptions(row[index]))]) {
      const id = identifier(value);
      if (id) ids.add(id); else invalid.add(skuId);
    }
    candidates.set(skuId, ids);
  }
  const resolved: WeeklyAdvertisingSelection["resolved"] = [], missingSkuIds: string[] = [], conflictingSkuIds: string[] = [];
  for (const skuId of skuIds) {
    const ids = candidates.get(skuId) || new Set<string>();
    // Verified browser lookups fill absence only. They never arbitrate DB conflicts.
    if (!ids.size && !invalid.has(skuId)) for (const value of verified.filter(item => item.skuId === skuId)) {
      const urlIds = linkOptions(value.productUrl);
      if (!identifier(value.optionId) || !Number.isFinite(Date.parse(value.verifiedAt)) || !urlIds.length || urlIds.some(id => id !== value.optionId)) invalid.add(skuId);
      else ids.add(value.optionId);
    }
    if (invalid.has(skuId) || ids.size > 1) conflictingSkuIds.push(skuId);
    else if (!ids.size) missingSkuIds.push(skuId);
    else resolved.push({ skuId, optionId: [...ids][0] });
  }
  return { resolved, missingSkuIds, conflictingSkuIds, optionIds: [...new Set(resolved.map(item => item.optionId))], token: mappingToken(resolved, missingSkuIds, conflictingSkuIds) };
}
export function assertWeeklyAdvertisingSelection(run: WeeklyRun, selection?: WeeklyAdvertisingSelection): asserts selection is WeeklyAdvertisingSelection {
  const skuIds = weeklySelectedCoupons(run).map(item => item.skuId);
  if (!selection) throw new Error("광고 옵션 ID 연결을 먼저 확인해 주세요. 쿠폰 파일만 별도로 받을 수도 있습니다.");
  if (selection.missingSkuIds.length || selection.conflictingSkuIds.length) throw new Error(`광고 옵션 ID 확인이 필요합니다. 미연결 ${selection.missingSkuIds.length}개 · 충돌 ${selection.conflictingSkuIds.length}개. 쿠폰 파일만 별도로 받을 수 있습니다.`);
  if (JSON.stringify(selection.resolved.map(item => item.skuId)) !== JSON.stringify(skuIds)
    || selection.resolved.some(item => !identifier(item.optionId))
    || JSON.stringify(selection.optionIds) !== JSON.stringify([...new Set(selection.resolved.map(item => item.optionId))])
    || selection.token !== mappingToken(selection.resolved, [], [])) throw new Error("최종 쿠폰 SKU와 광고 옵션 ID 연결이 변경됐습니다. 연결을 다시 확인해 주세요.");
}
