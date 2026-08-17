# 창고 운영 데이터 모델 설계

이 문서는 실제 창고 구조(창고 → 카테고리 구역 → 선반 → BOX → 모델 → SKU)를 어떻게
데이터로 표현할지에 대한 최종 설계다. 타입 정의는 `lib/wms/types.ts`에 반영되어 있다
(기존 타입 100% 호환, 확장만). **아직 실제 데이터는 입력하지 않았고, 화면/API도 바꾸지
않았다.** 이 문서는 설계와 근거를 기록한다.

## 1. 계층 구조

```
창고
 └─ WarehouseZone (카테고리 구역)     예: 귀걸이, 피어싱, 목걸이, 반지, 팔찌, 세트
     └─ Shelf (선반)                  예: E-A, E-B ...
         └─ WarehouseBox (BOX)        피킹의 최소 단위. 같은 BOX는 한 번만 연다.
             └─ 모델(들)               한 BOX 안에 여러 모델이 함께 있을 수 있다
                 └─ SKU(옵션)들
```

## 2. 실제 운영 방식이 설계에 반영된 부분

사용자가 설명한 실제 운영 방식을 그대로 데이터 모델에 반영했다:

- **카테고리별 구역**: `WarehouseZone.category`
- **같은 카테고리 안 시리즈별 보관(나비/하트/코인 등)**: `WarehouseBox.series` (선택 필드 — 시리즈 구분이 없는 카테고리는 비워둠)
- **선반 위 소형 공구박스 / 큰 리빙박스**: `WarehouseBox.kind` (`small_tool_box` | `large_living_box`)
- **한 모델의 옵션은 가능하면 같은 지퍼백/소형박스에 보관**: `ModelLocation.allOptionsSameBox`
- **여러 모델이 한 BOX에 함께 있을 수 있음**: `WarehouseBox` 1개에 `ModelLocation` N개가 연결될 수 있는 구조 (BOX가 모델을 소유하는 게 아니라, 모델이 BOX를 가리키는 방향)
- **세트상품은 별도 BOX 사용**: `WarehouseBox.isSetBox`

## 3. BOX ID 규칙

형식: `${카테고리코드}-${선반코드}-${3자리 번호}`

| 코드 | 카테고리 |
|---|---|
| E | 귀걸이 |
| P | 피어싱 |
| N | 목걸이 |
| R | 반지 |
| B | 팔찌 |
| S | 세트 |

예: `E-A-001`, `P-B-004`, `N-C-015`, `R-A-010`, `S-D-001`

- 카테고리코드는 `WarehouseZone.id`와 동일한 값을 쓴다 (Zone ID 자체가 이 코드).
- 선반코드는 `Shelf.id`의 뒷부분(예: `E-A`의 `A`)이다.
- 번호는 같은 Zone+선반 조합 안에서 순차 증가하는 3자리 숫자다(001, 002, ...).
- 이 규칙은 사람이 손으로 붙여도 되고, 나중에 BOX 생성 화면에서 자동 채번해도 된다 —
  타입 자체는 이 형식을 강제하지 않는 자유 문자열(`id: string`)이며, 형식 검증은
  UI/스크립트 레벨에서 정규식(`^[A-Z]-[A-Z]-\d{3}$` 형태)으로 하면 된다.

## 4. 모델/SKU 위치 상속 규칙

**핵심 설계 의도: SKU 6000개 전부에 위치를 일일이 입력하지 않아도 되게 한다.**
대부분의 SKU는 "같은 모델이면 같은 곳에 보관"이라는 실제 운영 방식을 그대로 따르므로,
**모델 단위로 위치를 한 번만 지정**하고 SKU는 그 값을 상속받는다. SKU별로 예외가 있을
때만 `SkuLocation`에 별도로 저장한다.

### 조회(상속) 알고리즘

```
resolveSkuLocation(skuId):
  1. SkuLocation에 이 skuId 예외 레코드가 있는가?
       있으면 → 그 boxId 사용 (가장 우선)
  2. 없으면 → 이 SKU의 모델명으로 ModelLocation을 찾는다
       ModelLocation이 없으면 → "미배치" (창고 정리가 아직 안 된 상태)
       ModelLocation이 있으면 →
         a) 세트상품 옵션인가? → 세트 BOX(보통 secondaryBoxId 또는 별도 지정된
            세트 전용 BOX)를 우선 사용 (아래 "열린 질문" 참고 — 세트 판별 기준을
            제품DB의 어떤 필드로 할지는 확정 필요)
         b) allOptionsSameBox === true → primaryBoxId 사용 (이 경우가 대부분이며,
            SkuLocation을 아예 저장하지 않아도 됨 — 저장 생략의 근거)
         c) allOptionsSameBox === false 인데 이 SKU의 SkuLocation 예외가 없다면
            → 우선 primaryBoxId를 기본값으로 사용하되, "이 모델은 옵션별로 위치가
            갈릴 수 있다고 표시되어 있는데 이 SKU의 정확한 위치가 비어있다"는
            경고를 화면에 표시한다 (데이터 누락 신호로 취급)
```

### 규칙 요약표

| 상황 | 결과 |
|---|---|
| SKU 위치 없음 | 모델 위치 사용 |
| 모델 위치도 없음 | 미배치 |
| 한 모델이 여러 BOX에 나뉨 | 보조 BOX(secondaryBoxId) 사용 |
| 세트상품 | 세트 BOX 우선 |
| 옵션이 모두 같은 BOX | SKU 위치 저장 생략 |

## 5. 피킹 정렬 규칙

피킹 목록은 항상 다음 순서로 정렬한다:

```
구역(Zone) → 선반(Shelf) → BOX → 모델 → SKU
```

**현재 상태와의 차이**: Sprint 2~3에서 구현한 `/wms/picking` 화면은 "선반 → BOX → 모델 → SKU"
순서로 그룹핑하고 있고, 아직 Zone(구역) 레벨 그룹핑은 없다(당시엔 Zone 개념이 설계되기
전이었음). 이번 스프린트는 화면을 수정하지 않으므로 이 차이는 그대로 남겨두고,
다음 스프린트에서 실제 데이터 연동 시 Zone 레벨 그룹핑을 추가해야 한다.

## 6. 타입 정의 위치

모든 타입은 `lib/wms/types.ts`에 있다. 이번 설계로 추가된 것:

- `WarehouseZone`, `Shelf` — 신규
- `WarehouseBox` — 기존 필드(id/shelfId/label/createdAt/updatedAt) 유지, 신규 필드 추가
  (kind/zoneId/category/series/isSetBox/currentModelCount/maxModelCount/qrValue/status/memo/sortOrder)
- `ModelLocation`, `SkuLocation` — 신규 (모델 상속 + SKU 예외 구조)
- `WarehouseLocation` — 기존 그대로 유지(`@deprecated` 표시만 추가), 삭제하지 않음
- `WarehouseMigrationMapping` — 신규 (docs/WAREHOUSE_MIGRATION_PLAN.md 참고)

## 7. 열린 질문 (구현 전 확인 필요)

1. **세트상품 판별 기준**: 제품DB의 어떤 필드/값으로 "이 SKU는 세트상품이다"를 판단할지
   (카테고리 = "세트"인 것으로 충분한지, 아니면 별도 표시가 필요한지) 확인이 필요하다.
2. **`currentModelCount`를 캐시 필드로 쓸지, 매번 계산할지**: 스프레드시트 환경에서는
   수동 동기화가 어긋나기 쉬우므로, 실제 구현 시 "화면에 보여줄 때 그때그때 계산"하는
   방식을 권장한다(아래 시트 설계 문서에도 같은 권장 사항 있음).
3. **BOX 번호 채번을 사람이 할지, 화면에서 자동 채번할지**: 처음에는 사람이 붙이고
   시작하되, 이후 스프린트에서 "새 BOX 만들기" 화면이 생기면 자동 채번을 검토한다.
