import { fetchSheetRows } from "./google-sheets";

/** 재등록 시 교체된 SKU는 WIMS와 상품공급상태 어느 경로에서도 다시 연결하지 않는다. */
export function skuRetirementKey(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function headerIndex(headers: string[], candidates: string[]): number {
  const key = (value: unknown) => skuRetirementKey(value).replace(/[\s_-]+/g, "");
  return headers.findIndex(header => candidates.some(candidate => key(header) === key(candidate)));
}

export function collectRetiredSkuIds(historyRows: string[][]): Set<string> {
  if (historyRows.length === 0) return new Set();
  const headers = historyRows[0] || [];
  const statusIndex = headerIndex(headers, ["처리상태"]);
  const skuIndex = headerIndex(headers, ["이전 SKU ID"]);
  if (statusIndex < 0 || skuIndex < 0) throw new Error("SKU교체이력의 처리상태·이전 SKU ID 열을 확인하지 못해 승인 연결을 중단했습니다.");
  const retired = new Set<string>();
  for (const row of historyRows.slice(1)) {
    if (!["동일모델재등록", "재등록중복정리"].includes(String(row[statusIndex] ?? "").trim())) continue;
    const skuId = skuRetirementKey(row[skuIndex]);
    if (skuId) retired.add(skuId);
  }
  return retired;
}

export async function fetchSkuReplacementHistory(productRows: string[][]): Promise<string[][]> {
  const statusIndex = headerIndex(productRows[0] || [], ["현재상태", "상태"]);
  const requiresHistory = productRows.slice(1).some(row => String(row[statusIndex] ?? "").trim() === "재등록파일생성");
  let rows: string[][];
  try {
    rows = await fetchSheetRows("_SKU교체이력", { valueRenderOption: "FORMULA" });
  } catch (error) {
    // 재등록 기능 도입 전부터 존재한 승인대기 상품은 이력 탭 자체가 없을 수 있다.
    if (!requiresHistory && error instanceof Error && /Unable to parse range|시트.*찾지|not found/i.test(error.message)) return [];
    throw new Error("재등록 이전 SKU 이력을 확인하지 못했습니다. 과거 승인 결과를 연결하지 않도록 반영을 중단했습니다.");
  }
  collectRetiredSkuIds(rows); // 존재하는 이력 탭의 잘못된 헤더는 빈 이력으로 취급하지 않는다.
  const historyStatusIndex = headerIndex(rows[0] || [], ["처리상태"]);
  const hasRegistrationHistory = rows.slice(1).some(row => ["동일모델재등록", "재등록중복정리"].includes(String(row[historyStatusIndex] ?? "").trim()));
  if (requiresHistory && !hasRegistrationHistory) throw new Error("재등록파일생성 상품의 필수 SKU교체이력이 비어 있어 승인 연결을 중단했습니다.");
  return rows;
}
