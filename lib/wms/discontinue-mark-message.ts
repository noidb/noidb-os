/** 단종서류 만든 뒤 제품DB 현재상태 입력 결과(화면·서버 공용, 시트 코드 없음) */
export type DiscontinueMarkResult = { marked: number; kept: { skuId: string; status: string }[]; notInDb: number; warning?: string };

/** 화면 안내 문구 */
export function discontinueMarkMessage(result: DiscontinueMarkResult | undefined): string {
  if (!result) return "";
  if (result.warning) return ` ${result.warning}`;
  const parts = [`현재상태 거래처단종 ${result.marked}건 입력(제품DB·비관리SKU·재등록SKU)`];
  if (result.kept.length) parts.push(`판매중지·가품중단 ${result.kept.length}건은 그대로 둠`);
  if (result.notInDb) parts.push(`어느 탭에도 없는 SKU ${result.notInDb}건`);
  return ` ${parts.join(" · ")}.`;
}
