# 기존 "창고번호" → 새 BOX 체계 Migration 설계

## 1. 전제 — 기존 데이터는 절대 삭제하지 않는다

`제품DB`/`발주서 출력` 시트의 기존 "창고번호" 컬럼과 그 안의 모든 값은 이번 Migration
설계로 인해 **어떤 경우에도 삭제·수정하지 않는다.** Migration은 그 옆에 완전히 새로운
매핑 기록(`WarehouseMigrationMapping`, 별도 시트)을 추가하는 것뿐이며, 기존 컬럼은
그대로 유지된다.

## 2. 정정 (2026-08-18): "창고번호"는 노이드비 내부 위치 정보다

> **이전 버전의 이 문서는 "창고번호"를 쿠팡 로켓배송 물류센터 코드(외부 식별자)로
> 추정했다. 이는 틀린 추정이었고, 사용자가 직접 정정했다: "창고번호"는 노이드비 내부
> 상품 보관 위치 정보다.** `docs/WMS_WAREHOUSE_LOCATION_MODEL.md`도 같은 기준으로
> 함께 정정했다.

기존 "창고번호" 값은 **새 BOX ID로 이전할 때 참고하는 `legacyLocation` 값**이다.
자유 텍스트라 형식이 제각각이고 Zone/Shelf/BOX처럼 구조화되어 있지 않을 뿐, 실제로는
그 물건이 있던(또는 있다고 알려진) 위치에 대한 정보다.

> ⚠️ **그래도 자동으로 확정하지 않는다.** 자유 텍스트로 오래 쌓인 값이라 최신 상태와
> 다를 수 있고, 표기가 사람마다 달랐을 수 있다. 그러므로 이 Migration은 **`legacyLocation`
> 값을 참고 힌트로 보여주되, 반드시 사람이 실물 위치를 직접 확인한 뒤 새 BOX ID와
> 매핑을 확정**하는 절차로 설계한다 (아래 상태값은 `pending`이 기본).

## 3. Migration 매핑 구조

타입: `lib/wms/types.ts`의 `WarehouseMigrationMapping`

| 필드 | 설명 |
|---|---|
| id | 고유키 |
| legacyLocation | 기존 "창고번호" 컬럼의 원본 값 (예: "귀걸이서랍2") — 절대 변경하지 않음 |
| connectedModelCount | 이 legacyLocation 값을 가진 모델 수 (참고/검증용) |
| connectedSkuCount | 이 legacyLocation 값을 가진 SKU 수 (참고/검증용) |
| suggestedBoxId | 시스템이 추천하는 새 BOX ID (자동 추천, 확정 아님) |
| confirmedBoxId | 사람이 실물을 확인한 뒤 확정한 새 BOX ID (미확정이면 빈 값) |
| status | `unverified`(미확인) → `checking`(확인중) → `confirmed`(확정) → `skipped`(건너뜀) |
| memo | 검토 메모 |

**한 legacyLocation 값(예: "귀걸이서랍2")을 가진 SKU/모델이 여러 개일 수 있으므로,**
매핑은 **SKU 단위가 아니라 legacyLocation 고유값 단위**로 한다 — 같은 값을 가진
모델/SKU들은 일괄로 같은 새 BOX(들)에 매핑되는 것을 기본으로 하되, 실제로는 하나의
값이 여러 BOX에 걸쳐 있을 수도 있으므로 사람이 검토 단계에서 나눠서 매핑할 수도 있다
("동일 기존 창고번호 일괄 매핑" 기능으로 지원 — `/wms/warehouse/migration` 참고).

## 4. Migration 절차

1. 제품DB에서 `창고번호` 컬럼의 **고유값 목록**과 **각 값을 가진 모델/SKU 개수**를 뽑는다 (읽기 전용).
2. 이 목록을 `WarehouseMigrationMapping` 초안으로 만든다 (`status = unverified`, `suggestedBoxId`는
   비슷한 카테고리의 기존 BOX가 있으면 자동으로 추천할 수 있다 — 최종 결정 아님).
3. 사람이 하나씩(또는 동일 값 일괄로) 확인한다: `status`를 `checking`으로 바꾸고, 실물을 찾아본 뒤
   `confirmedBoxId`를 채우고 `status = confirmed`로 바꾸거나, 매핑하지 않기로 하면 `skipped`로 표시한다.
4. `confirmed`된 매핑만 실제 `모델위치`/`SKU예외위치`(Sprint 5의 `ModelLocation`/`SkuLocation`)에
   반영한다.
5. 기존 `창고번호` 컬럼은 이 과정 내내 원본 그대로 둔다 — 절대 삭제·덮어쓰지 않는다.

## 5. 검증 항목

Migration 결과(또는 그 이전 상태)를 점검할 때 아래 항목을 확인한다 (Sprint 5의
`/wms/warehouse/validation` 화면과 동일한 검증 서비스를 공유한다):

| 검증 항목 | 의미 |
|---|---|
| **미배치 모델** | 제품 카탈로그에는 있는데 `ModelLocation`도 `SkuLocation` 예외도 전혀 없는 모델 |
| **없는 BOX를 참조하는 모델** | `ModelLocation.primaryBoxId`/`secondaryBoxId`가 `BOX마스터`에 없는 값 |
| **중복 BOX ID** | `BOX마스터` 안에 같은 BOX ID가 두 번 이상 등록된 경우 |
| **모델 없는 BOX** | `BOX마스터`에는 있지만 어떤 모델도 가리키지 않는 빈 BOX (고아 BOX) |
| **비활성 BOX에 배치된 모델** | `ModelLocation`이 가리키는 BOX의 `status`가 사용중이 아닌 경우 |
| **동일 SKU의 중복 예외 위치** | `SkuLocation`에 같은 SKU ID가 두 번 이상 등록된 경우 |
| **세트상품인데 일반 BOX에 배치된 모델** | `ModelLocation.isSetProduct === true`인데 가리키는 BOX가 `isSetBox === false`인 경우 |

이 항목들은 `lib/warehouse/validation.ts`에 실제 함수로 구현되어 있다 (Sprint 5).

## 6. 이번 Sprint(5)에서 구현한 것 / 하지 않은 것

**구현함**: `/wms/warehouse/migration` 화면(로컬 저장소 기반 샘플 legacyLocation 목록으로
확인/확정 흐름 시연), `WarehouseMigrationMapping` 타입, `LocalWarehouseRepository`의
매핑 저장/조회.

**하지 않음**: 실제 제품DB의 `창고번호` 값을 구글시트에서 읽어와 매핑 초안을 만드는 작업
(Google Sheets 자격증명 필요, 아직 미등록 — Sprint 1 REPORT 참고), `모델위치`/`SKU예외위치`/
`BOX마스터` 구글시트 실제 쓰기.
