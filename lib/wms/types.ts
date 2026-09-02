/**
 * NOID WMS 공통 타입 초안 (Sprint 0)
 *
 * 이 파일은 기존 상품등록 자동화(app/page.tsx, lib/excel/*, lib/product-db/*)와
 * 완전히 독립된 WMS 전용 타입 정의입니다. 실제 저장소/DB 스키마는 아직 확정되지
 * 않았으며, 이후 스프린트에서 구현과 함께 조정될 수 있습니다.
 *
 * 자세한 개념 설명은 docs/WMS_DATA_MODEL.md 를 참고하세요.
 */

// ─────────────────────────────────────────────
// 상태값 (enum / union type)
// ─────────────────────────────────────────────

/** 작업 배치(WorkBatch)의 진행 상태 */
export type WorkBatchStatus =
  | "draft"
  | "in_progress"
  | "completed"
  | "cancelled";

/** 피킹 항목(PickingItem)의 처리 결과 상태 */
export type PickingResultStatus =
  | "pending"
  | "fully_picked"
  | "partially_picked"
  | "stock_counted";

/** 거래처 발주(VendorOrder)의 진행 상태 */
export type VendorOrderStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "sent"
  | "rejected"
  | "cancelled";

/** 입고예정일/물류센터 변경 요청(ScheduleChangeRequest)의 처리 상태 */
export type ScheduleChangeRequestStatus =
  | "pending_approval"
  | "approved"
  | "requested_to_hub"
  | "hub_approved"
  | "hub_rejected"
  | "rejected";

/** 쉽먼트(Shipment)의 진행 상태 */
export type ShipmentStatus =
  | "created"
  | "documents_ready"
  | "printed"
  | "completed";

// ─────────────────────────────────────────────
// 상품 / 모델 / SKU 계층
// ─────────────────────────────────────────────

/** 최상위 상품 개념 */
export interface Product {
  id: string;
  name: string;
  category?: string;
  createdAt: string;
  updatedAt: string;
}

/** 상품 하위의 디자인/옵션 단위 */
export interface Model {
  id: string;
  productId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** 실제 재고/발주/피킹의 최소 단위 */
export interface Sku {
  id: string;
  modelId: string;
  skuCode: string;
  optionLabel?: string;
  /** SKU 옵션을 대표하는 이미지 URL (피킹 화면에서 오피킹 방지용으로 사용) */
  optionImageUrl?: string;
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────
// 창고 위치 계층: 창고 → 카테고리 구역(Zone) → 선반(Shelf) → BOX → 모델 → SKU
//
// 참고: 기존 제품DB/발주서 출력 시트의 "창고번호" 필드는 노이드비 내부 상품 보관 위치
// 정보다(자유 텍스트라 Zone/Shelf/BOX처럼 구조화되어 있지 않을 뿐). 여기서 정의하는
// Zone/Shelf/BOX는 그 기존 정보를 구조화·대체하는 새 체계다. 기존 값은 새 체계로 옮길 때
// WarehouseMigrationMapping.legacyLocation으로 참고하되, 사람이 실물을 확인한 뒤에만
// 새 BOX와 확정 매핑한다 (자동 확정 금지). 자세한 절차는 docs/WAREHOUSE_MIGRATION_PLAN.md 참고.
//
// 아래 WarehouseZone / Shelf / ModelLocation / SkuLocation / WarehouseMigrationMapping은
// Sprint("실제 창고 운영 데이터 모델 설계")에서 신규 추가된 타입이다.
// 기존 WarehouseBox / WarehouseLocation / Product / Model / Sku는 필드를 제거하거나
// 이름을 바꾸지 않고, WarehouseBox에만 신규 필드를 추가하는 방식으로 100% 호환을 유지했다.
// 자세한 설계 근거는 docs/WAREHOUSE_DATA_MODEL.md 참고.
// ─────────────────────────────────────────────

/** Zone/Shelf 공통 사용상태 (단순 사용중/미사용) */
export type WarehouseUsageStatus = "active" | "inactive";

/**
 * 카테고리 구역(Zone). 창고를 상품 카테고리별로 나눈 큰 구역.
 * id는 BOX ID 앞자리로도 쓰이는 짧은 코드다 (예: "E" = 귀걸이).
 */
export interface WarehouseZone {
  /** Zone ID (예: "E", "P", "N", "R", "B", "S") */
  id: string;
  /** 표시용 이름 (예: "귀걸이 구역") */
  name: string;
  /** 제품DB의 "카테고리" 값과 매칭되는 텍스트 (예: "귀걸이") */
  category: string;
  sortOrder: number;
  status: WarehouseUsageStatus;
  createdAt: string;
  updatedAt: string;
}

/** 선반. 하나의 Zone 안에 여러 선반이 있을 수 있다. */
export interface Shelf {
  /** Shelf ID (예: "E-A") */
  id: string;
  zoneId: string;
  /** 선반명 (예: "A선반") */
  name: string;
  sortOrder: number;
  status: WarehouseUsageStatus;
  createdAt: string;
  updatedAt: string;
}

/** BOX 종류 */
export type WarehouseBoxKind = "small_tool_box" | "large_living_box" | "other";

/** BOX 사용상태 */
export type WarehouseBoxStatus = "active" | "empty" | "full" | "retired";

/**
 * 보관박스(BOX). 피킹의 최소 단위 — 피킹은 항상 BOX 단위로 진행하며,
 * 같은 BOX는 한 번만 연다.
 *
 * id 형식: `${카테고리코드}-${선반코드}-${3자리 번호}` (예: "E-A-001").
 * 카테고리코드: E 귀걸이 · P 피어싱 · N 목걸이 · R 반지 · B 팔찌 · S 세트.
 *
 * 기존 필드(id/shelfId/label/createdAt/updatedAt)는 Sprint 0 초안 그대로 유지했고,
 * 이번 설계에서 필요한 필드만 추가했다 (100% 호환, 확장만).
 */
export interface WarehouseBox {
  id: string;
  shelfId: string;
  /** 표시용 별칭 (선택, id와 별개로 사람이 부르는 이름을 붙이고 싶을 때) */
  label: string;

  kind: WarehouseBoxKind;
  /** 조회 편의를 위한 비정규화 필드 (shelfId → zoneId는 Shelf.zoneId로도 얻을 수 있음) */
  zoneId: string;
  /** 조회 편의를 위한 비정규화 필드 (제품DB "카테고리"와 매칭되는 텍스트) */
  category: string;
  /** 같은 카테고리 안 시리즈 구분 (예: "나비", "하트", "코인"). 시리즈 구분이 없는 카테고리는 생략 가능 */
  series?: string;
  /** 세트상품 전용 BOX인지 여부 */
  isSetBox: boolean;

  /**
   * 현재 이 BOX에 들어있는 모델 수.
   * 원칙적으로 ModelLocation(+ SkuLocation 예외)에서 계산되는 파생값이며,
   * 스프레드시트 환경에서는 매번 재계산하는 대신 이 필드에 캐시해 둘 수도 있다.
   * 캐시로 사용할 경우 모델 이동/BOX 비우기 시 반드시 함께 갱신해야 데이터가 어긋나지 않는다.
   */
  currentModelCount: number;
  /** 이 BOX에 넣을 수 있는 최대 모델 수 (선택, 용량 제한이 있을 때만) */
  maxModelCount?: number;

  /** QR 코드에 인코딩되는 값. 설계는 docs/WAREHOUSE_QR_PLAN.md 참고 */
  qrValue?: string;

  status: WarehouseBoxStatus;
  memo?: string;
  sortOrder: number;

  createdAt: string;
  updatedAt: string;
}

/**
 * 모델(모델명/품번) 단위 위치 지정.
 * SKU 위치는 기본적으로 이 모델 위치를 상속한다 — 상속 규칙은 아래 SkuLocation 설명 참고.
 */
export interface ModelLocation {
  /** 고유키. 제품DB의 "모델명/품번"과 동일한 텍스트 */
  modelName: string;
  /** 기본 BOX (이 모델의 옵션들이 기본적으로 위치하는 BOX) */
  primaryBoxId: string;
  /** 보조 BOX (한 모델이 여러 BOX에 나뉘어 있을 때 사용) */
  secondaryBoxId?: string;
  /** 이 모델의 옵션 전체가 기본 BOX 하나에 다 들어있는지 여부 (true면 SKU별 예외 저장을 생략해도 됨) */
  allOptionsSameBox: boolean;
  /**
   * 세트상품 여부. 상품명 텍스트로 추측하지 않고 위치 데이터에 명시적으로 저장한다
   * (2026-08-18 확정 규칙). true면 위치 검증 시 세트 전용 BOX(isSetBox=true)에
   * 배치되어 있는지 확인한다.
   */
  isSetProduct: boolean;
  memo?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * SKU 단위 위치 "예외"만 저장한다 (전 SKU를 다 저장하지 않음).
 * 위치 조회 순서(상속 규칙): SkuLocation 있음 → 그 값 사용 /
 * 없음 → ModelLocation 사용 / ModelLocation도 없음 → "미배치".
 * 자세한 상속 규칙은 docs/WAREHOUSE_DATA_MODEL.md 참고.
 */
export interface SkuLocation {
  /** 고유키 */
  skuId: string;
  /** 조회 편의를 위한 비정규화 필드 */
  modelName: string;
  boxId: string;
  /** 옵션명 (예: "실버", "10호") — 조회 편의용 */
  optionLabel?: string;
  /** 이 레코드가 예외 위치임을 명시하는 플래그 (이 테이블에 존재하는 행은 항상 true) */
  isException: true;
  /** 왜 모델 기본 위치와 다른지에 대한 사유 (선택) */
  reason?: string;
  memo?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 선반 → 보관박스 → 모델 → SKU 계층의 특정 위치 (Sprint 0~1 시점의 단순 초안).
 * 이제는 위의 ModelLocation/SkuLocation(모델 상속 + SKU 예외 구조)이 실제 설계이며,
 * 이 인터페이스는 이름을 바꾸거나 삭제하지 않고 100% 호환을 위해 그대로 남겨둔다.
 * 새 코드는 WarehouseLocation 대신 ModelLocation/SkuLocation을 사용한다.
 * @deprecated ModelLocation과 SkuLocation으로 대체됨. 삭제하지 않고 호환을 위해 유지.
 */
export interface WarehouseLocation {
  id: string;
  shelfId: string;
  boxId: string;
  /** 조회 편의를 위한 비정규화 필드 (SKU→모델은 Sku.modelId로도 얻을 수 있음) */
  modelId: string;
  skuId: string;
  /** 마지막으로 이 위치를 지정/변경한 사람 (선택) */
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────
// 기존 "창고번호" → 새 BOX 체계 Migration
// ─────────────────────────────────────────────

export type WarehouseMigrationStatus = "unverified" | "checking" | "confirmed" | "skipped";

/**
 * 제품DB의 기존 "창고번호"(노이드비 내부 위치 정보, 자유 텍스트) 값 하나를 새 BOX ID에
 * 매핑하는 레코드. 기존 창고번호 값/컬럼은 절대 삭제·수정하지 않는다 — 이 테이블은 옆에
 * 새로 추가되는 매핑 기록일 뿐이다. 자동으로 확정하지 않고, 사람이 실물 위치를 확인한
 * 뒤에만 confirmedBoxId를 채운다. 자세한 절차와 검증 항목은 docs/WAREHOUSE_MIGRATION_PLAN.md 참고.
 */
export interface WarehouseMigrationMapping {
  id: string;
  /** 제품DB "창고번호" 컬럼에 있던 원본 값 그대로 (변경하지 않음) */
  legacyLocation: string;
  /** 이 legacyLocation 값을 가진 모델 개수 (참고/검증용) */
  connectedModelCount: number;
  /** 이 legacyLocation 값을 가진 SKU 개수 (참고/검증용) */
  connectedSkuCount: number;
  /** 시스템이 자동으로 추천하는 새 BOX ID (확정 아님, 참고용) */
  suggestedBoxId?: string;
  /** 사람이 실물 위치를 확인한 뒤 확정한 새 BOX ID */
  confirmedBoxId?: string;
  status: WarehouseMigrationStatus;
  memo?: string;
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────
// 발주서 (PurchaseOrder)
// ─────────────────────────────────────────────

/**
 * 발주서.
 * - purchaseOrderNumber 는 발주의 고유키이며 변경되지 않는다.
 * - SKU 구성과 수량(PurchaseOrderItem)은 같은 purchaseOrderNumber 내에서 변경되지 않는다.
 * - 변경 가능한 값은 입고예정일과 물류센터뿐이며, original / current 값을 분리 추적한다.
 */
export interface PurchaseOrder {
  id: string;
  /** 발주서의 고유키 (불변) */
  purchaseOrderNumber: string;

  /** 최초 생성 시점의 입고예정일 (불변, 이력 보존용) */
  originalExpectedDate: string;
  /** 현재 적용된 입고예정일 (승인된 변경만 반영) */
  currentExpectedDate: string;

  /** 최초 생성 시점의 물류센터 (불변, 이력 보존용) */
  originalFulfillmentCenter: string;
  /** 현재 적용된 물류센터 (승인된 변경만 반영) */
  currentFulfillmentCenter: string;

  createdAt: string;
  updatedAt: string;
}

/**
 * 발주서에 속한 SKU별 라인 아이템.
 * skuId 와 orderedQuantity 는 같은 발주서 번호에서 변경되지 않는다.
 */
export interface PurchaseOrderItem {
  id: string;
  purchaseOrderId: string;
  skuId: string;
  /** 발주 수량 (불변) */
  orderedQuantity: number;
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────
// 작업 배치 / 피킹
// ─────────────────────────────────────────────

/** 발주서(들)로부터 생성된 피킹 작업 배치 */
export interface WorkBatch {
  id: string;
  purchaseOrderIds: string[];
  status: WorkBatchStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * 작업 배치 내 SKU별 피킹 항목.
 * 전량찾음 / 부분찾음 / 현재고 입력의 세 가지 결과 입력을 지원한다.
 */
export interface PickingItem {
  id: string;
  workBatchId: string;
  skuId: string;
  locationId: string;

  /** 원래 확보해야 하는 수량 */
  requiredQuantity: number;
  /** 실제로 찾은(피킹한) 수량 */
  pickedQuantity: number;
  /** 부족 수량 (requiredQuantity - pickedQuantity, 0 이상) */
  shortageQuantity: number;
  /** 실사로 입력한 현재 실재고 수량 (현재고 입력 시에만 사용) */
  actualRemainingStock?: number;

  status: PickingResultStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * 통합 피킹 중 하나의 PickingItem(찾은 수량)을 쉽먼트별 발주서 배정으로 나눈 분배 기록.
 * "총 7개 찾기 → SH-001→2개, SH-003→4개, SH-005→1개"의 각 줄에 해당한다.
 * 다음 스프린트(쉽먼트별 포장/출력) 구현 전까지는 타입 정의만 존재한다.
 */
export interface PickingItemShipmentAllocation {
  id: string;
  pickingItemId: string;
  shipmentNumber: string;
  /** 분류 단계에서 사용하는 내부 배정번호 */
  basketNumber: string;
  allocatedQuantity: number;
  createdAt: string;
}

// ─────────────────────────────────────────────
// 거래처 발주 (부족분 자동 연결)
// ─────────────────────────────────────────────

/** 피킹 부족분으로 자동 생성되는 거래처 발주. 사용자 승인 후에만 발송된다. */
export interface VendorOrder {
  id: string;
  /** 부족 수량이 발생한 원본 피킹 항목 (추적용) */
  sourcePickingItemId?: string;
  status: VendorOrderStatus;
  approvedAt?: string;
  sentAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** 거래처 발주의 SKU별 라인 아이템 */
export interface VendorOrderItem {
  id: string;
  vendorOrderId: string;
  skuId: string;
  quantity: number;
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────
// 입고 / 쉽먼트
// ─────────────────────────────────────────────

/** 입고 처리 기록 */
export interface InboundRecord {
  id: string;
  purchaseOrderId: string;
  skuId: string;
  receivedQuantity: number;
  receivedAt: string;
  createdAt: string;
}

/**
 * 통합 피킹 / 쉽먼트별 포장·출력 운영 원칙 (2026-08-18 사용자 확정, 다음 스프린트 구현 대상).
 * 이번 스프린트(서플라이어 허브 실제 발주 연동)에서는 구현하지 않고, 아래 Shipment.shipmentNumber와
 * PickingItemShipmentAllocation 타입 정의로만 미리 반영해둔다.
 *
 * - 피킹은 쉽먼트별로 따로 하지 않는다. 여러 쉽먼트의 SKU를 합쳐 구역→선반→BOX→모델→SKU 순서로
 *   통합 피킹한다. 목표는 전체 작업 중 같은 BOX를 한 번만 여는 것.
 * - 피킹하면서 SKU마다 "총 찾을 수량"과 "쉽먼트별 분배 수량(내부 배정번호 + 쉽먼트 번호 + 수량)"을
 *   함께 표시한다. 예: 총 7개 찾기 → SH-001→2개, SH-003→4개, SH-005→1개.
 * - 후속 출력은 쉽먼트별로 분리한다 (분류=쉽먼트별 발주서 배정, 출력=쉽먼트별
 *   피킹리스트·송장·상품 바코드·BOX 라벨·거래명세서 5종 세트).
 */

/** 쉽먼트(출고/입고 배송 단위). 거래명세서·라벨 PDF와 연결 */
export interface Shipment {
  id: string;
  /** 쉽먼트 고유키(불변). 서플라이어 허브가 이행 준비 단계에서 부여 — 신규 발주 캡처 시점엔 비어있을 수 있다. */
  shipmentNumber: string;
  purchaseOrderId?: string;
  vendorOrderId?: string;
  status: ShipmentStatus;

  /** 거래명세서 PDF 다운로드 URL (생성 후 채워짐) */
  invoiceDocumentUrl?: string;
  /** 라벨 PDF 다운로드 URL (생성 후 채워짐) */
  labelDocumentUrl?: string;

  documentsDownloadedAt?: string;
  printedAt?: string;

  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────
// 입고예정일 / 물류센터 변경 승인 요청
// ─────────────────────────────────────────────

/**
 * 입고예정일 또는 물류센터 변경 요청.
 * 사용자 승인 후 서플라이어 허브에 자동으로 요청되며,
 * 승인/거부 결과는 시스템이 자동으로 감지한다.
 */
export interface ScheduleChangeRequest {
  id: string;
  purchaseOrderId: string;

  requestedExpectedDate?: string;
  requestedFulfillmentCenter?: string;

  status: ScheduleChangeRequestStatus;
  requestedAt: string;
  approvedAt?: string;
  hubRespondedAt?: string;

  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────
// 활동 로그
// ─────────────────────────────────────────────

/** 발주/피킹/입고/쉽먼트/승인 등 상태 변경 시 기록되는 감사 추적용 로그 */
export interface ActivityLog {
  id: string;
  entityType:
    | "PurchaseOrder"
    | "WorkBatch"
    | "PickingItem"
    | "VendorOrder"
    | "InboundRecord"
    | "Shipment"
    | "ScheduleChangeRequest";
  entityId: string;
  action: string;
  actor?: string;
  detail?: string;
  createdAt: string;
}
