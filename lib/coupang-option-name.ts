/** 신규 쿠팡 색상옵션명: 옵션별 모델SKU를 앞에 두고 고객용 옵션명은 그대로 보존한다. */
export function formatCoupangOptionName(modelSku: string, optionName: string): string {
  const normalizedModelSku = modelSku.trim();
  const preservedOptionName = optionName.trim();
  if (!normalizedModelSku) return preservedOptionName;
  if (!preservedOptionName) return normalizedModelSku;
  return `${normalizedModelSku} | ${preservedOptionName}`;
}

/** `모델SKU | 실제옵션명`의 명시적 구분자 앞부분만 모델SKU 후보로 반환한다. */
export function extractModelSkuFromCoupangOptionName(value: string): string {
  const separatorIndex = value.indexOf("|");
  if (separatorIndex < 0) return "";
  return value.slice(0, separatorIndex).trim();
}

/** 구형 `실제옵션명 모델SKU`가 특정 모델SKU로 정확히 끝나는지 확인한다. */
export function hasLegacyModelSkuSuffix(value: string, modelSku: string): boolean {
  const normalizedValue = value.trim().toLocaleLowerCase();
  const normalizedModelSku = modelSku.trim().toLocaleLowerCase();
  if (!normalizedValue || !normalizedModelSku || normalizedValue === normalizedModelSku) return false;
  const start = normalizedValue.length - normalizedModelSku.length;
  return start > 0
    && normalizedValue.slice(start) === normalizedModelSku
    && /\s/u.test(normalizedValue[start - 1]);
}

export interface CoupangSupplyMatchCandidate {
  explicitModelSku?: string;
  optionName?: string;
  productName?: string;
  skuId?: string;
}

/** 상품공급상태 행의 모델SKU 매칭 우선순위. 0은 명시 형식으로 매칭되지 않음을 뜻한다. */
export function coupangSupplyMatchPriority(
  candidate: CoupangSupplyMatchCandidate,
  modelSku: string,
  currentSkuId = ""
): 0 | 1 | 2 | 3 | 4 {
  const normalizedModelSku = modelSku.trim().toLocaleLowerCase();
  if (!normalizedModelSku) return 0;
  if (candidate.explicitModelSku?.trim().toLocaleLowerCase() === normalizedModelSku) return 1;
  const optionSources = [candidate.optionName || "", candidate.productName || ""];
  if (optionSources.some(value => extractModelSkuFromCoupangOptionName(value).toLocaleLowerCase() === normalizedModelSku)) return 2;
  if (optionSources.some(value => hasLegacyModelSkuSuffix(value, modelSku))) return 3;
  if (currentSkuId && candidate.skuId?.trim().toLocaleLowerCase() === currentSkuId.trim().toLocaleLowerCase()) return 4;
  return 0;
}
