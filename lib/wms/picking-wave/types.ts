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

/**
 * 2026-08-19 2차 실사용 테스트 반영 — 웨이브 수정과 Supplier Hub용 발주확정을 명확히 분리한다.
 * 흐름: in_progress(피킹 진행) → completed(피킹 완료, 여러 번 재수정 가능) →
 * result_confirmed(사용자가 찾은수량/부족수량을 확인 완료 — "피킹 결과 최종 확인") →
 * order_confirmed(최종 발주확정 — 이후 일반 피킹 수정 잠금). "피킹 내용 수정"은 별도 저장 상태가
 * 아니라 completed/result_confirmed 상태에서 화면이 편집 모드로 전환되는 것뿐이며,
 * order_confirmed 전까지는 몇 번이든 다시 completed로 돌아와 수정할 수 있다.
 */
export type PickingWaveStatus = "in_progress" | "completed" | "result_confirmed" | "order_confirmed";
export type PickingWaveItemStatus = "pending" | "full" | "partial" | "notfound";

/** 아이템 합산 전, 발주서별 원본 요청 수량 */
export interface PickingWaveSourceRef {
  purchaseOrderNumber: string;
  /** 현재는 발주서별 1:1 임시 배정. 나중에 쉽먼트 번호가 생기면 BasketAssignment.shipmentNumber만 갱신한다. */
  basketNumber: string;
  requestedQuantity: number;
  /** 입고예정일+물류센터가 같은 화면상 합배송 그룹. 수량 병합에는 사용하지 않는다. */
  shippingGroupKey?: string;
}

/** 피킹 결과(찾은/부족)를 발주서별로 나눈 확정 값 */
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
  gender?: string;
  /** 제품DB 조인 성공 시에만 존재 — 모델 모드 2차 그룹 기준 */
  modelName?: string;
  /** 제품DB "모델SKU"(F열, 옵션별 고유값) — 조인 성공 시에만 존재. SKU ID가 나중에 바뀌어도
   *  이 값으로 같은 상품을 다시 찾을 수 있게 저장해둔다(2026-08-20 신규, 제품DB 새로고침 재매칭용).
   *  2026-08-20 이전에 생성된 웨이브 아이템에는 없을 수 있다 — 그런 경우 SKU ID로만 재매칭한다. */
  modelSku?: string;
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
  /** 생성 시 필수 입력한 작업자 표시명. */
  workerName?: string;
  /** 생성 당시 합배송 그룹 정보. 발주 원본과 피킹 수량은 병합하지 않는다. */
  shippingGroups?: { key: string; expectedDate: string; fulfillmentCenter: string; purchaseOrderNumbers: string[] }[];
  status: PickingWaveStatus;
  sourcePurchaseOrderNumbers: string[];
  /** 완료 처리된 그룹 id (모델 모드: "model:xxx", 위치 모드: "box:xxx") — 재접속해도 유지 */
  completedGroupIds: string[];
  /** 생성 시점에 제품DB 조인이 가능했는지 (참고용) */
  productDbConfigured: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  /** "피킹 결과 최종 확인" 버튼을 누른 시각 */
  resultConfirmedAt?: string;
  /** "최종 발주확정" 버튼을 누른 시각 — 있으면 order_confirmed */
  orderConfirmedAt?: string;
  /** 송장 생성 당시의 선택 발주 집합. 기존 웨이브에는 없을 수 있으며 출력 재생성에만 사용한다. */
  outputGenerations?: ShipmentOutputGeneration[];
}

export interface ShipmentOutputGeneration {
  generationId: string;
  waveId: string;
  purchaseOrderNumbers: string[];
  createdAt: string;
  updatedAt: string;
  expectedShippingGroupCount: number;
  invoiceFileName: string;
  shipmentFileName?: string;
  outputSetFileName?: string;
  outputSetGeneratedAt?: string;
  status: "invoice_generated" | "shipment_generated";
}

export interface BasketAssignment {
  basketNumber: string;
  purchaseOrderNumber: string;
  /** 이 발주서의 물류센터 — 화면에 물류센터명을 표시하기 위해 저장해둔다 (2026-08-19).
   *  내부 배정 번호/분배 로직 자체는 그대로 유지되고, 이 필드는 표시 전용이다. */
  fulfillmentCenter: string;
  /** 나중에 쉽먼트 번호가 생기면 이 필드만 갱신한다 (웨이브 재생성 불필요) */
  shipmentNumber?: string;
  waveId: string;
  status: "pending" | "completed";
  createdAt: string;
  updatedAt: string;
}
