/**
 * 현재고 조회 인터페이스. 이번 스프린트에 연동한 실제 발주 데이터(서플라이어 허브)에는 재고 수량이
 * 없다(발주수량만 있음) — 그래서 지금은 항상 "미확인"을 반환하는 구현체만 쓴다.
 *
 * 화면은 이 인터페이스로만 재고를 조회하므로, 나중에 Google Sheets 재고관리 또는 NOID-B 재고DB가
 * 연결되면 새 구현체(예: GoogleSheetsStockLevelProvider)를 만들어 Provider만 교체하면 되고,
 * 화면 컴포넌트나 PickingWaveItem 타입은 수정할 필요가 없다. 현재고 칸 자체는 항상 존재해야 하며
 * (삭제 금지), status가 "unavailable"일 때 화면은 회색 글자로 "미확인 · 재고 연동 전"만 표시한다.
 */

export interface StockLevelResult {
  status: "unavailable" | "available";
  /** available일 때만 숫자. unavailable일 때는 항상 null (0과 "없음"을 구분하기 위함) */
  quantity: number | null;
}

export interface StockLevelProvider {
  getStock(productCode: string): Promise<StockLevelResult>;
}

/** 현재 기본 구현 — 항상 "미확인". 재고 데이터 소스가 생기면 이 구현체만 교체한다. */
export class UnavailableStockLevelProvider implements StockLevelProvider {
  async getStock(): Promise<StockLevelResult> {
    return { status: "unavailable", quantity: null };
  }
}
