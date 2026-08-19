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
  createdAt: string;
  updatedAt: string;
}
