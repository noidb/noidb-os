/**
 * 거래처별 부족분 발주서(초안) 전용 타입.
 *
 * 통합 피킹(웨이브) 완료 후 부족 수량이 있는 SKU를 제품DB "거래처" 기준으로 자동 그룹핑해
 * 만드는 발주서 초안이다. 거래처 정보가 없는 SKU는 vendorName이 "거래처 미등록" 고정 문자열이 된다
 * (2026-08-19 사용자 확정 — 별도 그룹으로 분리 표시).
 *
 * 자동 발송·자동 승인은 없다. 승인은 항상 사용자가 화면에서 직접 누른다.
 */

export type VendorOrderDraftStatus = "draft" | "review" | "approved" | "sent" | "resend_needed";

export const VENDOR_ORDER_STATUS_LABEL: Record<VendorOrderDraftStatus, string> = {
  draft: "초안",
  review: "검토중",
  approved: "승인완료",
  sent: "전송완료",
  resend_needed: "수정후재전송",
};

export const UNASSIGNED_VENDOR_NAME = "거래처 미등록";

/**
 * 연결된 웨이브 없이 수동으로 만든 거래처 발주서를 담는 가상 waveId (2026-08-19 4차 실사용
 * 테스트 신규 — "거래처 발주관리" 허브에서 "웨이브 없이 새로 만들기"를 누르면 이 ID를 쓴다).
 * 실제 PickingWave가 존재하지 않아도 기존 웨이브별 거래처 발주서 화면
 * (app/wms/picking/waves/[waveId]/vendor-orders)을 그대로 재사용할 수 있게, 그 화면이 이 ID를
 * 만나면 "웨이브 없음" 예외로 처리한다 — 새 화면을 중복으로 만들지 않기 위한 최소 특수 처리.
 */
export const MANUAL_VENDOR_WORKSPACE_ID = "MANUAL-VENDOR-ORDERS";

export interface VendorOrderDraft {
  /** `${waveId}::${vendorName}` */
  id: string;
  waveId: string;
  vendorName: string;
  status: VendorOrderDraftStatus;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  sentAt?: string;
}

export interface VendorOrderDraftLine {
  /** 자동 생성 라인: `${draftId}::${skuId}`, 수동 추가 라인: `${draftId}::manual-${timestamp}` */
  id: string;
  draftId: string;
  waveId: string;
  /** 이 라인이 속한 거래처명 — draftId는 저장 시 `${waveId}::${vendorName}`으로 다시 계산된다.
   *  "거래처 변경"은 이 값만 바꾸면 되고, 화면은 이 값을 기준으로 거래처별 그룹을 다시 계산한다. */
  vendorName: string;
  skuId: string;
  modelName: string;
  /** 제품DB 카테고리 — 없으면 "" ("미분류"로 표시, 2026-08-20 신규: 카카오톡 공유 이미지·초안
   *  카드 상단에 옵션·수량과 함께 크게 보여주기 위한 필드). */
  category: string;
  optionLabel: string;
  productName: string;
  /** 제품DB 대표이미지 URL — 없으면 "" ("이미지 미등록"으로 표시) */
  imageUrl: string;
  /** 제품DB의 실제 쿠팡 Seller SKU Barcode — 없으면 "" ("쿠팡 바코드 미등록"으로 표시), 임의 생성 금지 */
  barcode: string;
  shortageQuantity: number;
  /** 제품DB "현재고" 텍스트 컬럼 (참고용, 실시간 재고 아님) */
  currentStock: string;
  /** 이 부족분과 관련된 쿠팡 발주서 번호들 (추적용) */
  relatedPurchaseOrderNumbers: string[];
  memo: string;
  /** 자동 집계가 아니라 사용자가 화면에서 직접 추가한 라인인지 */
  isManuallyAdded: boolean;
  /** 발주 입고처리 화면에서 저장하는 실제 입고수량 (2026-08-19 4차 실사용 테스트 신규 필드).
   *  없으면 0으로 취급한다. 이 값을 저장해도 제품DB(구글시트) 현재고는 자동으로 바뀌지 않는다 —
   *  재고 자동 반영은 별도 사용자 지시가 있을 때까지 구현하지 않는다. */
  receivedQuantity?: number;
  createdAt: string;
  updatedAt: string;
}
