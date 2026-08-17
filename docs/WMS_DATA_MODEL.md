# NOID WMS 데이터 모델 (초안)

이 문서는 `lib/wms/types.ts`에 정의된 타입들의 의미와 관계를 설명한다.
실제 구현(DB 스키마, API 스펙)은 다음 스프린트에서 확정하며, 이 문서는
Sprint 0 시점의 개념 모델(초안)이다.

## 1. 엔티티 개요

| 엔티티 | 역할 |
| --- | --- |
| Product | 최상위 상품 개념 (예: "14K 골드 목걸이") |
| Model | 상품 하위의 디자인/옵션 단위 (예: 색상/디자인별 모델) |
| Sku | 실제 재고/발주/피킹의 최소 단위 (모델 하위의 사이즈 등 옵션 조합) |
| WarehouseLocation | 선반 → 박스 → 모델 → SKU 계층의 특정 위치 |
| WarehouseBox | 보관박스 자체(선반에 속함) |
| PurchaseOrder | 발주서. 고유값은 `purchaseOrderNumber` |
| PurchaseOrderItem | 발주서에 속한 SKU별 라인 아이템 |
| WorkBatch | 발주서(들)로부터 생성된 피킹 작업 배치 |
| PickingItem | 작업 배치 내 SKU별 피킹 항목 |
| VendorOrder | 피킹 부족분으로 자동 생성되는 거래처 발주 |
| VendorOrderItem | 거래처 발주의 SKU별 라인 아이템 |
| InboundRecord | 입고 처리 기록 |
| Shipment | 쉽먼트(출고/입고 배송 단위). 거래명세서·라벨 PDF와 연결 |
| ScheduleChangeRequest | 입고예정일/물류센터 변경 승인 요청 |
| ActivityLog | 전체 시스템 활동 로그(감사 추적용) |

## 2. 계층 구조

```
Product
  └─ Model (디자인/옵션 단위)
       └─ Sku (최소 재고 단위)

WarehouseLocation
  Shelf(선반)
    └─ Box(보관박스)
         └─ Model
              └─ Sku
```

- `WarehouseLocation`은 `shelfId → boxId → modelId → skuId`의 계층으로 특정 SKU가
  "어느 선반의 어느 박스 안, 어느 모델의 어느 SKU 위치"에 있는지를 나타낸다.
- 피킹 시 같은 `boxId`를 가진 항목들을 묶어 정렬함으로써 같은 박스를 한 번만 열도록 한다.

## 3. 발주서(PurchaseOrder)의 불변/가변 규칙

- **불변**: `purchaseOrderNumber`(고유키), 각 `PurchaseOrderItem`의 `skuId`와 `orderedQuantity`
  - 같은 발주서 번호에서는 SKU 구성과 수량이 절대 바뀌지 않는다.
- **가변(승인 필요)**: 입고예정일, 물류센터
  - `originalExpectedDate` / `currentExpectedDate`로 분리 추적
  - `originalFulfillmentCenter` / `currentFulfillmentCenter`로 분리 추적
  - 변경은 `ScheduleChangeRequest`를 통해 신청 → 사용자 승인 → 서플라이어 허브 자동 요청 →
    승인/거부 결과 자동 감지의 흐름을 따른다.

## 4. 피킹(Picking) 결과 모델

`PickingItem`은 다음 세 가지 결과 입력을 지원한다.

- **전량찾음**: `pickedQuantity === requiredQuantity`, `shortageQuantity === 0`
- **부분찾음**: `pickedQuantity < requiredQuantity`, `shortageQuantity = requiredQuantity - pickedQuantity`
- **현재고 입력**: `actualRemainingStock`에 실사 수량을 직접 입력(재고 실사/보정 목적)

`shortageQuantity > 0`인 경우, 해당 SKU/수량 기준으로 `VendorOrder`(거래처발주) 초안이
자동 생성되는 것을 목표로 한다(실제 자동 생성 로직은 이후 스프린트에서 구현).

## 5. 승인 흐름이 필요한 변경

| 변경 대상 | 트리거 | 승인 후 동작 |
| --- | --- | --- |
| 입고예정일 / 물류센터 | 사용자가 변경 요청 | 서플라이어 허브에 자동 요청 → 승인/거부 결과 자동 감지 |
| 거래처발주 발송 | 피킹 부족분 자동 감지 | 사용자 승인 후에만 실제 발송 |

이 두 흐름은 공통적으로 "요청 → 대기(pending) → 승인/거부 → 외부 반영"의 상태 전이를 가지며,
`ScheduleChangeRequest`와 `VendorOrder`의 상태(enum)로 표현한다.

## 6. 쉽먼트 및 문서 자동화

- `Shipment`는 거래명세서 PDF, 라벨 PDF의 다운로드/출력 상태를 함께 추적한다.
- 쉽먼트 생성 시점에 웹에서 생성되는 두 문서를 자동 다운로드·출력하는 것이 목표이며,
  Sprint 0에서는 관련 필드만 타입에 반영하고 실제 자동화 로직은 구현하지 않는다.

## 7. 활동 로그

- `ActivityLog`는 발주/피킹/입고/쉽먼트/승인 등 상태 변경이 발생할 때마다 기록되는
  감사 추적용 엔티티로, 이후 스프린트에서 실제 기록 로직을 붙인다.
