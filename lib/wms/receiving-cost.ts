/** 거래처 입고단가(부가세 별도)를 제품DB 정수 원가 규칙에 맞춰 계산한다. */
export function calculateReceivingCost(unitPriceExVatValue: number): {
  unitPriceExVat: number;
  vat: number;
  costVatIncluded: number;
} {
  const unitPriceExVat = Math.max(0, Math.round(Number(unitPriceExVatValue) || 0));
  const vat = Math.round(unitPriceExVat * 0.1);
  return { unitPriceExVat, vat, costVatIncluded: unitPriceExVat + vat };
}
