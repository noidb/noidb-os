import type { VendorOrderDraft, VendorOrderDraftLine } from "./types";

/**
 * 거래처별 부족분 발주서 저장소 인터페이스. 화면은 이 인터페이스에만 의존한다
 * (lib/wms/picking-wave/repository.ts와 동일한 패턴). 실제 저장 방식(localStorage/서버 등)은
 * 구현체 교체만으로 바뀔 수 있다.
 */
export interface VendorOrderRepository {
  listDrafts(waveId: string): Promise<VendorOrderDraft[]>;
  saveDraft(draft: VendorOrderDraft): Promise<void>;

  listLines(waveId: string): Promise<VendorOrderDraftLine[]>;
  saveLine(line: VendorOrderDraftLine): Promise<void>;
  deleteLine(lineId: string): Promise<void>;

  /** 웨이브 구분 없이 전체 거래처 발주서 초안을 돌려준다 — 거래처 발주관리/입고처리 화면처럼
   *  여러 웨이브를 가로질러 조회해야 하는 화면에서만 쓴다 (2026-08-19 4차 실사용 테스트 신규). */
  listAllDrafts(): Promise<VendorOrderDraft[]>;
  /** 웨이브 구분 없이 전체 거래처 발주서 라인을 돌려준다. */
  listAllLines(): Promise<VendorOrderDraftLine[]>;
}
