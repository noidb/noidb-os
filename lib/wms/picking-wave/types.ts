/**
 * 통합 피킹(웨이브) 전용 타입.
 *
 * 기존 lib/wms/types.ts의 PickingItem/WorkBatch(샘플 피킹 전용, lib/wms/picking-sample-data.ts와 연결)와는
 * 완전히 별개다 — 그것들은 건드리지 않는다.
 *
 * 운영 원칙(2026-08-18 사용자 확정, 다음 스프린트까지 유지):
 * 피킹은 쉽먼트별로 따로 하지 않는다. 여러 발주서/쉽먼트의 SKU를 합쳐 통합 피킹하고, 완료 단위(그룹)를
 * 전체 작업 중 한 번만 연다. 지금은 창고 위치(BOX)가 없어 완료 단위=모델이지만("PICKING_GROUPING_MODE"
 * = "model", lib/wms/picking-wave/grouping.ts 참고), 위치가 갖춰지면 완료 단위=BOX로 전환된다. 포장과
 * 출력만 쉽먼트별로 분리한다(다음 스프린트).
 */

export type PickingWaveStatus = "in_progress" | "completed";
export type PickingWaveItemStatus = "pending" | "full" | "partial" | "notfound";

/** 아이템 합산 전, 발주서(=현재는 바구니 1:1)별 원본 요청 수량 */
export interface PickingWaveSourceRef {
  purchaseOrderNumber: string;
  /** 현재는 발주서=바구니 1:1 임시 배정. 나중에 쉽먼트 번호가 생기면 BasketAssignment.shipmentNumber만 갱신한다. */
  basketNumber: string;
  requestedQuantity: number;
}

/** 피킹 결과(찾은/부족)를 발주서·바구니별로 나눈 확정 값 */
export interface PickingAllocationResult {
  purchaseOrderNumber: string;
  basketNumber: string;
  requestedQuantity: number;
  fulfilledQuantity: number;
  shortageQuantity: number;
}

export interface PickingWaveItem {
  /** `${waveId}-${productCode}` */
  id: string;
  waveId: string;
  /** 쿠팡 상품코드 = SKU ID */
  productCode: string;
  productName: string;
  barcode: string;
  /** 제품DB 조인 성공 시에만 존재 — 모델 모드 1차 그룹 기준 */
  category?: string;
  /** 제품DB 조인 성공 시에만 존재 — 모델 모드 2차 그룹 기준 */
  modelName?: string;
  /** 제품DB 조인 성공 시에만 존재. 없으면 화면에서 플레이스홀더를 보여준다. */
  imageUrl?: string;
  /** 제품DB "옵션명" — 조인 성공 시에만 존재 */
  optionLabel?: string;
  /** 제품DB "거래처" — 조인 성공 시에만 존재. 없으면 화면에서 "거래처 미등록"으로 표시 */
  vendorName?: string;
  /** 제품DB "창고번호"(자유 텍스트, 새 BOX 체계와 별개) — 정렬 2순위로도 사용 */
  catalogWarehouseNumber?: string;
  /** 제품DB "BOX번호"(자유 텍스트, 새 BOX 체계와 별개) */
  catalogBoxNumber?: string;
  /** 제품DB "현재고"(자유 텍스트 컬럼) — stock-level.ts의 실시간 재고 조회와는 별개 */
  catalogCurrentStock?: string;
  /** 제품DB의 실제 쿠팡 Seller SKU Barcode(임의 생성 아님). barcode(발주서 원본)와 별개로 둔다 */
  catalogBarcode?: string;
  /** 발주서 합산 총 수량 */
  totalQuantity: number;
  sources: PickingWaveSourceRef[];

  locationStatus: "located" | "unlocated";
  zoneId?: string;
  shelfId?: string;
  boxId?: string;

  /**
   * 정렬/그룹 기준을 두 가지 다 미리 계산해둔다. 화면은 grouping.ts의 현재 모드에 따라 둘 중 하나를
   * 골라 쓸 뿐이며, 창고 위치가 생겨 모드가 바뀌어도 이 타입/필드는 그대로 유지된다.
   */
  modelSortKey: string;
  locationSortKey: string;

  status: PickingWaveItemStatus;
  pickedQuantity: number;
  shortageQuantity: number;
  /** 확정된 피킹 결과 분배 (사용자 확인 후에만 저장됨) */
  allocations: PickingAllocationResult[];

  createdAt: string;
  updatedAt: string;
}

export interface PickingWave {
  /** "WAVE-20260818-1" 형태 */
  id: string;
  /** 사용자가 직접 붙이는 표시용 이름 (선택, 없으면 화면에서 id를 그대로 보여준다) */
  displayName?: string;
  status: PickingWaveStatus;
  sourcePurchaseOrderNumbers: string[];
  /** 완료 처리된 그룹 id (모델 모드: "model:xxx", 위치 모드: "box:xxx") — 재접속해도 유지 */
  completedGroupIds: string[];
  /** 생성 시점에 제품DB 조인이 가능했는지 (참고용) */
  productDbConfigured: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface BasketAssignment {
  basketNumber: string;
  purchaseOrderNumber: string;
  /** 이 발주서의 물류센터 — 화면에 바구니명 대신 물류센터명을 표시하기 위해 저장해둔다 (2026-08-19).
   *  바구니 번호/분배 로직 자체는 그대로 유지되고, 이 필드는 표시 전용이다. */
  fulfillmentCenter: string;
  /** 나중에 쉽먼트 번호가 생기면 이 필드만 갱신한다 (웨이브 재생성 불필요) */
  shipmentNumber?: string;
  waveId: string;
  status: "pending" | "completed";
  createdAt: string;
  updatedAt: string;
}
