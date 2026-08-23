import type { BasketAssignment, PickingWave, PickingWaveItem } from "./types";

/**
 * 통합 피킹(웨이브) 저장소 인터페이스. 화면(UI)은 이 인터페이스에만 의존하고, 실제 저장 방식
 * (localStorage/구글시트/서버 등)에는 의존하지 않는다 — lib/warehouse/repository.ts와 동일한 패턴.
 * 나중에 구현체만 GoogleSheetsPickingWaveRepository 등으로 교체하면 된다.
 */
export interface PickingWaveRepository {
  listWaves(): Promise<PickingWave[]>;
  getWave(waveId: string): Promise<PickingWave | null>;
  saveWave(wave: PickingWave): Promise<void>;
  /**
   * 웨이브와 그 아이템·바구니, 해당 웨이브의 임시 발주확정 진행상태를 함께 삭제한다.
   * 발주확정 완료 이력, 다른 웨이브, 거래처 발주·입고 이력, 실제 발주 원본에는 영향이 없다.
   */
  deleteWave(waveId: string): Promise<void>;

  listItems(waveId: string): Promise<PickingWaveItem[]>;
  saveItem(item: PickingWaveItem): Promise<void>;
  deleteItem(itemId: string): Promise<void>;

  listBaskets(waveId: string): Promise<BasketAssignment[]>;
  saveBasket(basket: BasketAssignment): Promise<void>;
  deleteBasket(waveId: string, basketNumber: string): Promise<void>;
}
