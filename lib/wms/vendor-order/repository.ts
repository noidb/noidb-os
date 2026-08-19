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
}
