# WMS Shipment 분할 설계

- 통합 피킹은 기존 `PickingWave`에서 그대로 완료한다. Shipment 생성은 그 이후 `/wms/shipment`에서만 수행한다.
- 완료 대상은 `completed`, `result_confirmed`, `order_confirmed` 웨이브의 발주서다.
- Shipment 원장 `noidb_wms_shipments_v1`은 Shipment ID, 수정 가능한 이름, 진행 상태, 포함 발주서 스냅샷을 저장한다.
- 포함 발주서 배열이 발주번호 ↔ Shipment 배정의 단일 원장이다. 별도 배정 저장소를 만들지 않는다.
- 발주서 한 건은 원자 단위다. SKU 단위로 분할하지 않는다.
- 센터와 입고예정일이 다른 발주서는 같은 Shipment에 섞지 않는다. 같은 물류 그룹 안에서 화면 기본값 200건씩 나눈다.
- 생성 직전에 최신 원장을 다시 읽고 기존 Shipment 및 이번 생성 묶음 전체의 발주번호 중복을 검사한다. 하나라도 중복이면 아무것도 저장하지 않는다.
- ID는 `SHP-YYYYMMDD-NNN`이며 생성 후 바꾸지 않는다. 이름만 수정한다.
- `draft`, `invoice_generated`만 삭제할 수 있다. 운송장 검증 이후 상태는 실제 출고 진행 가능성이 있어 삭제를 차단한다.
- 삭제는 Shipment 원장 한 건만 제거한다. 피킹·제품DB·재고·발주확정·원본 발주서에는 쓰지 않는다.
- `npm run verify:shipment-split`이 50/200/201/450 분할, 중복 방지, ID 유지, 삭제 복귀를 검증한다.
