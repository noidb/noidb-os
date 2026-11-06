/**
 * 2026-11-06 입고결과 '미납 SKU 리스트' 정리 규칙.
 * - 이미 처리한 줄(재발주요청 제외·거래처발주·기존 발주 처리·단종으로 보냄)은 기본 목록에서 빼고 접힌 칸으로 모은다.
 * - 제품DB에 '단종'으로 적힌 SKU는 제외 대신 단종으로 넘기는 버튼을 보여 준다.
 */

/** 처리가 끝난 줄인가. 단종해제 승인 대기 줄은 정상으로 바뀌는지 지켜봐야 해서 계속 보여 준다. */
export function isHandledMissStatus(status: string, releasePending: boolean): boolean {
  if (releasePending) return false;
  return status === "재발주요청 제외함" || status === "기존 거래처 발주로 처리" || status.endsWith("(으)로 보냄");
}

/**
 * 단종 SKU에 보여 줄 버튼.
 * - send: 발주가능상태가 아직 정상 → 단종신청이 필요하니 '단종'으로 보낸다(단종 대상 목록 → 신청 엑셀·공문)
 * - confirm: 이미 정상이 아님 → 신청할 것이 없으니 '단종확인'으로 목록에서만 뺀다
 * - null: 제품DB에 단종 표시가 없는 SKU
 */
export function discontinueActionFor(badges: string[] | undefined, orderStatus: string): "send" | "confirm" | null {
  if (!(badges || []).includes("단종")) return null;
  return orderStatus === "정상" ? "send" : "confirm";
}
